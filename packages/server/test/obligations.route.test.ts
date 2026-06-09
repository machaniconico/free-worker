import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { obligationRoutes } from '../src/routes/obligations.js';

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
  await app.register(obligationRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('obligationRoutes', () => {
  it('CRUD と状態更新を inject で扱える', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/obligations',
      payload: {
        category: '税務',
        title: '青色申告',
        description: '申請する',
        dueDate: '2026-06-20',
        sourceId: 'S2',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody).toMatchObject({ category: '税務', title: '青色申告', status: '未着手', sourceId: 'S2' });

    const list = await app.inject({ method: 'GET', url: '/api/obligations?today=2026-06-09' });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).toMatchObject({ title: '青色申告', dueStatus: 'due_soon' });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/obligations/${createdBody.id}`,
      payload: { title: '青色申告承認申請', status: '進行中' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: '青色申告承認申請', status: '進行中' });

    const status = await app.inject({
      method: 'PATCH',
      url: `/api/obligations/${createdBody.id}/status`,
      payload: { status: '完了' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().status).toBe('完了');

    const deleted = await app.inject({ method: 'DELETE', url: `/api/obligations/${createdBody.id}` });
    expect(deleted.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/obligations/${createdBody.id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('不正な作成ペイロードは400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/obligations', payload: { category: '税務' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('title_required');
  });
});
