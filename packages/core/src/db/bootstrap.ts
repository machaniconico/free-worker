import { openDb, type DB, type OpenDbOptions } from './connection.js';
import { migrate } from './migrate.js';
import { seedSources } from '../seed.js';

export interface BootstrapOptions extends OpenDbOptions {
  /** 出典(S1..S15)を投入する。既定 true。 */
  seed?: boolean;
}

/**
 * DBを開き、マイグレーションを適用し、基本シード(出典)を投入する。
 * アプリ/テストの共通エントリ。ネットワークアクセスは一切しない。
 */
export function bootstrap(opts: BootstrapOptions): DB {
  const db = openDb(opts);
  migrate(db);
  if (opts.seed ?? true) {
    seedSources(db);
  }
  return db;
}
