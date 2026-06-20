import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { quotesRoutes } from '../src/routes/quotes.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  db = bootstrap({ filename: ':memory:' });
  // Seed a product for convert tests
  db.prepare(
    `INSERT OR IGNORE INTO products (id, sku, title, product_type, price_tax_included)
     VALUES (@id, @sku, @title, @productType, @priceTaxIncluded)`,
  ).run({ id: 1, sku: 'SKU-1', title: 'テスト商品', productType: 'download', priceTaxIncluded: 11000 });
  app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(quotesRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('quotesRoutes', () => {
  it('GET /api/quotes: 空リストを返す', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/quotes' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST → GET → PUT → PATCH status → DELETE の HTTP往復', async () => {
    // POST
    const created = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      payload: {
        quoteNo: 'Q-ROUTE-001',
        issuedAt: '2026-06-20',
        validUntil: '2026-07-20',
        items: [{ productId: 1, quantity: 2, unitPriceTaxIncluded: 5000 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.quoteNo).toBe('Q-ROUTE-001');
    expect(body.status).toBe('draft');
    expect(body.subtotalTaxIncluded).toBe(10000);

    // GET by id
    const fetched = await app.inject({ method: 'GET', url: `/api/quotes/${body.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().quoteNo).toBe('Q-ROUTE-001');

    // GET list
    const list = await app.inject({ method: 'GET', url: '/api/quotes' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    // PUT
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/quotes/${body.id}`,
      payload: { note: '更新メモ', validUntil: '2026-08-01' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().note).toBe('更新メモ');

    // PATCH status
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/quotes/${body.id}/status`,
      payload: { status: 'sent' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe('sent');

    // DELETE
    const deleted = await app.inject({ method: 'DELETE', url: `/api/quotes/${body.id}` });
    expect(deleted.statusCode).toBe(204);

    // GET after delete → 404
    const missing = await app.inject({ method: 'GET', url: `/api/quotes/${body.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('POST /api/quotes: 必須フィールド欠落は 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      payload: { issuedAt: '2026-06-20' }, // quoteNo 欠落
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_payload');
  });

  it('POST /api/quotes: 金額負値は 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      payload: {
        quoteNo: 'Q-NEG',
        issuedAt: '2026-06-20',
        items: [{ quantity: 1, unitPriceTaxIncluded: -500 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_payload');
  });

  it('GET /api/quotes/:id: 不正IDは 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/quotes/abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_id');
  });

  it('GET /api/quotes/:id: 存在しないIDは 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/quotes/9999' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('PUT /api/quotes/:id: 存在しないIDは 404', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/quotes/9999',
      payload: { note: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/quotes/:id: 存在しないIDは 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/quotes/9999' });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/quotes/:id/status: status 未指定は 400', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      payload: { quoteNo: 'Q-ST', issuedAt: '2026-06-20' },
    });
    const id = created.json().id as number;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/quotes/${id}/status`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /api/quotes/:id/status: 不正ステータスは 400', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      payload: { quoteNo: 'Q-BADST', issuedAt: '2026-06-20' },
    });
    const id = created.json().id as number;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/quotes/${id}/status`,
      payload: { status: 'invalid_status_xyz' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/quotes/:id/convert: 成功で {quote, order} を返す', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      payload: {
        quoteNo: 'Q-CONV',
        issuedAt: '2026-06-20',
        items: [{ productId: 1, quantity: 3, unitPriceTaxIncluded: 2000 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;

    const convert = await app.inject({ method: 'POST', url: `/api/quotes/${id}/convert` });
    expect(convert.statusCode).toBe(200);
    const result = convert.json();
    expect(result.quote.status).toBe('converted');
    expect(result.quote.convertedOrderId).toBe(result.order.id);
    expect(result.order.subtotalTaxIncluded).toBe(6000);
  });

  it('POST /api/quotes/:id/convert: 変換済みは 400 cannot_convert', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      payload: {
        quoteNo: 'Q-CONV2',
        issuedAt: '2026-06-20',
        items: [{ productId: 1, quantity: 1, unitPriceTaxIncluded: 1000 }],
      },
    });
    const id = created.json().id as number;
    await app.inject({ method: 'POST', url: `/api/quotes/${id}/convert` });

    const res = await app.inject({ method: 'POST', url: `/api/quotes/${id}/convert` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('cannot_convert');
  });

  it('POST /api/quotes/:id/convert: 自由記述行ありは 400 cannot_convert', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/quotes',
      payload: {
        quoteNo: 'Q-FREE',
        issuedAt: '2026-06-20',
        items: [
          { productId: 1, quantity: 1, unitPriceTaxIncluded: 1000 },
          { description: '自由記述', quantity: 1, unitPriceTaxIncluded: 500 },
        ],
      },
    });
    const id = created.json().id as number;

    const res = await app.inject({ method: 'POST', url: `/api/quotes/${id}/convert` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('cannot_convert');
  });

  it('POST /api/quotes/:id/convert: 存在しないIDは 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/quotes/9999/convert' });
    expect(res.statusCode).toBe(404);
  });
});
