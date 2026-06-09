import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { migrate, openDb, type DB } from '@free-worker/core';

type BackupKind = 'manual' | 'auto' | 'pre_restore';
type RestoreTestResult = 'success' | 'failure';

interface BackupPayload {
  passphrase?: unknown;
  outDir?: unknown;
  kind?: unknown;
  note?: unknown;
}

interface RestoreTestPayload {
  filePath?: unknown;
  passphrase?: unknown;
}

interface BackupHeader {
  version: 1;
  algorithm: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  iv: string;
  sourceDbPath: string;
  createdAt: string;
}

interface ParsedBackupFile {
  header: BackupHeader;
  ciphertext: Buffer;
  authTag: Buffer;
}

interface BackupHistoryRow {
  id: number;
  file_path: string;
  sha256: string;
  size_bytes: number;
  encrypted: number;
  kind: BackupKind;
  note: string | null;
  created_at: string;
}

interface RestoreTestLogRow {
  id: number;
  backup_id: number | null;
  backup_file: string;
  result: RestoreTestResult;
  integrity_check: string | null;
  restored_row_counts: string | null;
  message: string | null;
  tested_at: string;
}

const MAGIC = Buffer.from('FWBKP001');
const HEADER_LENGTH_BYTES = 4;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const SALT_BYTES = 32;
const IV_BYTES = 12;
const KINDS: BackupKind[] = ['manual', 'auto', 'pre_restore'];
const MAIN_TABLES = [
  'business_profiles',
  'products',
  'subscription_plans',
  'orders',
  'order_items',
  'invoices',
  'audit_logs',
  'backup_history',
  'restore_test_logs',
];

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backup', async () => {
    return listHistory(app.db);
  });

  app.post('/api/backup', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as BackupPayload;
      const passphrase = normalizePassphrase(body.passphrase);
      const kind = normalizeKind(body.kind);
      const note = normalizeOptionalString(body.note);
      const outDir = normalizeOptionalString(body.outDir) ?? join(app.config.dataDir, 'backups');
      const backup = createRouteBackup(app.config.dbFile, passphrase, outDir, kind, note);
      reply.code(201);
      return backup;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.post('/api/backup/restore-test', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as RestoreTestPayload;
      const filePath = normalizeRequiredString(body.filePath, 'filePath');
      const passphrase = normalizePassphrase(body.passphrase);
      return runRouteRestoreTest(filePath, passphrase);
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });
}

