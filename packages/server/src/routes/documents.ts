import type { FastifyInstance } from 'fastify';
import { writeAudit, type DB } from '@free-worker/core';

type DocumentType = 'tokushoho' | 'terms' | 'privacy' | 'contract_template' | 'license' | 'other';
type DocumentState = 'draft' | 'published' | 'archived';

interface DocumentVersion {
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

interface DocumentPayload {
  docType?: unknown;
  title?: unknown;
  versionLabel?: unknown;
  body?: unknown;
  state?: unknown;
  effectiveDate?: unknown;
  nextReviewDate?: unknown;
  sourceId?: unknown;
}

interface DocumentRow {
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

interface IdParams {
  id: string;
}

interface HistoryParams {
  docType: string;
}

interface ListQuery {
  docType?: string;
}

const DOCUMENT_TYPES: DocumentType[] = ['tokushoho', 'terms', 'privacy', 'contract_template', 'license', 'other'];
const DOCUMENT_STATES: DocumentState[] = ['draft', 'published', 'archived'];
const DOCUMENT_ENTITY = 'document_version';

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/api/documents', async (req, reply) => {
    if (req.query.docType !== undefined) {
      const docType = parseDocumentTypeOrNull(req.query.docType);
      if (!docType) {
        reply.code(400);
        return { error: 'invalid_doc_type' };
      }
      return listDocumentsByType(app.db, docType);
    }
    return listDocuments(app.db);
  });

  app.get<{ Params: HistoryParams }>('/api/documents/history/:docType', async (req, reply) => {
    const docType = parseDocumentTypeOrNull(req.params.docType);
    if (!docType) {
      reply.code(400);
      return { error: 'invalid_doc_type' };
    }
    return listDocumentsByType(app.db, docType);
  });

  app.get<{ Params: IdParams }>('/api/documents/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const document = getDocument(app.db, id);
    if (!document) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return document;
  });

  app.post<{ Body: DocumentPayload }>('/api/documents', async (req, reply) => {
    try {
      const created = createDocument(app.db, req.body ?? {});
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.put<{ Body: DocumentPayload; Params: IdParams }>('/api/documents/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getDocument(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateDocument(app.db, id, req.body ?? {});
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.post<{ Params: IdParams }>('/api/documents/:id/publish', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const published = publishDocument(app.db, id);
    if (!published) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return published;
  });

  app.delete<{ Params: IdParams }>('/api/documents/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getDocument(app.db, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      writeAudit(app.db, { action: 'delete', entityType: DOCUMENT_ENTITY, entityId: id, before });
      app.db.prepare('DELETE FROM document_versions WHERE id = ?').run(id);
    })();
    reply.code(204);
    return undefined;
  });
}

function listDocuments(db: DB): DocumentVersion[] {
  const rows = db
    .prepare('SELECT * FROM document_versions ORDER BY doc_type ASC, created_at DESC, id DESC')
    .all() as DocumentRow[];
  return rows.map(mapDocument);
}

function listDocumentsByType(db: DB, docType: DocumentType): DocumentVersion[] {
  const rows = db
    .prepare('SELECT * FROM document_versions WHERE doc_type = ? ORDER BY created_at DESC, id DESC')
    .all(docType) as DocumentRow[];
  return rows.map(mapDocument);
}

function getDocument(db: DB, id: number): DocumentVersion | null {
  const row = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id) as DocumentRow | undefined;
  return row ? mapDocument(row) : null;
}

function getDocumentOrThrow(db: DB, id: number): DocumentVersion {
  const document = getDocument(db, id);
  if (!document) throw new Error(`document version not found: ${id}`);
  return document;
}

function createDocument(db: DB, body: DocumentPayload): DocumentVersion {
  const payload = normalizeCreate(body);
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
    const created = getDocumentOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { action: 'create', entityType: DOCUMENT_ENTITY, entityId: created.id, after: created });
    return created;
  })();
}

function updateDocument(db: DB, id: number, body: DocumentPayload): DocumentVersion {
  const before = getDocumentOrThrow(db, id);
  const next = { ...before, ...normalizeUpdate(body) };
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
    const after = getDocumentOrThrow(db, id);
    writeAudit(db, { action: 'update', entityType: DOCUMENT_ENTITY, entityId: id, before, after });
    return after;
  })();
}

