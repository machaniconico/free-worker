import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { bootstrap, type DB } from '@free-worker/core';
import { type ServerConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSettingsRoutes } from './routes/settings.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    config: ServerConfig;
  }
}

/**
 * Fastify アプリを構築する(listen はしない)。テストから差し込めるよう DB を受け取れる。
 * ネットワークへ出るプラグインは一切登録しない。
 */
export function buildApp(config: ServerConfig, db?: DB): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const database = db ?? bootstrap({ filename: config.dbFile });

  app.decorate('db', database);
  app.decorate('config', config);

  app.register(registerHealthRoutes);
  app.register(registerSettingsRoutes, { prefix: '/api/settings' });

  // ビルド済みSPAがあれば静的配信(オフライン動作)。無ければAPIのみ。
  if (existsSync(config.webDistDir)) {
    app.register(fastifyStatic, { root: config.webDistDir, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      // SPA フォールバック(APIパス以外は index.html)
      if (req.url.startsWith('/api')) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  app.addHook('onClose', async () => {
    database.close();
  });

  return app;
}
