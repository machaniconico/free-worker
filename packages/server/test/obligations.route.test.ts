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

  it('監査件数: CRUD で audit_logs に各1件ずつ記録される(二重記録なし)', async () => {
    // POST → create
    const created = await app.inject({
      method: 'POST',
      url: '/api/obligations',
      payload: { category: '税務', title: '消費税申告' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;

    const auditAfterCreate = db
      .prepare("SELECT action FROM audit_logs WHERE entity_type='obligation' AND entity_id=? ORDER BY id ASC")
      .all(String(id))
      .map((r) => (r as { action: string }).action);
    expect(auditAfterCreate).toEqual(['create']);

    // PUT → update
    await app.inject({
      method: 'PUT',
      url: `/api/obligations/${id}`,
      payload: { title: '消費税申告(修正)' },
    });
    const auditAfterPut = db
      .prepare("SELECT action FROM audit_logs WHERE entity_type='obligation' AND entity_id=? ORDER BY id ASC")
      .all(String(id))
      .map((r) => (r as { action: string }).action);
    expect(auditAfterPut).toEqual(['create', 'update']);

    // PATCH /:id/status → update
    await app.inject({
      method: 'PATCH',
      url: `/api/obligations/${id}/status`,
      payload: { status: '完了' },
    });
    const auditAfterPatch = db
      .prepare("SELECT action FROM audit_logs WHERE entity_type='obligation' AND entity_id=? ORDER BY id ASC")
      .all(String(id))
      .map((r) => (r as { action: string }).action);
    expect(auditAfterPatch).toEqual(['create', 'update', 'update']);

    // DELETE → delete
    await app.inject({ method: 'DELETE', url: `/api/obligations/${id}` });
    const auditAfterDelete = db
      .prepare("SELECT action FROM audit_logs WHERE entity_type='obligation' AND entity_id=? ORDER BY id ASC")
      .all(String(id))
      .map((r) => (r as { action: string }).action);
    expect(auditAfterDelete).toEqual(['create', 'update', 'update', 'delete']);
  });

  it('エラーコード契約: POST {} → category_required', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/obligations', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('category_required');
  });

  it('エラーコード契約: POST {category} → title_required', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/obligations', payload: { category: '税務' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('title_required');
  });

  it('エラーコード契約: PUT 既存ID に {title:""} → title_required', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/obligations',
      payload: { category: '税務', title: '消費税申告' },
    });
    const id = created.json().id as number;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/obligations/${id}`,
      payload: { title: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('title_required');
  });

  it('エラーコード契約: PUT 既存ID に {category:""} → category_required', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/obligations',
      payload: { category: '税務', title: '消費税申告' },
    });
    const id = created.json().id as number;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/obligations/${id}`,
      payload: { category: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('category_required');
  });

  it('エラーコード契約: PATCH /:id/status に {} → status_required', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/obligations',
      payload: { category: '税務', title: '消費税申告' },
    });
    const id = created.json().id as number;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/obligations/${id}/status`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('status_required');
  });

  it('エラーコード契約: PATCH /:id/status に {status:"  "} → status_required', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/obligations',
      payload: { category: '税務', title: '消費税申告' },
    });
    const id = created.json().id as number;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/obligations/${id}/status`,
      payload: { status: '  ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('status_required');
  });
});
