import type { FastifyInstance } from 'fastify';
import {
  createRecurringBilling,
  deleteRecurringBilling,
  generateDueBillings,
  getRecurringBilling,
  listRecurringBillings,
  updateRecurringBilling,
  updateRecurringBillingStatus,
} from '@free-worker/core';

export async function recurringBillingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/recurring-billings', async () => {
    return listRecurringBillings(app.db);
  });

  app.get('/api/recurring-billings/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const billing = getRecurringBilling(app.db, id);
    if (!billing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return billing;
  });

  app.post('/api/recurring-billings', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const created = createRecurringBilling(
        app.db,
        body as unknown as Parameters<typeof createRecurringBilling>[1],
      );
      reply.code(201);
      return created;
    } catch (e) {
      reply.code(400);
      return { error: 'invalid_payload', message: (e as Error).message };
    }
  });

  app.put('/api/recurring-billings/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getRecurringBilling(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      return updateRecurringBilling(
        app.db,
        id,
        body as unknown as Parameters<typeof updateRecurringBilling>[2],
      );
    } catch (e) {
      reply.code(400);
      return { error: 'invalid_payload', message: (e as Error).message };
    }
  });

  app.post('/api/recurring-billings/:id/status', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getRecurringBilling(app.db, id);
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
      return updateRecurringBillingStatus(app.db, id, body.status as Parameters<typeof updateRecurringBillingStatus>[2]);
    } catch (e) {
      reply.code(400);
      return { error: 'invalid_payload', message: (e as Error).message };
    }
  });

  app.delete('/api/recurring-billings/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (!Number.isInteger(id)) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const existing = getRecurringBilling(app.db, id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    deleteRecurringBilling(app.db, id);
    reply.code(204);
    return undefined;
  });

  app.post('/api/recurring-billings/run', async (req, reply) => {
    const body = (req.body ?? {}) as { asOf?: string };
    const asOf = body.asOf ?? new Date().toISOString().slice(0, 10);
    try {
      return generateDueBillings(app.db, asOf);
    } catch (e) {
      reply.code(400);
      return { error: 'invalid_payload', message: (e as Error).message };
    }
  });
}

function routeId(params: unknown): number {
  return Number((params as { id: string }).id);
}
