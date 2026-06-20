import type { FastifyInstance } from 'fastify';
import {
  convertQuoteToOrder,
  createQuote,
  deleteQuote,
  getQuote,
  listQuotes,
  updateQuote,
  updateQuoteStatus,
} from '@free-worker/core';

export async function quotesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/quotes', async () => {
    return listQuotes(app.db);
  });

  app.get('/api/quotes/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const quote = getQuote(app.db, id);
    if (!quote) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return quote;
  });

  app.post('/api/quotes', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const created = createQuote(app.db, body as unknown as Parameters<typeof createQuote>[1]);
      reply.code(201);
      return created;
    } catch (e) {
      reply.code(400);
      return { error: 'invalid_payload', message: (e as Error).message };
    }
  });

  app.put('/api/quotes/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getQuote(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      return updateQuote(app.db, id, body as unknown as Parameters<typeof updateQuote>[2]);
    } catch (e) {
      reply.code(400);
      return { error: 'invalid_payload', message: (e as Error).message };
    }
  });

  app.patch('/api/quotes/:id/status', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getQuote(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const body = (req.body ?? {}) as { status?: string };
    if (!body.status || !body.status.trim()) {
      reply.code(400);
      return { error: 'invalid_payload', message: 'status is required' };
    }
    try {
      return updateQuoteStatus(app.db, id, body.status);
    } catch (e) {
      reply.code(400);
      return { error: 'invalid_payload', message: (e as Error).message };
    }
  });

  app.post('/api/quotes/:id/convert', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getQuote(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return convertQuoteToOrder(app.db, id);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'already converted' || msg.startsWith('cannot convert:')) {
        reply.code(400);
        return { error: 'cannot_convert', message: msg };
      }
      throw e;
    }
  });

  app.delete('/api/quotes/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getQuote(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    deleteQuote(app.db, id);
    reply.code(204);
    return undefined;
  });
}

function routeId(params: unknown): number {
  return Number((params as { id: string }).id);
}
