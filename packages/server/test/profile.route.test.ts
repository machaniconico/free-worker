import { afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { bootstrap, type DB } from '@free-worker/core';
import { profileRoutes } from '../src/routes/profile.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

const db = bootstrap({ filename: ':memory:' });
const app = Fastify({ logger: false });
app.decorate('db', db);
app.register(profileRoutes);

afterAll(async () => {
  await app.close();
});

describe('profile routes', () => {
  it('creates, lists, gets, updates, and deletes business profiles', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: {
        tradeName: 'Route Studio',
        legalNamePublicPolicy: '公開名',
        businessStartDate: '2026-02-01',
        taxOffice: '品川税務署',
        blueReturnEnabled: true,
        invoiceRegistrationNumber: 'T9876543210987',
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      id: expect.any(Number),
      tradeName: 'Route Studio',
      blueReturnEnabled: true,
    });
    const id = create.json<{ id: number }>().id;

    const list = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const get = await app.inject({ method: 'GET', url: `/api/profile/${id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ id, tradeName: 'Route Studio' });

    const update = await app.inject({
      method: 'PUT',
      url: `/api/profile/${id}`,
      payload: {
        tradeName: 'Route Design',
        businessStartDate: null,
        blueReturnEnabled: false,
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      id,
      tradeName: 'Route Design',
      businessStartDate: null,
      blueReturnEnabled: false,
    });

    const del = await app.inject({ method: 'DELETE', url: `/api/profile/${id}` });
    expect(del.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/profile/${id}` });
    expect(missing.statusCode).toBe(404);

    const audits = db
      .prepare(
        `SELECT action, entity_type, entity_id
         FROM audit_logs
         WHERE entity_type = ?
         ORDER BY id ASC`,
      )
      .all('business_profile') as Array<{ action: string; entity_type: string; entity_id: string }>;
    expect(audits).toEqual([
      { action: 'create', entity_type: 'business_profile', entity_id: String(id) },
      { action: 'update', entity_type: 'business_profile', entity_id: String(id) },
      { action: 'delete', entity_type: 'business_profile', entity_id: String(id) },
    ]);
  });

  it('returns 400 for invalid payloads and 404 for missing records', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: { tradeName: '' },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'PUT',
      url: '/api/profile/999999',
      payload: { tradeName: 'missing' },
    });
    expect(missing.statusCode).toBe(404);

    const invalidId = await app.inject({ method: 'GET', url: '/api/profile/not-a-number' });
    expect(invalidId.statusCode).toBe(400);
  });
});