function publishDocument(db: DB, id: number): DocumentVersion | null {
  const before = getDocument(db, id);
  if (!before) return null;
  if (before.state === 'published') return before;

  return db.transaction(() => {
    const archived = archivePublishedForType(db, before.docType, id);
    db.prepare("UPDATE document_versions SET state = 'published' WHERE id = ?").run(id);
    const after = getDocumentOrThrow(db, id);
    writeAudit(db, {
      action: 'publish',
      entityType: DOCUMENT_ENTITY,
      entityId: id,
      before: { target: before, archived },
      after,
    });
    return after;
  })();
}

function archivePublishedForType(db: DB, docType: DocumentType, exceptId?: number): DocumentVersion[] {
  const published = db
    .prepare(
      `SELECT * FROM document_versions
       WHERE doc_type = ? AND state = 'published' AND (? IS NULL OR id <> ?)
       ORDER BY id ASC`,
    )
    .all(docType, exceptId ?? null, exceptId ?? null) as DocumentRow[];
  if (published.length === 0) return [];
  db.prepare(
    `UPDATE document_versions
     SET state = 'archived'
     WHERE doc_type = ? AND state = 'published' AND (? IS NULL OR id <> ?)`,
  ).run(docType, exceptId ?? null, exceptId ?? null);
  return published.map(mapDocument);
}

function normalizeCreate(body: DocumentPayload): Omit<DocumentVersion, 'id' | 'createdAt'> {
  return {
    docType: parseDocumentType(body.docType),
    title: parseRequiredString(body.title, 'title'),
    versionLabel: parseRequiredString(body.versionLabel, 'versionLabel'),
    body: parseRequiredString(body.body, 'body'),
    state: body.state == null ? 'draft' : parseDocumentState(body.state),
    effectiveDate: parseOptionalString(body.effectiveDate, 'effectiveDate'),
    nextReviewDate: parseOptionalString(body.nextReviewDate, 'nextReviewDate'),
    sourceId: parseOptionalString(body.sourceId, 'sourceId'),
  };
}

function normalizeUpdate(body: DocumentPayload): Partial<Omit<DocumentVersion, 'id' | 'createdAt'>> {
  const next: Partial<Omit<DocumentVersion, 'id' | 'createdAt'>> = {};
  if (body.docType !== undefined) next.docType = parseDocumentType(body.docType);
  if (body.title !== undefined) next.title = parseRequiredString(body.title, 'title');
  if (body.versionLabel !== undefined) next.versionLabel = parseRequiredString(body.versionLabel, 'versionLabel');
  if (body.body !== undefined) next.body = parseRequiredString(body.body, 'body');
  if (body.state !== undefined) next.state = body.state == null ? 'draft' : parseDocumentState(body.state);
  if (body.effectiveDate !== undefined) next.effectiveDate = parseOptionalString(body.effectiveDate, 'effectiveDate');
  if (body.nextReviewDate !== undefined) next.nextReviewDate = parseOptionalString(body.nextReviewDate, 'nextReviewDate');
  if (body.sourceId !== undefined) next.sourceId = parseOptionalString(body.sourceId, 'sourceId');
  return next;
}

function mapDocument(row: DocumentRow): DocumentVersion {
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

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDocumentType(value: unknown): DocumentType {
  const docType = parseDocumentTypeOrNull(value);
  if (!docType) throw new Error(`docType must be one of: ${DOCUMENT_TYPES.join(', ')}`);
  return docType;
}

function parseDocumentTypeOrNull(value: unknown): DocumentType | null {
  if (typeof value !== 'string') return null;
  return DOCUMENT_TYPES.includes(value as DocumentType) ? (value as DocumentType) : null;
}

function parseDocumentState(value: unknown): DocumentState {
  if (typeof value !== 'string' || !DOCUMENT_STATES.includes(value as DocumentState)) {
    throw new Error(`state must be one of: ${DOCUMENT_STATES.join(', ')}`);
  }
  return value as DocumentState;
}

function parseRequiredString(value: unknown, field: string): string {
  const text = parseOptionalString(value, field);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function parseOptionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function invalidPayload(error: unknown): { error: 'invalid_payload'; message: string } {
  return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
}
