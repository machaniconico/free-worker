import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { salesRoutes } from '../src/routes/sales.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  db = bootstrap({ filename: ':memory:' });
  seedProduct(db, 1);
  app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(salesRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('salesRoutes', () => {
  it('注文CRUDと入金・返金・引渡ステータス更新を扱える', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/sales',
      payload: {
        orderNo: 'ROUTE-001',
        orderedAt: '2026-06-09',
        channel: 'direct',
        subtotalTaxIncluded: 11_000,
        taxAmount: 1_000,
        items: [{ productId: 1, quantity: 2, unitPriceTaxIncluded: 5_500 }],
        invoice: {
          invoiceNo: 'RINV-001',
          issuedAt: '2026-06-10',
          buyerName: 'ルート株式会社',
          qualifiedInvoiceFlag: true,
          taxRateSummary: '{"10":1000}',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody).toMatchObject({ orderNo: 'ROUTE-001', paymentStatus: 'pending' });
    expect(createdBody.items[0]).toMatchObject({ productId: 1, quantity: 2 });
    expect(createdBody.invoice).toMatchObject({ invoiceNo: 'RINV-001' });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/sales/${createdBody.id}`,
      payload: { channel: 'market', subtotalTaxIncluded: 12_100, taxAmount: 1_100 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ channel: 'market', subtotalTaxIncluded: 12_100 });

    const paid = await app.inject({
      method: 'PATCH',
      url: `/api/sales/${createdBody.id}/payment`,
      payload: { status: 'paid' },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().paymentStatus).toBe('paid');

    const delivered = await app.inject({
      method: 'PATCH',
      url: `/api/sales/${createdBody.id}/delivery`,
      payload: { status: 'delivered' },
    });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.json().deliveryStatus).toBe('delivered');

    const refunded = await app.inject({
      method: 'PATCH',
      url: `/api/sales/${createdBody.id}/refund`,
      payload: { status: 'refunded' },
    });
    expect(refunded.statusCode).toBe(200);
    expect(refunded.json().refundStatus).toBe('refunded');

    const list = await app.inject({ method: 'GET', url: '/api/sales' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/sales/${createdBody.id}` });
    expect(deleted.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/sales/${createdBody.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('CSV入出力と月次集計を返す', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/sales',
      payload: {
        orderNo: 'ROUTE-CSV-001',
        orderedAt: '2026-06-15',
        channel: 'store',
        subtotalTaxIncluded: 22_000,
        taxAmount: 2_000,
        paymentStatus: 'paid',
        deliveryStatus: 'delivered',
        items: [{ productId: 1, quantity: 1, unitPriceTaxIncluded: 22_000 }],
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/sales',
      payload: {
        orderNo: 'ROUTE-CSV-002',
        orderedAt: '2026-06-20',
        channel: 'store',
        subtotalTaxIncluded: 5_500,
        taxAmount: 500,
        paymentStatus: 'pending',
        refundStatus: 'refunded',
      },
    });

    const summary = await app.inject({ method: 'GET', url: '/api/sales/summary?month=2026-06' });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toEqual([
      {
        month: '2026-06',
        salesTaxIncluded: 27_500,
        taxAmount: 2_500,
        uncollectedAmount: 5_500,
        refundAmount: 5_500,
        orderCount: 2,
      },
    ]);

    const exported = await app.inject({ method: 'GET', url: '/api/sales/export' });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain('ROUTE-CSV-001');

    const imported = await app.inject({
      method: 'POST',
      url: '/api/sales/import',
      payload: { csv: exported.body.replace('ROUTE-CSV-001', 'ROUTE-CSV-003') },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toEqual({ imported: 2, created: 1, updated: 1 });

    const list = await app.inject({ method: 'GET', url: '/api/sales' });
    expect(list.json()).toHaveLength(3);
  });

  it('不正な作成ペイロードは400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sales', payload: { channel: 'direct' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_payload');
  });
});

function seedProduct(db: DB, id: number): void {
  db.prepare(
    `INSERT INTO products (id, sku, title, product_type, price_tax_included)
     VALUES (@id, @sku, @title, @productType, @priceTaxIncluded)`,
  ).run({
    id,
    sku: `SKU-${id}`,
    title: 'テスト商品',
    productType: 'download',
    priceTaxIncluded: 11_000,
  });
}
