import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { backupRoutes } from '../src/routes/backup.js';
import type { ServerConfig } from '../src/config.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    config: ServerConfig;
  }
}

let app: FastifyInstance;
let db: DB;
let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'free-worker-backup-route-'));
  const dbFile = join(tempDir, 'free-worker.sqlite');
  db = bootstrap({ filename: dbFile });
  seedProduct(db);
  app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('config', {
    host: '127.0.0.1',
    port: 4319,
    dataDir: tempDir,
    dbFile,
    webDistDir: join(tempDir, 'web-dist'),
  });
  await app.register(backupRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('backupRoutes', () => {
  it('creates encrypted backups, lists history, and records restore test logs', async () => {
    const passphrase = 'route-passphrase';
    const created = await app.inject({
      method: 'POST',
      url: '/api/backup',
      payload: { passphrase, note: 'manual route backup' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(passphrase);
    const backup = created.json<{
      id: number;
      filePath: string;
      sha256: string;
      sizeBytes: number;
      encrypted: boolean;
      kind: string;
      note: string;
    }>();
    expect(backup).toMatchObject({
      id: expect.any(Number),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      encrypted: true,
      kind: 'manual',
      note: 'manual route backup',
    });
    expect(existsSync(backup.filePath)).toBe(true);
    expect(backup.sizeBytes).toBeGreaterThan(0);

    const history = await app.inject({ method: 'GET', url: '/api/backup' });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toHaveLength(1);
    expect(history.body).not.toContain(passphrase);

    const success = await app.inject({
      method: 'POST',
      url: '/api/backup/restore-test',
      payload: { filePath: backup.filePath, passphrase },
    });
    expect(success.statusCode).toBe(200);
    expect(success.body).not.toContain(passphrase);
    expect(success.json()).toMatchObject({
      backupId: backup.id,
      result: 'success',
      integrityCheck: 'ok',
      restoredRowCounts: expect.objectContaining({ products: 1 }),
    });

    const failure = await app.inject({
      method: 'POST',
      url: '/api/backup/restore-test',
      payload: { filePath: backup.filePath, passphrase: 'wrong-passphrase' },
    });
    expect(failure.statusCode).toBe(200);
    expect(failure.body).not.toContain('wrong-passphrase');
    expect(failure.json()).toMatchObject({
      backupId: backup.id,
      result: 'failure',
      integrityCheck: null,
      restoredRowCounts: null,
    });

    const logs = db
      .prepare('SELECT result FROM restore_test_logs ORDER BY id ASC')
      .all() as Array<{ result: string }>;
    expect(logs.map((row) => row.result)).toEqual(['success', 'failure']);
  });

  it('returns 400 for invalid backup payloads', async () => {
    const missingPassphrase = await app.inject({
      method: 'POST',
      url: '/api/backup',
      payload: {},
    });
    expect(missingPassphrase.statusCode).toBe(400);

    const invalidKind = await app.inject({
      method: 'POST',
      url: '/api/backup',
      payload: { passphrase: 'valid-passphrase', kind: 'external' },
    });
    expect(invalidKind.statusCode).toBe(400);
  });
});

function seedProduct(db: DB): void {
  db.prepare(
    `INSERT INTO products (sku, title, product_type, price_tax_included)
     VALUES (?, ?, ?, ?)`,
  ).run('ROUTE-BK-001', 'Route Backup Product', 'download', 4400);
}
