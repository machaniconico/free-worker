import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import { openDb } from '../src/db/connection.js';
import { createBackup, restoreBackup, runRestoreTest } from '../src/services/backup.js';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('encrypted local backup service', () => {
  it('creates an encrypted backup and restores it to a separate database file', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'free-worker.sqlite');
    const outDir = join(dir, 'backups');
    const restorePath = join(dir, 'restored.sqlite');

    const db = bootstrap({ filename: dbPath });
    seedProduct(db);
    db.close();

    const backup = createBackup(dbPath, 'correct horse battery staple', outDir);
    expect(backup).toMatchObject({
      id: expect.any(Number),
      encrypted: true,
      kind: 'manual',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      sizeBytes: expect.any(Number),
    });
    expect(existsSync(backup.filePath)).toBe(true);
    expect(backup.sizeBytes).toBe(statSync(backup.filePath).size);
    expect(backup.sha256).toBe(createHash('sha256').update(readFileSync(backup.filePath)).digest('hex'));
    expect(readFileSync(backup.filePath).equals(readFileSync(dbPath))).toBe(false);

    const source = openDb({ filename: dbPath });
    const history = source.prepare('SELECT sha256, size_bytes, encrypted, kind FROM backup_history').get() as {
      sha256: string;
      size_bytes: number;
      encrypted: number;
      kind: string;
    };
    source.close();
    expect(history).toEqual({
      sha256: backup.sha256,
      size_bytes: backup.sizeBytes,
      encrypted: 1,
      kind: 'manual',
    });

    restoreBackup(backup.filePath, 'correct horse battery staple', restorePath);
    const restored = openDb({ filename: restorePath });
    try {
      const product = restored.prepare('SELECT sku, title, price_tax_included FROM products').get() as {
        sku: string;
        title: string;
        price_tax_included: number;
      };
      expect(product).toEqual({ sku: 'BK-001', title: 'バックアップ商品', price_tax_included: 3300 });
    } finally {
      restored.close();
    }
  });

  it('records success and failure restore test logs without exposing the passphrase', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'free-worker.sqlite');
    const outDir = join(dir, 'backups');

    const db = bootstrap({ filename: dbPath });
    seedProduct(db);
    db.close();

    const backup = createBackup(dbPath, 'restore-test-passphrase', outDir);
    const success = runRestoreTest(backup.filePath, 'restore-test-passphrase');
    expect(success).toMatchObject({
      backupId: backup.id,
      result: 'success',
      integrityCheck: 'ok',
      restoredRowCounts: expect.objectContaining({ products: 1 }),
    });

    const failure = runRestoreTest(backup.filePath, 'wrong-passphrase');
    expect(failure).toMatchObject({
      backupId: backup.id,
      result: 'failure',
      integrityCheck: null,
      restoredRowCounts: null,
    });
    expect(failure.message).not.toContain('wrong-passphrase');

    const source = openDb({ filename: dbPath });
    try {
      const logs = source
        .prepare('SELECT result, integrity_check, restored_row_counts, message FROM restore_test_logs ORDER BY id ASC')
        .all() as Array<{
        result: string;
        integrity_check: string | null;
        restored_row_counts: string | null;
        message: string | null;
      }>;
      expect(logs).toHaveLength(2);
      expect(logs[0]?.result).toBe('success');
      expect(JSON.parse(logs[0]?.restored_row_counts ?? '{}')).toMatchObject({ products: 1 });
      expect(logs[1]?.result).toBe('failure');
      expect(logs[1]?.message).not.toContain('wrong-passphrase');
    } finally {
      source.close();
    }
  });
  it('ヘッダ(sourceDbPath)を改竄したバックアップは復元時に認証失敗する', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'free-worker.sqlite');
    const outDir = join(dir, 'backups');
    const restorePath = join(dir, 'restored.sqlite');

    const db = bootstrap({ filename: dbPath });
    seedProduct(db);
    db.close();

    const backup = createBackup(dbPath, 'tamper-proof-passphrase', outDir);

    // ファイル内のヘッダJSON(sourceDbPath)を別パスへ書き換える。
    // ヘッダ長を変えないよう 'free'(4B) を 'evil'(4B) に同一長で上書きする。
    const raw = readFileSync(backup.filePath);
    const idx = raw.indexOf(Buffer.from('free-worker.sqlite'));
    expect(idx).toBeGreaterThan(0);
    Buffer.from('evil').copy(raw, idx);
    writeFileSync(backup.filePath, raw);

    // AAD 認証によりヘッダ改竄は GCM タグ不一致として検知され、復元は失敗する。
    expect(() => restoreBackup(backup.filePath, 'tamper-proof-passphrase', restorePath)).toThrow();
    expect(existsSync(restorePath)).toBe(false);

    const failure = runRestoreTest(backup.filePath, 'tamper-proof-passphrase');
    expect(failure.result).toBe('failure');
  });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'free-worker-backup-'));
  tempDirs.push(dir);
  return dir;
}

function seedProduct(db: ReturnType<typeof bootstrap>): void {
  db.prepare(
    `INSERT INTO products (sku, title, product_type, price_tax_included)
     VALUES (?, ?, ?, ?)`,
  ).run('BK-001', 'バックアップ商品', 'download', 3300);
}
