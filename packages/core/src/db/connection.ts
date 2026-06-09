import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export interface OpenDbOptions {
  /** ファイルパス。':memory:' でインメモリ(テスト用)。 */
  filename: string;
  readonly?: boolean;
}

/**
 * SQLite 接続を開く。ローカルファースト前提のため、必ずローカルファイル or インメモリ。
 * 外部ネットワーク接続は一切行わない。
 */
export function openDb(opts: OpenDbOptions): DB {
  if (opts.filename !== ':memory:') {
    mkdirSync(dirname(opts.filename), { recursive: true });
  }
  const db = new Database(opts.filename, { readonly: opts.readonly ?? false });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
