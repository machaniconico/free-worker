import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, writeAudit, type DB } from '@free-worker/core';
import { auditRoutes } from '../src/routes/audit.js';

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
  await app.register(auditRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('auditRoutes', () => {
  it('監査ログを一覧しフィルタできる', async () => {
    seedAuditLogs();

    const all = await app.inject({ method: 'GET', url: '/api/audit' });
    expect(all.statusCode).toBe(200);
    expect(all.json().map((entry: { action: string }) => entry.action)).toEqual(['delete', 'update', 'create']);

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/audit?entity_type=expense&action=update&from=2026-06-01%2000:00:00&to=2026-06-30%2023:59:59',
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject([
      {
        actor: 'owner',
        action: 'update',
        entityType: 'expense',
        entityId: '2',
        createdAt: '2026-06-10 10:00:00',
      },
    ]);
  });

  it('監査ログをCSV出力できる', async () => {
    seedAuditLogs();

    const exported = await app.inject({ method: 'GET', url: '/api/audit/export?entityType=expense' });

    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain('id,createdAt,actor,action,entityType,entityId,beforeJson,afterJson');
    expect(exported.body).toContain('2026-06-10 10:00:00,owner,update,expense,2');
    expect(exported.body).toContain('2026-07-01 11:00:00,system,delete,expense,3');
    expect(exported.body).not.toContain('customer');
  });
});

function seedAuditLogs(): void {
  writeAudit(db, {
    actor: 'owner',
    action: 'create',
    entityType: 'customer',
    entityId: 1,
    after: { displayName: '合成顧客A' },
  });
  writeAudit(db, {
    actor: 'owner',
    action: 'update',
    entityType: 'expense',
    entityId: 2,
    before: { amountTaxIncluded: 1000 },
    after: { amountTaxIncluded: 1200 },
  });
  writeAudit(db, {
    actor: 'system',
    action: 'delete',
    entityType: 'expense',
    entityId: 3,
    before: { amountTaxIncluded: 500 },
  });

  const ids = db.prepare('SELECT id FROM audit_logs ORDER BY id ASC').all() as { id: number }[];
  db.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?').run('2026-06-01 09:00:00', ids[0]!.id);
  db.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?').run('2026-06-10 10:00:00', ids[1]!.id);
  db.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?').run('2026-07-01 11:00:00', ids[2]!.id);
}
