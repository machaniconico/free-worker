import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { expenseRoutes } from '../src/routes/expenses.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  db = bootstrap({ filename: ':memory:' });
  app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(expenseRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('expenseRoutes', () => {
  it('経費CRUDを扱い監査ログを記録する', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      payload: {
        spentAt: '2026-06-09',
        vendor: '交通機関',
        category: 'travel',
        amountTaxIncluded: 880,
        taxAmount: 80,
        paymentMethod: 'ic_card',
        purpose: '打ち合わせ移動',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody).toMatchObject({
      id: expect.any(Number),
      vendor: '交通機関',
      amountTaxIncluded: 880,
      taxAmount: 80,
    });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/expenses/${createdBody.id}`,
      payload: { vendor: '鉄道', amountTaxIncluded: 990, taxAmount: 90 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: createdBody.id, vendor: '鉄道', amountTaxIncluded: 990 });

    const listed = await app.inject({ method: 'GET', url: '/api/expenses' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const fetched = await app.inject({ method: 'GET', url: `/api/expenses/${createdBody.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ category: 'travel' });

    const deleted = await app.inject({ method: 'DELETE', url: `/api/expenses/${createdBody.id}` });
    expect(deleted.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/expenses/${createdBody.id}` });
    expect(missing.statusCode).toBe(404);

    const auditActions = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('expense')
      .map((row) => (row as { action: string }).action);
    expect(auditActions).toEqual(['create', 'update', 'delete']);
  });

  it('CSV入出力と月次・カテゴリ別集計を返す', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/expenses',
      payload: {
        spentAt: '2026-06-15',
        vendor: 'ソフト会社',
        category: 'software',
        amountTaxIncluded: 3300,
        taxAmount: 300,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/expenses',
      payload: {
        spentAt: '2026-06-20',
        vendor: '文具店',
        category: 'supplies',
        amountTaxIncluded: 1100,
        taxAmount: 100,
      },
    });

    const monthly = await app.inject({ method: 'GET', url: '/api/expenses/summary?month=2026-06' });
    expect(monthly.statusCode).toBe(200);
    expect(monthly.json()).toEqual([{ month: '2026-06', amountTaxIncluded: 4400, taxAmount: 400, expenseCount: 2 }]);

    const category = await app.inject({ method: 'GET', url: '/api/expenses/summary?groupBy=category&month=2026-06' });
    expect(category.statusCode).toBe(200);
    expect(category.json()).toEqual([
      { category: 'software', amountTaxIncluded: 3300, taxAmount: 300, expenseCount: 1 },
      { category: 'supplies', amountTaxIncluded: 1100, taxAmount: 100, expenseCount: 1 },
    ]);

    const exported = await app.inject({ method: 'GET', url: '/api/expenses/export' });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain('ソフト会社');

    const imported = await app.inject({
      method: 'POST',
      url: '/api/expenses/import',
      payload: { csv: `${exported.body}\r\n,2026-06-22,書店,books,2200,200,cash,資料,` },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toEqual({ imported: 3, created: 1, updated: 2 });

    const list = await app.inject({ method: 'GET', url: '/api/expenses' });
    expect(list.json()).toHaveLength(3);
  });

  it('非整数金額と不正idは400', async () => {
    const invalidAmount = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      payload: {
        spentAt: '2026-06-09',
        category: 'software',
        amountTaxIncluded: 1200.5,
      },
    });
    expect(invalidAmount.statusCode).toBe(400);
    expect(invalidAmount.json().message).toMatch(/amountTaxIncluded must be an integer/);

    const invalidId = await app.inject({ method: 'GET', url: '/api/expenses/not-a-number' });
    expect(invalidId.statusCode).toBe(400);
  });
});
