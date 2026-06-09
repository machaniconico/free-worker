import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { customerRoutes } from '../src/routes/customers.js';

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
  await app.register(customerRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('customerRoutes', () => {
  it('handles customer CRUD without storing plaintext email', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        displayName: 'Route 顧客',
        email: 'Route.Customer@example.com',
        notes: '最小限のメモ',
      },
    });
    expect(created.statusCode).toBe(201);
    const customer = created.json<{
      id: number;
      displayName: string;
      emailHash: string;
      emailEncrypted: string | null;
      notes: string;
    }>();
    const expectedHash = createHash('sha256').update('route.customer@example.com').digest('hex');
    expect(customer).toMatchObject({
      id: expect.any(Number),
      displayName: 'Route 顧客',
      emailHash: expectedHash,
      emailEncrypted: null,
      notes: '最小限のメモ',
    });
    expect(JSON.stringify(customer)).not.toContain('Route.Customer@example.com');

    const listed = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/customers/${customer.id}`,
      payload: { displayName: 'Route 顧客 更新', notes: null, emailEncrypted: 'local-ciphertext' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: customer.id,
      displayName: 'Route 顧客 更新',
      emailHash: expectedHash,
      emailEncrypted: 'local-ciphertext',
      notes: null,
    });

    const fetched = await app.inject({ method: 'GET', url: `/api/customers/${customer.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ id: customer.id, displayName: 'Route 顧客 更新' });

    const rawCustomer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id);
    expect(JSON.stringify(rawCustomer)).not.toContain('Route.Customer@example.com');

    const deleted = await app.inject({ method: 'DELETE', url: `/api/customers/${customer.id}` });
    expect(deleted.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/customers/${customer.id}` });
    expect(missing.statusCode).toBe(404);

    const audits = db
      .prepare('SELECT action, before_json, after_json FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('customer') as Array<{ action: string; before_json: string | null; after_json: string | null }>;
    expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    expect(JSON.stringify(audits)).not.toContain('Route.Customer@example.com');
  });

  it('grants, revokes, and returns consent history', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: { displayName: '同意Route顧客' },
    });
    const customerId = created.json<{ id: number }>().id;

    const marketing = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/consents`,
      payload: {
        consentType: 'marketing_email',
        consentedAt: '2026-06-09T10:00:00+09:00',
        source: 'settings_screen',
      },
    });
    expect(marketing.statusCode).toBe(201);
    const consentId = marketing.json<{ id: number }>().id;

    const terms = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/consents`,
      payload: {
        consentType: 'terms',
        consentedAt: '2026-06-09T09:00:00+09:00',
        source: 'checkout',
      },
    });
    expect(terms.statusCode).toBe(201);

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/consents/${consentId}/revoke`,
      payload: { revokedAt: '2026-06-10T12:00:00+09:00' },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ id: consentId, revokedAt: '2026-06-10T12:00:00+09:00' });

    const history = await app.inject({ method: 'GET', url: `/api/customers/${customerId}/consents` });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toEqual([
      expect.objectContaining({ consentType: 'terms', revokedAt: null }),
      expect.objectContaining({ consentType: 'marketing_email', revokedAt: '2026-06-10T12:00:00+09:00' }),
    ]);

    const consentAudits = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('consent') as Array<{ action: string }>;
    expect(consentAudits.map((row) => row.action)).toEqual(['create', 'create', 'update']);
  });

  it('returns validation errors for bad ids and payloads', async () => {
    const invalidId = await app.inject({ method: 'GET', url: '/api/customers/not-a-number' });
    expect(invalidId.statusCode).toBe(400);

    const invalidCustomer = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: { displayName: '' },
    });
    expect(invalidCustomer.statusCode).toBe(400);
    expect(invalidCustomer.json().message).toMatch(/displayName is required/);

    const missingConsents = await app.inject({ method: 'GET', url: '/api/customers/999/consents' });
    expect(missingConsents.statusCode).toBe(404);
  });
});
