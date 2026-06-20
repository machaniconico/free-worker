import type { FastifyInstance } from 'fastify';
import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  grantConsent,
  revokeConsent,
  listConsentHistory,
  getConsent,
} from '@free-worker/core';

interface IdParams {
  id: string;
}

interface ConsentParams extends IdParams {
  consentId: string;
}

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/customers', async () => listCustomers(app.db));

  app.get<{ Params: IdParams }>('/api/customers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const customer = getCustomer(app.db, id);
    if (!customer) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return customer;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/customers', async (req, reply) => {
    try {
      const created = createCustomer(app.db, (req.body ?? {}) as unknown as Parameters<typeof createCustomer>[1]);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.put<{ Body: Record<string, unknown>; Params: IdParams }>('/api/customers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getCustomer(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const updated = updateCustomer(app.db, id, (req.body ?? {}) as Parameters<typeof updateCustomer>[2]);
      return updated;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.delete<{ Params: IdParams }>('/api/customers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const deleted = deleteCustomer(app.db, id);
    if (!deleted) {
      reply.code(404);
      return { error: 'not_found' };
    }
    reply.code(204);
    return undefined;
  });

  app.get<{ Params: IdParams }>('/api/customers/:id/consents', async (req, reply) => {
    const customerId = parseId(req.params.id);
    if (customerId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getCustomer(app.db, customerId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return listConsentHistory(app.db, customerId);
  });

  app.post<{ Body: Record<string, unknown>; Params: IdParams }>('/api/customers/:id/consents', async (req, reply) => {
    const customerId = parseId(req.params.id);
    if (customerId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getCustomer(app.db, customerId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const body = req.body ?? {} as Record<string, unknown>;
      const created = grantConsent(app.db, { ...body, customerId } as Parameters<typeof grantConsent>[1]);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.post<{ Body: Record<string, unknown>; Params: ConsentParams }>(
    '/api/customers/:id/consents/:consentId/revoke',
    async (req, reply) => {
      const customerId = parseId(req.params.id);
      const consentId = parseId(req.params.consentId);
      if (customerId == null || consentId == null) {
        reply.code(400);
        return { error: 'invalid_id' };
      }
      const before = getConsent(app.db, consentId);
      if (!before || before.customerId !== customerId) {
        reply.code(404);
        return { error: 'not_found' };
      }
      try {
        return revokeConsent(app.db, customerId, consentId, (req.body ?? {}) as unknown as Parameters<typeof revokeConsent>[3]);
      } catch (error) {
        reply.code(400);
        return invalidPayload(error);
      }
    },
  );
}

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function invalidPayload(error: unknown): { error: string; message: string } {
  return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
}
