import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { bootstrap, type DB } from '@free-worker/core';
import { type ServerConfig } from './config.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { profileRoutes } from './routes/profile.js';
import { obligationRoutes } from './routes/obligations.js';
import { productRoutes } from './routes/products.js';
import { salesRoutes } from './routes/sales.js';
import { expenseRoutes } from './routes/expenses.js';
import { backupRoutes } from './routes/backup.js';
import { documentRoutes } from './routes/documents.js';
import { customerRoutes } from './routes/customers.js';
import { contentRoutes } from './routes/content.js';
import { auditRoutes } from './routes/audit.js';
import { taxReportRoutes } from './routes/tax-report.js';
import { agendaRoutes } from './routes/agenda.js';
import { invoiceRoutes } from './routes/invoices.js';
import { legalRoutes } from './routes/legal.js';

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
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 16 * 1024 * 1024 });
  const database = db ?? bootstrap({ filename: config.dbFile });

  app.decorate('db', database);
  app.decorate('config', config);

  app.register(registerHealthRoutes);
  app.register(registerSettingsRoutes, { prefix: '/api/settings' });

  // 各EPICのルート(すべて自己内包で /api/* を登録)
  app.register(profileRoutes);
  app.register(obligationRoutes);
  app.register(productRoutes);
  app.register(salesRoutes);
  app.register(expenseRoutes);
  app.register(backupRoutes);
  app.register(documentRoutes);
  app.register(customerRoutes);
  app.register(contentRoutes);
  app.register(auditRoutes);

  // 便利機能(確定申告/今日のやること/請求書/規約生成)
  app.register(taxReportRoutes);
  app.register(agendaRoutes);
  app.register(invoiceRoutes);
  app.register(legalRoutes);

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
