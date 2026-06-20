import type { FastifyInstance, FastifyReply } from 'fastify';
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
  accountsReceivableAging,
  type Order,
  type CreateOrderInput,
  type UpdateOrderInput,
  type DB,
} from '@free-worker/core';

interface IdParams {
  id: string;
}

interface SummaryQuery {
  month?: string;
}

interface AgingQuery {
  asOf?: string;
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function patchStatus(
  app: FastifyInstance,
  idText: string,
  statusValue: unknown,
  fn: (db: DB, id: number, status: string) => Order | null,
  reply: FastifyReply,
): Promise<Order | { error: string; message?: string }> {
  const id = parseId(idText);
  if (id == null) {
    reply.code(400);
    return { error: 'invalid_id' };
  }
  if (!getOrder(app.db, id)) {
    reply.code(404);
    return { error: 'not_found' };
  }
  if (typeof statusValue !== 'string') {
    reply.code(400);
    return { error: 'invalid_payload', message: 'status must be a string' };
  }
  try {
    const result = fn(app.db, id, statusValue);
    if (result == null) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return result;
  } catch (error) {
    reply.code(400);
    return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
  }
}

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sales', async (_req, reply) => {
    try {
      return listOrders(app.db);
    } catch {
      reply.code(500);
      return { error: 'internal_error' };
    }
  });

  app.get<{ Querystring: SummaryQuery }>('/api/sales/summary', async (req, reply) => {
    try {
      return monthlySummary(app.db, req.query.month);
    } catch {
      reply.code(500);
      return { error: 'internal_error' };
    }
  });

  app.get<{ Querystring: AgingQuery }>('/api/sales/aging', async (req, reply) => {
    const { asOf } = req.query;
    if (asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      reply.code(400);
      return { error: 'invalid_asof' };
    }
    try {
      return accountsReceivableAging(app.db, asOf);
    } catch {
      reply.code(500);
      return { error: 'internal_error' };
    }
  });

  app.get('/api/sales/export', async (_req, reply) => {
    try {
      reply.header('content-type', 'text/csv; charset=utf-8');
      return exportOrdersCsv(app.db);
    } catch {
      reply.code(500);
      return { error: 'internal_error' };
    }
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
    return patchStatus(app, req.params.id, req.body?.status, updatePaymentStatus, reply);
  });

  app.patch<{ Body: { status?: unknown }; Params: IdParams }>('/api/sales/:id/refund', async (req, reply) => {
    return patchStatus(app, req.params.id, req.body?.status, updateRefundStatus, reply);
  });

  app.patch<{ Body: { status?: unknown }; Params: IdParams }>('/api/sales/:id/delivery', async (req, reply) => {
    return patchStatus(app, req.params.id, req.body?.status, updateDeliveryStatus, reply);
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