function createRouteBackup(
  dbPath: string,
  passphrase: string,
  outDir: string,
  kind: BackupKind,
  note: string | null,
): ReturnType<typeof mapBackupHistory> {
  const sourceDbPath = resolve(dbPath);
  if (!existsSync(sourceDbPath)) {
    throw new Error('database file not found');
  }
  const backupDir = resolve(outDir);
  mkdirSync(backupDir, { recursive: true });
  checkpointDatabase(sourceDbPath);

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(readFileSync(sourceDbPath)), cipher.final()]);
  const backupPath = join(backupDir, `free-worker-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite.fwbak`);
  writeBackupFile(
    backupPath,
    {
      version: 1,
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      sourceDbPath,
      createdAt: new Date().toISOString(),
    },
    ciphertext,
    cipher.getAuthTag(),
  );

  const sizeBytes = statSync(backupPath).size;
  const sha256 = createHash('sha256').update(readFileSync(backupPath)).digest('hex');
  const db = openDb({ filename: sourceDbPath });
  try {
    const row = db
      .prepare(
        `INSERT INTO backup_history (file_path, sha256, size_bytes, encrypted, kind, note)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(backupPath, sha256, sizeBytes, 1, kind, note) as BackupHistoryRow;
    return mapBackupHistory(row);
  } finally {
    db.close();
  }
}

function runRouteRestoreTest(file: string, passphrase: string): ReturnType<typeof mapRestoreTestLog> {
  const backupFile = resolve(file);
  let sourceDbPath: string | null = null;
  let backupId: number | null = null;
  let tempPath: string | null = null;

  try {
    const parsed = parseBackupFile(backupFile);
    sourceDbPath = parsed.header.sourceDbPath;
    backupId = findBackupId(sourceDbPath, backupFile);
    tempPath = join(tmpdir(), `${basename(backupFile)}-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`);
    restoreRouteBackup(parsed, passphrase, tempPath);
    const db = openDb({ filename: tempPath });
    try {
      migrate(db);
      const integrityCheck = readIntegrityCheck(db);
      if (integrityCheck !== 'ok') {
        return recordRestoreTest(sourceDbPath, backupId, backupFile, 'failure', integrityCheck, null, integrityCheck);
      }
      return recordRestoreTest(sourceDbPath, backupId, backupFile, 'success', integrityCheck, countMainTables(db), null);
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'restore test failed';
    return recordRestoreTest(sourceDbPath, backupId, backupFile, 'failure', null, null, message.replace(/\s+/g, ' ').slice(0, 500));
  } finally {
    if (tempPath) cleanupSqliteFiles(tempPath);
  }
}

function listHistory(db: DB): ReturnType<typeof mapBackupHistory>[] {
  return db
    .prepare('SELECT * FROM backup_history ORDER BY id DESC')
    .all()
    .map((row) => mapBackupHistory(row as BackupHistoryRow));
}

function normalizePassphrase(value: unknown): string {
  const passphrase = normalizeRequiredString(value, 'passphrase');
  if (passphrase.length < 8) {
    throw new Error('passphrase must be at least 8 characters');
  }
  return passphrase;
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
  return value;
}

function normalizeOptionalString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('expected string');
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeKind(value: unknown): BackupKind {
  if (value == null) return 'manual';
  if (typeof value !== 'string' || !KINDS.includes(value as BackupKind)) {
    throw new Error('invalid kind');
  }
  return value as BackupKind;
}

function invalidPayload(error: unknown): { error: 'invalid_payload'; message: string } {
  return {
    error: 'invalid_payload',
    message: error instanceof Error ? error.message : 'invalid payload',
  };
}

function checkpointDatabase(dbPath: string): void {
  const db = openDb({ filename: dbPath });
  try {
    migrate(db);
    db.pragma('wal_checkpoint(FULL)');
  } finally {
    db.close();
  }
}

function writeBackupFile(path: string, header: BackupHeader, ciphertext: Buffer, authTag: Buffer): void {
  const headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  const headerLength = Buffer.alloc(HEADER_LENGTH_BYTES);
  headerLength.writeUInt32BE(headerJson.length, 0);
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeSync(fd, MAGIC);
    writeSync(fd, headerLength);
    writeSync(fd, headerJson);
    writeSync(fd, ciphertext);
    writeSync(fd, authTag);
  } finally {
    closeSync(fd);
  }
}

function parseBackupFile(path: string): ParsedBackupFile {
  const contents = readFileSync(path);
  if (contents.length < MAGIC.length + HEADER_LENGTH_BYTES + AUTH_TAG_BYTES) {
    throw new Error('invalid backup file');
  }
  if (!contents.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('invalid backup file');
  }
  const headerLengthOffset = MAGIC.length;
  const headerLength = contents.readUInt32BE(headerLengthOffset);
  const headerStart = headerLengthOffset + HEADER_LENGTH_BYTES;
  const headerEnd = headerStart + headerLength;
  const authTagStart = contents.length - AUTH_TAG_BYTES;
  if (headerLength <= 0 || headerEnd > authTagStart) {
    throw new Error('invalid backup file');
  }
  const header = JSON.parse(contents.subarray(headerStart, headerEnd).toString('utf8')) as BackupHeader;
  validateHeader(header);
  return {
    header,
    ciphertext: contents.subarray(headerEnd, authTagStart),
    authTag: contents.subarray(authTagStart),
  };
}

function restoreRouteBackup(parsed: ParsedBackupFile, passphrase: string, targetPath: string): void {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(passphrase, Buffer.from(parsed.header.salt, 'base64')),
    Buffer.from(parsed.header.iv, 'base64'),
  );
  decipher.setAuthTag(parsed.authTag);
  const plainDb = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
  const resolvedTarget = resolve(targetPath);
  mkdirSync(dirname(resolvedTarget), { recursive: true });
  const tempPath = `${resolvedTarget}.tmp`;
  writeFileSyncMode600(tempPath, plainDb);
  renameSync(tempPath, resolvedTarget);
}

function writeFileSyncMode600(path: string, contents: Buffer): void {
  const fd = openSync(path, 'w', 0o600);
  try {
    writeSync(fd, contents);
  } finally {
    closeSync(fd);
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_BYTES);
}

function validateHeader(header: BackupHeader): void {
  if (
    header.version !== 1 ||
    header.algorithm !== 'aes-256-gcm' ||
    header.kdf !== 'scrypt' ||
    typeof header.salt !== 'string' ||
    typeof header.iv !== 'string' ||
    typeof header.sourceDbPath !== 'string'
  ) {
    throw new Error('invalid backup file');
  }
}

function findBackupId(sourceDbPath: string, backupFile: string): number | null {
  if (!existsSync(sourceDbPath)) return null;
  const db = openDb({ filename: sourceDbPath });
  try {
    const row = db.prepare('SELECT id FROM backup_history WHERE file_path = ?').get(backupFile) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  } finally {
    db.close();
  }
}

function readIntegrityCheck(db: DB): string {
  const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  return row.integrity_check;
}

function countMainTables(db: DB): Record<string, number> {
  const counts: Record<string, number> = {};
  const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  for (const table of MAIN_TABLES) {
    if (!tableExists.get(table)) continue;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    counts[table] = row.n;
  }
  return counts;
}

function recordRestoreTest(
  sourceDbPath: string | null,
  backupId: number | null,
  backupFile: string,
  result: RestoreTestResult,
  integrityCheck: string | null,
  restoredRowCounts: Record<string, number> | null,
  message: string | null,
): ReturnType<typeof mapRestoreTestLog> {
  if (!sourceDbPath || !existsSync(sourceDbPath)) {
    return {
      id: 0,
      backupId,
      backupFile,
      result,
      integrityCheck,
      restoredRowCounts,
      message,
      testedAt: new Date().toISOString(),
    };
  }
  const db = openDb({ filename: sourceDbPath });
  try {
    const row = db
      .prepare(
        `INSERT INTO restore_test_logs
          (backup_id, backup_file, result, integrity_check, restored_row_counts, message)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(backupId, backupFile, result, integrityCheck, restoredRowCounts ? JSON.stringify(restoredRowCounts) : null, message) as
      RestoreTestLogRow;
    return mapRestoreTestLog(row);
  } finally {
    db.close();
  }
}

function cleanupSqliteFiles(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(candidate, { force: true });
  }
}

function mapBackupHistory(row: BackupHistoryRow): {
  id: number;
  filePath: string;
  sha256: string;
  sizeBytes: number;
  encrypted: boolean;
  kind: BackupKind;
  note: string | null;
  createdAt: string;
} {
  return {
    id: row.id,
    filePath: row.file_path,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    encrypted: row.encrypted === 1,
    kind: row.kind,
    note: row.note,
    createdAt: row.created_at,
  };
}

function mapRestoreTestLog(row: RestoreTestLogRow): {
  id: number;
  backupId: number | null;
  backupFile: string;
  result: RestoreTestResult;
  integrityCheck: string | null;
  restoredRowCounts: Record<string, number> | null;
  message: string | null;
  testedAt: string;
} {
  return {
    id: row.id,
    backupId: row.backup_id,
    backupFile: row.backup_file,
    result: row.result,
    integrityCheck: row.integrity_check,
    restoredRowCounts: row.restored_row_counts ? (JSON.parse(row.restored_row_counts) as Record<string, number>) : null,
    message: row.message,
    testedAt: row.tested_at,
  };
}
