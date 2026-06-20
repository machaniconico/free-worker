import { join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  createBackup,
  runRestoreTest,
  listBackupHistory,
} from '@free-worker/core';

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

type BackupKind = 'manual' | 'auto' | 'pre_restore';
const KINDS: BackupKind[] = ['manual', 'auto', 'pre_restore'];

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backup', async () => {
    return listBackupHistory(app.db);
  });

  app.post('/api/backup', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as BackupPayload;
      const passphrase = normalizePassphrase(body.passphrase);
      const kind = normalizeKind(body.kind);
      const note = normalizeOptionalString(body.note);
      const outDir = resolveOutDir(normalizeOptionalString(body.outDir), app.config.dataDir);
      const backup = createBackup(app.config.dbFile, passphrase, outDir, { kind, note });
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
      return runRestoreTest(filePath, passphrase);
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });
}

/** outDir パストラバーサルガード: 未指定は dataDir/backups、指定ありは dataDir 配下のみ許可 */
function resolveOutDir(outDir: string | null, dataDir: string): string {
  if (outDir == null) {
    return join(dataDir, 'backups');
  }
  const base = resolve(dataDir);
  const resolved = resolve(outDir);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error('outDir must be within data directory');
  }
  return resolved;
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
