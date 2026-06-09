import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DB } from './connection.js';

/** migrations ディレクトリ(パッケージroot配下、dist/db からは ../../migrations)。 */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'migrations');
}

export interface MigrationResult {
  applied: string[];
  alreadyAtVersion: number;
}

/**
 * migrations/*.sql を昇順に適用する。冪等: 適用済みは schema_migrations でスキップ。
 * 各ファイルは1トランザクションで実行。
 */
export function migrate(db: DB, dir: string = migrationsDir()): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?');
  const record = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
  const applied: string[] = [];

  for (const file of files) {
    if (isApplied.get(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      record.run(file);
    });
    run();
    applied.push(file);
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
  return { applied, alreadyAtVersion: count.n };
}
