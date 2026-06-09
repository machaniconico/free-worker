import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';

export type DocumentType = 'tokushoho' | 'terms' | 'privacy' | 'contract_template' | 'license' | 'other';
export type DocumentState = 'draft' | 'published' | 'archived';

export interface DocumentVersion {
  id: number;
  docType: DocumentType;
  title: string;
  versionLabel: string;
  body: string;
  state: DocumentState;
  effectiveDate: string | null;
  nextReviewDate: string | null;
  sourceId: string | null;
  createdAt: string;
}

export interface CreateDocumentVersionInput {
  docType: DocumentType;
  title: string;
  versionLabel: string;
  body: string;
  state?: DocumentState | null;
  effectiveDate?: string | null;
  nextReviewDate?: string | null;
  sourceId?: string | null;
}

export type UpdateDocumentVersionInput = Partial<CreateDocumentVersionInput>;

interface DocumentVersionRow {
  id: number;
  doc_type: DocumentType;
  title: string;
  version_label: string;
  body: string;
  state: DocumentState;
  effective_date: string | null;
  next_review_date: string | null;
  source_id: string | null;
  created_at: string;
}

const DOCUMENT_ENTITY = 'document_version';
const DOCUMENT_TYPES: DocumentType[] = ['tokushoho', 'terms', 'privacy', 'contract_template', 'license', 'other'];
const DOCUMENT_STATES: DocumentState[] = ['draft', 'published', 'archived'];

export function listDocumentVersions(db: DB): DocumentVersion[] {
  const rows = db
    .prepare('SELECT * FROM document_versions ORDER BY doc_type ASC, created_at DESC, id DESC')
    .all() as DocumentVersionRow[];
  return rows.map(mapDocumentVersion);
}

export function listDocumentVersionsByType(db: DB, docType: DocumentType): DocumentVersion[] {
  assertDocumentType(docType);
  const rows = db
    .prepare('SELECT * FROM document_versions WHERE doc_type = ? ORDER BY created_at DESC, id DESC')
    .all(docType) as DocumentVersionRow[];
  return rows.map(mapDocumentVersion);
}

export function getDocumentRevisionHistory(db: DB, docType: DocumentType): DocumentVersion[] {
  return listDocumentVersionsByType(db, docType);
}

export function getDocumentVersion(db: DB, id: number): DocumentVersion | null {
  const row = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id) as DocumentVersionRow | undefined;
  return row ? mapDocumentVersion(row) : null;
}

export function createDocumentVersion(
  db: DB,
  input: CreateDocumentVersionInput,
  actor = 'local_user',
): DocumentVersion {
  const payload = normalizeCreate(input);
  return db.transaction(() => {
    if (payload.state === 'published') archivePublishedForType(db, payload.docType);
    const result = db
      .prepare(
        `INSERT INTO document_versions
          (doc_type, title, version_label, body, state, effective_date, next_review_date, source_id)
         VALUES
          (@docType, @title, @versionLabel, @body, @state, @effectiveDate, @nextReviewDate, @sourceId)`,
      )
      .run(payload);
    const created = getDocumentVersionOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { actor, action: 'create', entityType: DOCUMENT_ENTITY, entityId: created.id, after: created });
    return created;
  })();
}

export function updateDocumentVersion(
  db: DB,
  id: number,
  input: UpdateDocumentVersionInput,
  actor = 'local_user',
): DocumentVersion | null {
  const before = getDocumentVersion(db, id);
  if (!before) return null;
  const next = { ...before, ...normalizeUpdate(input) };
  return db.transaction(() => {
    if (next.state === 'published') archivePublishedForType(db, next.docType, id);
    db.prepare(
      `UPDATE document_versions SET
         doc_type = @docType,
         title = @title,
         version_label = @versionLabel,
         body = @body,
         state = @state,
         effective_date = @effectiveDate,
         next_review_date = @nextReviewDate,
         source_id = @sourceId
       WHERE id = @id`,
    ).run({
      id,
      docType: next.docType,
      title: next.title,
      versionLabel: next.versionLabel,
      body: next.body,
      state: next.state,
      effectiveDate: next.effectiveDate,
      nextReviewDate: next.nextReviewDate,
      sourceId: next.sourceId,
    });
    const after = getDocumentVersionOrThrow(db, id);
    writeAudit(db, { actor, action: 'update', entityType: DOCUMENT_ENTITY, entityId: id, before, after });
    return after;
  })();
}

