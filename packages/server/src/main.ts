import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} 受信。終了します。`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`free-worker 起動: http://${config.host}:${config.port} (オフライン動作・クラウドAI非依存)`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
