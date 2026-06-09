import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb, type DB } from '../db/connection.js';
import { migrate } from '../db/migrate.js';

export type BackupKind = 'manual' | 'auto' | 'pre_restore';
export type RestoreTestResult = 'success' | 'failure';

export interface CreateBackupOptions {
  kind?: BackupKind;
  note?: string | null;
}

export interface BackupHistoryEntry {
  id: number;
  filePath: string;
  sha256: string;
  sizeBytes: number;
  encrypted: boolean;
  kind: BackupKind;
  note: string | null;
  createdAt: string;
}

export interface RestoreTestLog {
  id: number;
  backupId: number | null;
  backupFile: string;
  result: RestoreTestResult;
  integrityCheck: string | null;
  restoredRowCounts: Record<string, number> | null;
  message: string | null;
  testedAt: string;
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

export function createBackup(
  dbPath: string,
  passphrase: string,
  outDir: string,
  options: CreateBackupOptions = {},
): BackupHistoryEntry {
  assertUsablePassphrase(passphrase);
  if (!existsSync(dbPath)) {
    throw new Error(`database file not found: ${dbPath}`);
  }

  const sourceDbPath = resolve(dbPath);
  const backupDir = resolve(outDir);
  mkdirSync(backupDir, { recursive: true });
  checkpointDatabase(sourceDbPath);

  const plainDb = readFileSync(sourceDbPath);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainDb), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const backupPath = join(backupDir, `${backupBaseName()}-${randomBytes(4).toString('hex')}.sqlite.fwbak`);
  const header: BackupHeader = {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    sourceDbPath,
    createdAt: new Date().toISOString(),
  };
  writeBackupFile(backupPath, header, ciphertext, authTag);

  const sizeBytes = statSync(backupPath).size;
  const sha256 = sha256File(backupPath);
  const db = openDb({ filename: sourceDbPath });
  try {
    const row = db
      .prepare(
        `INSERT INTO backup_history (file_path, sha256, size_bytes, encrypted, kind, note)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(backupPath, sha256, sizeBytes, 1, options.kind ?? 'manual', options.note ?? null) as BackupHistoryRow;
    return mapBackupHistory(row);
  } finally {
    db.close();
  }
}

export function restoreBackup(file: string, passphrase: string, targetPath: string): void {
  assertUsablePassphrase(passphrase);
  const parsed = parseBackupFile(file);
  const plainDb = decryptBackup(parsed, passphrase);
  const resolvedTarget = resolve(targetPath);
  mkdirSync(dirname(resolvedTarget), { recursive: true });
  const tempPath = `${resolvedTarget}.restore-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tempPath, plainDb, { mode: 0o600 });
  renameSync(tempPath, resolvedTarget);
}

export function runRestoreTest(file: string, passphrase: string): RestoreTestLog {
  const backupFile = resolve(file);
  let sourceDbPath: string | null = null;
  let backupId: number | null = null;
  let tempPath: string | null = null;

  try {
    const parsed = parseBackupFile(backupFile);
    sourceDbPath = parsed.header.sourceDbPath;
    backupId = findBackupId(sourceDbPath, backupFile);
    tempPath = join(tmpdir(), `${basename(backupFile)}-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`);
    restoreBackup(backupFile, passphrase, tempPath);

    const db = openDb({ filename: tempPath });
    try {
      migrate(db);
      const integrityCheck = readIntegrityCheck(db);
      if (integrityCheck !== 'ok') {
        return recordRestoreTest(sourceDbPath, {
          backupId,
          backupFile,
          result: 'failure',
          integrityCheck,
          restoredRowCounts: null,
          message: `integrity_check failed: ${integrityCheck}`,
        });
      }
      return recordRestoreTest(sourceDbPath, {
        backupId,
        backupFile,
        result: 'success',
        integrityCheck,
        restoredRowCounts: countMainTables(db),
        message: null,
      });
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'restore test failed';
    return recordRestoreTest(sourceDbPath, {
      backupId,
      backupFile,
      result: 'failure',
      integrityCheck: null,
      restoredRowCounts: null,
      message: sanitizeFailureMessage(message),
    });
  } finally {
    if (tempPath) {
      cleanupSqliteFiles(tempPath);
    }
  }
}

export function listBackupHistory(db: DB): BackupHistoryEntry[] {
  return db
    .prepare('SELECT * FROM backup_history ORDER BY id DESC')
    .all()
    .map((row) => mapBackupHistory(row as BackupHistoryRow));
}

export function listRestoreTestLogs(db: DB): RestoreTestLog[] {
  return db
    .prepare('SELECT * FROM restore_test_logs ORDER BY id DESC')
    .all()
    .map((row) => mapRestoreTestLog(row as RestoreTestLogRow));
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

function decryptBackup(parsed: ParsedBackupFile, passphrase: string): Buffer {
  const key = deriveKey(passphrase, Buffer.from(parsed.header.salt, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.header.iv, 'base64'));
  decipher.setAuthTag(parsed.authTag);
  return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_BYTES);
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function backupBaseName(): string {
  return `free-worker-${new Date().toISOString().replace(/[:.]/g, '-')}`;
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

function assertUsablePassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('passphrase must be at least 8 characters');
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
  input: {
    backupId: number | null;
    backupFile: string;
    result: RestoreTestResult;
    integrityCheck: string | null;
    restoredRowCounts: Record<string, number> | null;
    message: string | null;
  },
): RestoreTestLog {
  if (!sourceDbPath || !existsSync(sourceDbPath)) {
    return {
      id: 0,
      backupId: input.backupId,
      backupFile: input.backupFile,
      result: input.result,
      integrityCheck: input.integrityCheck,
      restoredRowCounts: input.restoredRowCounts,
      message: input.message,
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
      .get(
        input.backupId,
        input.backupFile,
        input.result,
        input.integrityCheck,
        input.restoredRowCounts ? JSON.stringify(input.restoredRowCounts) : null,
        input.message,
      ) as RestoreTestLogRow;
    return mapRestoreTestLog(row);
  } finally {
    db.close();
  }
}

function sanitizeFailureMessage(message: string): string {
  return message.replace(/\s+/g, ' ').slice(0, 500);
}

function cleanupSqliteFiles(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(candidate, { force: true });
  }
}

function mapBackupHistory(row: BackupHistoryRow): BackupHistoryEntry {
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

function mapRestoreTestLog(row: RestoreTestLogRow): RestoreTestLog {
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
