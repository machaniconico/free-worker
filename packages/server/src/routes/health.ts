import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const row = app.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
    return {
      status: 'ok',
      offline: true,
      migrations: row.n,
      now: new Date().toISOString(),
    };
  });

  app.get('/api/app-info', async () => {
    return {
      name: 'free-worker',
      description: '個人事業主・フリーランス向けローカル業務支援(クラウドAI非依存)',
      host: app.config.host,
      port: app.config.port,
    };
  });
}
