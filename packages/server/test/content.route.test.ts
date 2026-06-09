import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { contentRoutes } from '../src/routes/content.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  db = bootstrap({ filename: ':memory:' });
  app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(contentRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('contentRoutes', () => {
  it('handles project and task CRUD, status updates, and pre-release blockers', async () => {
    const product = db
      .prepare(
        `INSERT INTO products
          (sku, title, product_type, price_tax_included, status)
         VALUES
          (?, ?, ?, ?, ?)`,
      )
      .run('ROUTE-CONTENT-001', '不足商品', 'membership', 2200, 'draft');

    const created = await app.inject({
      method: 'POST',
      url: '/api/content/projects',
      payload: {
        title: '動画講座制作',
        plannedReleaseDate: '2026-09-01',
        rightsCheckStatus: '確認中',
        productId: Number(product.lastInsertRowid),
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: expect.any(Number),
      title: '動画講座制作',
      status: 'idea',
      rightsCheckStatus: '確認中',
      productId: Number(product.lastInsertRowid),
    });
    const projectId = created.json<{ id: number }>().id;

    const task = await app.inject({
      method: 'POST',
      url: `/api/content/projects/${projectId}/tasks`,
      payload: {
        title: '素材ライセンス確認',
        status: 'doing',
        priority: 'high',
        dueDate: '2026-08-01',
      },
    });
    expect(task.statusCode).toBe(201);
    expect(task.json()).toMatchObject({ projectId, title: '素材ライセンス確認', status: 'doing', priority: 'high' });
    const taskId = task.json<{ id: number }>().id;

    const blockers = await app.inject({ method: 'GET', url: `/api/content/projects/${projectId}/pre-release-check` });
    expect(blockers.statusCode).toBe(200);
    expect(blockers.json().blockers.map((blocker: { type: string }) => blocker.type)).toEqual([
      'rights_unconfirmed',
      'product_incomplete',
      'task_incomplete',
    ]);

    const status = await app.inject({
      method: 'PATCH',
      url: `/api/content/projects/${projectId}/status`,
      payload: { status: 'production' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ id: projectId, status: 'production' });

    const rights = await app.inject({
      method: 'PATCH',
      url: `/api/content/projects/${projectId}/rights`,
      payload: { rightsCheckStatus: '確認済' },
    });
    expect(rights.statusCode).toBe(200);
    expect(rights.json()).toMatchObject({ id: projectId, rightsCheckStatus: '確認済' });

    const updatedTask = await app.inject({
      method: 'PATCH',
      url: `/api/content/tasks/${taskId}/status`,
      payload: { status: 'done' },
    });
    expect(updatedTask.statusCode).toBe(200);
    expect(updatedTask.json()).toMatchObject({ id: taskId, status: 'done' });

    const listed = await app.inject({ method: 'GET', url: `/api/content/projects/${projectId}/tasks` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const deletedTask = await app.inject({ method: 'DELETE', url: `/api/content/projects/${projectId}/tasks/${taskId}` });
    expect(deletedTask.statusCode).toBe(204);

    const deletedProject = await app.inject({ method: 'DELETE', url: `/api/content/projects/${projectId}` });
    expect(deletedProject.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/content/projects/${projectId}` });
    expect(missing.statusCode).toBe(404);

    const audits = db
      .prepare('SELECT action, entity_type FROM audit_logs ORDER BY id ASC')
      .all() as Array<{ action: string; entity_type: string }>;
    expect(audits.map((row) => `${row.entity_type}:${row.action}`)).toEqual([
      'content_project:create',
      'content_task:create',
      'content_project:pre_release_check',
      'content_project:update',
      'content_project:update',
      'content_task:update',
      'content_task:delete',
      'content_project:delete',
    ]);
  });

  it('returns ready when rights, product fields, and tasks are complete', async () => {
    const product = db
      .prepare(
        `INSERT INTO products
          (sku, title, product_type, price_tax_included, license_summary, operating_environment, refund_policy, status)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'ROUTE-CONTENT-OK',
        '完成商品',
        'download',
        3300,
        '1契約1名まで利用可能',
        'Chrome最新版',
        '提供後の返金不可',
        'active',
      );

    const created = await app.inject({
      method: 'POST',
      url: '/api/content/projects',
      payload: {
        title: '完成プロジェクト',
        rightsCheckStatus: '確認済',
        productId: Number(product.lastInsertRowid),
      },
    });
    const projectId = created.json<{ id: number }>().id;
    await app.inject({
      method: 'POST',
      url: `/api/content/projects/${projectId}/tasks`,
      payload: { title: '公開前確認', status: 'done' },
    });

    const result = await app.inject({ method: 'GET', url: `/api/content/projects/${projectId}/pre-release-check` });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ projectId, ready: true, blockers: [] });
  });

  it('rejects invalid ids and invalid status transitions', async () => {
    const invalidId = await app.inject({ method: 'GET', url: '/api/content/projects/not-a-number' });
    expect(invalidId.statusCode).toBe(400);

    const created = await app.inject({
      method: 'POST',
      url: '/api/content/projects',
      payload: { title: '遷移テスト' },
    });
    const projectId = created.json<{ id: number }>().id;
    const invalidTransition = await app.inject({
      method: 'PATCH',
      url: `/api/content/projects/${projectId}/status`,
      payload: { status: 'published' },
    });
    expect(invalidTransition.statusCode).toBe(400);
    expect(invalidTransition.json().message).toMatch(/invalid content project status/);
  });
});
