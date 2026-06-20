import type { FastifyInstance } from 'fastify';
import {
  createOrder,
  updateOrder,
  deleteOrder,
  updatePaymentStatus,
  updateRefundStatus,
  updateDeliveryStatus,
  listOrders,
  getOrder,
  monthlySummary,
  exportOrdersCsv,
  importOrdersCsv,
  type Order,
  type CreateOrderInput,
  type UpdateOrderInput,
} from '@free-worker/core';

interface IdParams {
  id: string;
}

interface SummaryQuery {
  month?: string;
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sales', async () => listOrders(app.db));

  app.get<{ Querystring: SummaryQuery }>('/api/sales/summary', async (req) =>
    monthlySummary(app.db, req.query.month),
  );

  app.get('/api/sales/export', async (_req, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    return exportOrdersCsv(app.db);
  });

  app.post<{ Body: { csv?: unknown } }>('/api/sales/import', async (req, reply) => {
    if (typeof req.body?.csv !== 'string') {
      reply.code(400);
      return { error: 'csv_required' };
    }
    try {
      return importOrdersCsv(app.db, req.body.csv);
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_csv', message: error instanceof Error ? error.message : 'invalid csv' };
    }
  });

  app.get<{ Params: IdParams }>('/api/sales/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const order = getOrder(app.db, id);
    if (!order) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return order;
  });

  app.post<{ Body: CreateOrderInput }>('/api/sales', async (req, reply) => {
    try {
      const created = createOrder(app.db, req.body ?? ({} as CreateOrderInput));
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.put<{ Body: UpdateOrderInput; Params: IdParams }>('/api/sales/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getOrder(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const result: Order | null = updateOrder(app.db, id, req.body ?? {});
      if (result == null) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.patch<{ Body: { status?: unknown }; Params: IdParams }>('/api/sales/:id/payment', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getOrder(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const result: Order | null = updatePaymentStatus(app.db, id, String(req.body?.status ?? ''));
      if (result == null) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.patch<{ Body: { status?: unknown }; Params: IdParams }>('/api/sales/:id/refund', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getOrder(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const result: Order | null = updateRefundStatus(app.db, id, String(req.body?.status ?? ''));
      if (result == null) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.patch<{ Body: { status?: unknown }; Params: IdParams }>('/api/sales/:id/delivery', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getOrder(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const result: Order | null = updateDeliveryStatus(app.db, id, String(req.body?.status ?? ''));
      if (result == null) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.delete<{ Params: IdParams }>('/api/sales/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getOrder(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    deleteOrder(app.db, id);
    reply.code(204);
    return undefined;
  });
}
