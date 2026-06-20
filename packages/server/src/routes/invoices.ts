import type { FastifyInstance } from 'fastify';
import { buildInvoiceView, type DB } from '@free-worker/core';

interface InvoiceViewParams {
  orderId: string;
}

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: InvoiceViewParams }>('/api/invoices/:orderId/view', async (req, reply) => {
    const orderId = parseId(req.params.orderId);
    if (orderId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }

    const view = buildInvoiceView(app.db, orderId);
    if (!view) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return view;
  });
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
