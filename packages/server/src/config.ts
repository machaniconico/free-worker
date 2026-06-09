import { resolve } from 'node:path';

/** サーバ設定。すべてローカル前提。host は 127.0.0.1 に固定(外部公開しない)。 */
export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  dbFile: string;
  webDistDir: string;
}

export function loadConfig(): ServerConfig {
  const dataDir = resolve(process.env.FREE_WORKER_DATA_DIR ?? resolve(process.cwd(), 'data'));
  const port = Number(process.env.FREE_WORKER_PORT ?? 4319);
  // host は固定。環境変数で 0.0.0.0 等に変えられないようにし、ローカル専用を担保する。
  return {
    host: '127.0.0.1',
    port: Number.isFinite(port) ? port : 4319,
    dataDir,
    dbFile: resolve(dataDir, 'free-worker.sqlite'),
    webDistDir: resolve(process.cwd(), 'packages/web/dist'),
  };
}
