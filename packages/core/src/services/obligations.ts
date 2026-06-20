import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';
import { dueStatus, type DueStatus, type IsoDate } from '../util/dates.js';
import { nullableText, requireTextCoded } from '../util/validate.js';

export interface Obligation {
  id: number;
  category: string;
  title: string;
  description: string | null;
  dueDate: IsoDate | null;
  recurrence: string | null;
  status: string;
  sourceId: string | null;
  evidenceAttachmentId: number | null;
  createdAt: string;
}

export interface ObligationWithDueStatus extends Obligation {
  dueStatus: DueStatus;
}

export interface CreateObligationInput {
  category: string;
  title: string;
  description?: string | null;
  dueDate?: IsoDate | null;
  recurrence?: string | null;
  status?: string;
  sourceId?: string | null;
  evidenceAttachmentId?: number | null;
}

export type UpdateObligationInput = Partial<CreateObligationInput>;

interface ObligationRow {
  id: number;
  category: string;
  title: string;
  description: string | null;
  due_date: string | null;
  recurrence: string | null;
  status: string;
  source_id: string | null;
  evidence_attachment_id: number | null;
  created_at: string;
}

const ENTITY_TYPE = 'obligation';

export function createObligation(db: DB, input: CreateObligationInput, actor = 'local_user'): Obligation {
  const payload = normalizeCreate(input);
  // INSERT と監査ログ書き込みをアトミックにし、途中失敗で監査欠落/孤立行が生じないようにする。
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO obligations
        (category, title, description, due_date, recurrence, status, source_id, evidence_attachment_id)
       VALUES
        (@category, @title, @description, @dueDate, @recurrence, @status, @sourceId, @evidenceAttachmentId)`,
      )
      .run(payload);
    const created = getObligationOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { actor, action: 'create', entityType: ENTITY_TYPE, entityId: created.id, after: created });
    return created;
  })();
}

export function getObligation(db: DB, id: number): Obligation | null {
  const row = db.prepare('SELECT * FROM obligations WHERE id = ?').get(id) as ObligationRow | undefined;
  return row ? mapRow(row) : null;
}

export function listObligations(db: DB): Obligation[] {
  return db
    .prepare('SELECT * FROM obligations ORDER BY due_date IS NULL, due_date ASC, id ASC')
    .all()
    .map((row) => mapRow(row as ObligationRow));
}

export function listWithDueStatus(db: DB, today: IsoDate): ObligationWithDueStatus[] {
  return listObligations(db).map((obligation) => ({
    ...obligation,
    dueStatus: dueStatus(obligation.dueDate, today),
  }));
}

export function updateObligation(db: DB, id: number, input: UpdateObligationInput, actor = 'local_user'): Obligation {
  const before = getObligationOrThrow(db, id);
  const next = { ...before, ...normalizeUpdate(input) };
  db.prepare(
    `UPDATE obligations SET
       category = @category,
       title = @title,
       description = @description,
       due_date = @dueDate,
       recurrence = @recurrence,
       status = @status,
       source_id = @sourceId,
       evidence_attachment_id = @evidenceAttachmentId
     WHERE id = @id`,
  ).run({
    id,
    category: next.category,
    title: next.title,
    description: next.description,
    dueDate: next.dueDate,
    recurrence: next.recurrence,
    status: next.status,
    sourceId: next.sourceId,
    evidenceAttachmentId: next.evidenceAttachmentId,
  });
  const after = getObligationOrThrow(db, id);
  writeAudit(db, { actor, action: 'update', entityType: ENTITY_TYPE, entityId: id, before, after });
  return after;
}

export function updateObligationStatus(db: DB, id: number, status: string, actor = 'local_user'): Obligation {
  return updateObligation(db, id, { status }, actor);
}

export function deleteObligation(db: DB, id: number, actor = 'local_user'): void {
  const before = getObligationOrThrow(db, id);
  writeAudit(db, { actor, action: 'delete', entityType: ENTITY_TYPE, entityId: id, before });
  db.prepare('DELETE FROM obligations WHERE id = ?').run(id);
}

function getObligationOrThrow(db: DB, id: number): Obligation {
  const obligation = getObligation(db, id);
  if (!obligation) throw new Error(`obligation not found: ${id}`);
  return obligation;
}

function normalizeCreate(input: CreateObligationInput): Required<CreateObligationInput> {
  const category = requireTextCoded(input.category, 'category', 'category_required');
  const title = requireTextCoded(input.title, 'title', 'title_required');
  return {
    category,
    title,
    description: nullableText(input.description),
    dueDate: nullableText(input.dueDate),
    recurrence: nullableText(input.recurrence),
    status: nullableText(input.status) ?? '未着手',
    sourceId: nullableText(input.sourceId),
    evidenceAttachmentId: input.evidenceAttachmentId ?? null,
  };
}

function normalizeUpdate(input: UpdateObligationInput): UpdateObligationInput {
  const out: UpdateObligationInput = {};
  if (input.category !== undefined) out.category = requireTextCoded(input.category, 'category', 'category_required');
  if (input.title !== undefined) out.title = requireTextCoded(input.title, 'title', 'title_required');
  if (input.description !== undefined) out.description = nullableText(input.description);
  if (input.dueDate !== undefined) out.dueDate = nullableText(input.dueDate);
  if (input.recurrence !== undefined) out.recurrence = nullableText(input.recurrence);
  if (input.status !== undefined) out.status = requireTextCoded(input.status, 'status', 'status_required');
  if (input.sourceId !== undefined) out.sourceId = nullableText(input.sourceId);
  if (input.evidenceAttachmentId !== undefined) out.evidenceAttachmentId = input.evidenceAttachmentId;
  return out;
}

function mapRow(row: ObligationRow): Obligation {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    recurrence: row.recurrence,
    status: row.status,
    sourceId: row.source_id,
    evidenceAttachmentId: row.evidence_attachment_id,
    createdAt: row.created_at,
  };
}
