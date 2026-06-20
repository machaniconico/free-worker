import type { FastifyInstance } from 'fastify';
import {
  createObligation,
  deleteObligation,
  getObligation,
  listWithDueStatus,
  toIsoDate,
  updateObligation,
  updateObligationStatus,
  ValidationError,
} from '@free-worker/core';

export async function obligationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/obligations', async (req) => {
    const query = req.query as { today?: string };
    const today = query.today ?? toIsoDate(new Date());
    return listWithDueStatus(app.db, today);
  });

  app.get('/api/obligations/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const obligation = getObligation(app.db, id);
    if (!obligation) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return obligation;
  });

  app.post('/api/obligations', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const created = createObligation(app.db, body as unknown as Parameters<typeof createObligation>[1]);
      reply.code(201);
      return created;
    } catch (e) {
      if (e instanceof ValidationError) {
        reply.code(400);
        return { error: e.code };
      }
      throw e;
    }
  });

  app.put('/api/obligations/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getObligation(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      return updateObligation(app.db, id, body as unknown as Parameters<typeof updateObligation>[2]);
    } catch (e) {
      if (e instanceof ValidationError) {
        reply.code(400);
        return { error: e.code };
      }
      throw e;
    }
  });

  app.patch('/api/obligations/:id/status', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getObligation(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const body = (req.body ?? {}) as { status?: string };
    try {
      return updateObligationStatus(app.db, id, (body.status ?? '') as string);
    } catch (e) {
      if (e instanceof ValidationError) {
        reply.code(400);
        return { error: e.code };
      }
      throw e;
    }
  });

  app.delete('/api/obligations/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getObligation(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    deleteObligation(app.db, id);
    reply.code(204);
    return undefined;
  });
}

function routeId(params: unknown): number {
  return Number((params as { id: string }).id);
}
