import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { productRoutes } from '../src/routes/products.js';

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
  await app.register(productRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('productRoutes', () => {
  it('handles product CRUD and completeness checks via inject', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: 'ROUTE-MEM-001',
        title: '会員プラン',
        productType: 'membership',
        priceTaxIncluded: 2200,
        licenseSummary: '1契約1名',
        operatingEnvironment: 'Chrome最新版',
        refundPolicy: '初回決済から7日以内',
        status: 'active',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: expect.any(Number),
      sku: 'ROUTE-MEM-001',
      priceTaxIncluded: 2200,
      currency: 'JPY',
    });
    const productId = created.json<{ id: number }>().id;

    const plan = await app.inject({
      method: 'POST',
      url: `/api/products/${productId}/plans`,
      payload: {
        planName: '月額',
        billingPeriod: 'monthly',
        renewalPolicy: '毎月1日に税込2,200円で自動更新',
        cancellationPolicy: '更新日前日までに会員画面で解約',
        postCancelAccessPolicy: '解約月末まで閲覧可能',
      },
    });
    expect(plan.statusCode).toBe(201);
    expect(plan.json()).toMatchObject({ productId, planName: '月額', billingPeriod: 'monthly' });
    const planId = plan.json<{ id: number }>().id;

    const completeness = await app.inject({ method: 'GET', url: `/api/products/${productId}/completeness` });
    expect(completeness.statusCode).toBe(200);
    expect(completeness.json()).toMatchObject({ complete: true, warnings: [] });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      payload: { title: '会員プランPro', priceTaxIncluded: 3300 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: productId, title: '会員プランPro', priceTaxIncluded: 3300 });

    const updatedPlan = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}/plans/${planId}`,
      payload: { planName: '月額Pro', trialPolicy: '14日間無料' },
    });
    expect(updatedPlan.statusCode).toBe(200);
    expect(updatedPlan.json()).toMatchObject({ id: planId, planName: '月額Pro', trialPolicy: '14日間無料' });

    const list = await app.inject({ method: 'GET', url: '/api/products' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const deletePlan = await app.inject({ method: 'DELETE', url: `/api/products/${productId}/plans/${planId}` });
    expect(deletePlan.statusCode).toBe(204);

    const deleteProduct = await app.inject({ method: 'DELETE', url: `/api/products/${productId}` });
    expect(deleteProduct.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/products/${productId}` });
    expect(missing.statusCode).toBe(404);

    const audits = db
      .prepare('SELECT action, entity_type FROM audit_logs ORDER BY id ASC')
      .all() as Array<{ action: string; entity_type: string }>;
    expect(audits).toEqual([
      { action: 'create', entity_type: 'product' },
      { action: 'create', entity_type: 'subscription_plan' },
      { action: 'update', entity_type: 'product' },
      { action: 'update', entity_type: 'subscription_plan' },
      { action: 'delete', entity_type: 'subscription_plan' },
      { action: 'delete', entity_type: 'product' },
    ]);
  });

  it('rejects non-integer prices and returns warnings for missing fields', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: 'BAD',
        title: 'Bad',
        productType: 'download',
        priceTaxIncluded: 1200.5,
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().message).toMatch(/integer yen/);

    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: 'WARN-001',
        title: '不足商品',
        productType: 'membership',
        priceTaxIncluded: 1200,
      },
    });
    expect(created.statusCode).toBe(201);
    const productId = created.json<{ id: number }>().id;

    const completeness = await app.inject({ method: 'GET', url: `/api/products/${productId}/completeness` });
    expect(completeness.statusCode).toBe(200);
    expect(completeness.json().warnings.map((warning: { field: string }) => warning.field)).toEqual([
      'operatingEnvironment',
      'licenseSummary',
      'refundPolicy',
      'subscriptionPlans',
    ]);

    const invalidId = await app.inject({ method: 'GET', url: '/api/products/not-a-number' });
    expect(invalidId.statusCode).toBe(400);
  });

  it('rejects price exceeding 1,000,000,000 (ADR-products intentional strictness)', async () => {
    const overLimit = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: 'OVER-LIMIT-001',
        title: '価格上限超過テスト',
        productType: 'download',
        priceTaxIncluded: 1_000_000_001,
      },
    });
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json().message).toMatch(/integer yen/);

    const atLimit = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: 'AT-LIMIT-001',
        title: '価格上限ちょうど',
        productType: 'download',
        priceTaxIncluded: 1_000_000_000,
      },
    });
    expect(atLimit.statusCode).toBe(201);
  });
});
