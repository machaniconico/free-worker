import type { FastifyInstance } from 'fastify';
import { dueStatus, toIsoDate } from '@free-worker/core';

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

interface ObligationPayload {
  category?: string;
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  recurrence?: string | null;
  status?: string;
  sourceId?: string | null;
  evidenceAttachmentId?: number | null;
}

export async function obligationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/obligations', async (req) => {
    const query = req.query as { today?: string };
    const today = query.today ?? toIsoDate(new Date());
    return app.db
      .prepare('SELECT * FROM obligations ORDER BY due_date IS NULL, due_date ASC, id ASC')
      .all()
      .map((row) => {
        const obligation = mapRow(row as ObligationRow);
        return { ...obligation, dueStatus: dueStatus(obligation.dueDate, today) };
      });
  });

  app.get('/api/obligations/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const obligation = getObligation(app, id);
    if (!obligation) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return obligation;
  });

  app.post('/api/obligations', async (req, reply) => {
    const body = (req.body ?? {}) as ObligationPayload;
    const validation = validateCreate(body);
    if (validation) {
      reply.code(400);
      return validation;
    }
    const result = app.db
      .prepare(
        `INSERT INTO obligations
          (category, title, description, due_date, recurrence, status, source_id, evidence_attachment_id)
         VALUES
          (@category, @title, @description, @dueDate, @recurrence, @status, @sourceId, @evidenceAttachmentId)`,
      )
      .run(normalizePayload(body, true));
    const created = getObligation(app, Number(result.lastInsertRowid));
    app.db
      .prepare(
        `INSERT INTO audit_logs (actor, action, entity_type, entity_id, before_json, after_json)
         VALUES (@actor, @action, @entityType, @entityId, @before, @after)`,
      )
      .run({
        actor: 'local_user',
        action: 'create',
        entityType: 'obligation',
        entityId: String(result.lastInsertRowid),
        before: null,
        after: JSON.stringify(created),
      });
    reply.code(201);
    return created;
  });

  app.put('/api/obligations/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getObligation(app, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const body = (req.body ?? {}) as ObligationPayload;
    const validation = validateUpdate(body);
    if (validation) {
      reply.code(400);
      return validation;
    }
    const next = { ...before, ...normalizeUpdatePayload(body) };
    app.db
      .prepare(
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
      )
      .run({ ...next, id });
    const after = getObligation(app, id);
    writeRouteAudit(app, 'update', id, before, after);
    return after;
  });

  app.patch('/api/obligations/:id/status', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getObligation(app, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const body = (req.body ?? {}) as { status?: string };
    if (!body.status?.trim()) {
      reply.code(400);
      return { error: 'status_required' };
    }
    app.db.prepare('UPDATE obligations SET status = @status WHERE id = @id').run({ id, status: body.status.trim() });
    const after = getObligation(app, id);
    writeRouteAudit(app, 'update', id, before, after);
    return after;
  });

  app.delete('/api/obligations/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getObligation(app, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    writeRouteAudit(app, 'delete', id, before, undefined);
    app.db.prepare('DELETE FROM obligations WHERE id = ?').run(id);
    reply.code(204);
    return undefined;
  });
}

function getObligation(app: FastifyInstance, id: number): ReturnType<typeof mapRow> | null {
  const row = app.db.prepare('SELECT * FROM obligations WHERE id = ?').get(id) as ObligationRow | undefined;
  return row ? mapRow(row) : null;
}

function writeRouteAudit(
  app: FastifyInstance,
  action: string,
  entityId: number,
  before: unknown,
  after: unknown,
): void {
  app.db
    .prepare(
      `INSERT INTO audit_logs (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (@actor, @action, @entityType, @entityId, @before, @after)`,
    )
    .run({
      actor: 'local_user',
      action,
      entityType: 'obligation',
      entityId: String(entityId),
      before: before === undefined ? null : JSON.stringify(before),
      after: after === undefined ? null : JSON.stringify(after),
    });
}

function validateCreate(body: ObligationPayload): { error: string } | null {
  if (!body.category?.trim()) return { error: 'category_required' };
  if (!body.title?.trim()) return { error: 'title_required' };
  return null;
}

function validateUpdate(body: ObligationPayload): { error: string } | null {
  if (body.category !== undefined && !body.category?.trim()) return { error: 'category_required' };
  if (body.title !== undefined && !body.title?.trim()) return { error: 'title_required' };
  if (body.status !== undefined && !body.status?.trim()) return { error: 'status_required' };
  return null;
}

function normalizePayload(body: ObligationPayload, fillDefaults: true): Record<string, string | number | null> {
  return {
    category: trimText(body.category) ?? '',
    title: trimText(body.title) ?? '',
    description: nullableText(body.description),
    dueDate: nullableText(body.dueDate),
    recurrence: nullableText(body.recurrence),
    status: trimText(body.status) ?? '未着手',
    sourceId: nullableText(body.sourceId),
    evidenceAttachmentId: body.evidenceAttachmentId ?? null,
  };
}

function normalizeUpdatePayload(body: ObligationPayload): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (body.category !== undefined) out.category = trimText(body.category) ?? '';
  if (body.title !== undefined) out.title = trimText(body.title) ?? '';
  if (body.description !== undefined) out.description = nullableText(body.description);
  if (body.dueDate !== undefined) out.dueDate = nullableText(body.dueDate);
  if (body.recurrence !== undefined) out.recurrence = nullableText(body.recurrence);
  if (body.status !== undefined) out.status = trimText(body.status) ?? '';
  if (body.sourceId !== undefined) out.sourceId = nullableText(body.sourceId);
  if (body.evidenceAttachmentId !== undefined) out.evidenceAttachmentId = body.evidenceAttachmentId;
  return out;
}

function routeId(params: unknown): number {
  return Number((params as { id: string }).id);
}

function nullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return trimText(value);
}

function trimText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function mapRow(row: ObligationRow): {
  id: number;
  category: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  recurrence: string | null;
  status: string;
  sourceId: string | null;
  evidenceAttachmentId: number | null;
  createdAt: string;
} {
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