export function publishDocumentVersion(db: DB, id: number, actor = 'local_user'): DocumentVersion | null {
  const before = getDocumentVersion(db, id);
  if (!before) return null;
  if (before.state === 'published') return before;

  return db.transaction(() => {
    const archived = archivePublishedForType(db, before.docType, id);
    db.prepare("UPDATE document_versions SET state = 'published' WHERE id = ?").run(id);
    const after = getDocumentVersionOrThrow(db, id);
    writeAudit(db, {
      actor,
      action: 'publish',
      entityType: DOCUMENT_ENTITY,
      entityId: id,
      before: { target: before, archived },
      after,
    });
    return after;
  })();
}

export function deleteDocumentVersion(db: DB, id: number, actor = 'local_user'): boolean {
  const before = getDocumentVersion(db, id);
  if (!before) return false;
  db.transaction(() => {
    writeAudit(db, { actor, action: 'delete', entityType: DOCUMENT_ENTITY, entityId: id, before });
    db.prepare('DELETE FROM document_versions WHERE id = ?').run(id);
  })();
  return true;
}

function archivePublishedForType(db: DB, docType: DocumentType, exceptId?: number): DocumentVersion[] {
  const published = db
    .prepare(
      `SELECT * FROM document_versions
       WHERE doc_type = ? AND state = 'published' AND (? IS NULL OR id <> ?)
       ORDER BY id ASC`,
    )
    .all(docType, exceptId ?? null, exceptId ?? null) as DocumentVersionRow[];
  if (published.length === 0) return [];

  db.prepare(
    `UPDATE document_versions
     SET state = 'archived'
     WHERE doc_type = ? AND state = 'published' AND (? IS NULL OR id <> ?)`,
  ).run(docType, exceptId ?? null, exceptId ?? null);
  return published.map(mapDocumentVersion);
}

function getDocumentVersionOrThrow(db: DB, id: number): DocumentVersion {
  const document = getDocumentVersion(db, id);
  if (!document) throw new Error(`document version not found: ${id}`);
  return document;
}

function normalizeCreate(input: CreateDocumentVersionInput): Omit<DocumentVersion, 'id' | 'createdAt'> {
  const docType = parseDocumentType(input.docType);
  return {
    docType,
    title: requireText(input.title, 'title'),
    versionLabel: requireText(input.versionLabel, 'versionLabel'),
    body: requireText(input.body, 'body'),
    state: input.state == null ? 'draft' : parseDocumentState(input.state),
    effectiveDate: nullableText(input.effectiveDate),
    nextReviewDate: nullableText(input.nextReviewDate),
    sourceId: nullableText(input.sourceId),
  };
}

function normalizeUpdate(input: UpdateDocumentVersionInput): Partial<Omit<DocumentVersion, 'id' | 'createdAt'>> {
  const next: Partial<Omit<DocumentVersion, 'id' | 'createdAt'>> = {};
  if (input.docType !== undefined) next.docType = parseDocumentType(input.docType);
  if (input.title !== undefined) next.title = requireText(input.title, 'title');
  if (input.versionLabel !== undefined) next.versionLabel = requireText(input.versionLabel, 'versionLabel');
  if (input.body !== undefined) next.body = requireText(input.body, 'body');
  if (input.state !== undefined) next.state = input.state == null ? 'draft' : parseDocumentState(input.state);
  if (input.effectiveDate !== undefined) next.effectiveDate = nullableText(input.effectiveDate);
  if (input.nextReviewDate !== undefined) next.nextReviewDate = nullableText(input.nextReviewDate);
  if (input.sourceId !== undefined) next.sourceId = nullableText(input.sourceId);
  return next;
}

function mapDocumentVersion(row: DocumentVersionRow): DocumentVersion {
  return {
    id: row.id,
    docType: row.doc_type,
    title: row.title,
    versionLabel: row.version_label,
    body: row.body,
    state: row.state,
    effectiveDate: row.effective_date,
    nextReviewDate: row.next_review_date,
    sourceId: row.source_id,
    createdAt: row.created_at,
  };
}

function parseDocumentType(value: unknown): DocumentType {
  if (typeof value !== 'string' || !DOCUMENT_TYPES.includes(value as DocumentType)) {
    throw new Error(`docType must be one of: ${DOCUMENT_TYPES.join(', ')}`);
  }
  return value as DocumentType;
}

function parseDocumentState(value: unknown): DocumentState {
  if (typeof value !== 'string' || !DOCUMENT_STATES.includes(value as DocumentState)) {
    throw new Error(`state must be one of: ${DOCUMENT_STATES.join(', ')}`);
  }
  return value as DocumentState;
}

function assertDocumentType(value: DocumentType): void {
  parseDocumentType(value);
}

function requireText(value: string | null | undefined, field: string): string {
  const text = nullableText(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function nullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}
