import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { documentRoutes } from '../src/routes/documents.js';

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
  await app.register(documentRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('documentRoutes', () => {
  it('document version CRUDを扱い監査ログを記録する', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        docType: 'terms',
        title: '利用規約',
        versionLabel: 'v1',
        body: '初版本文',
        effectiveDate: '2026-07-01',
        nextReviewDate: '2027-01-01',
        sourceId: 'S6',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody).toMatchObject({
      id: expect.any(Number),
      docType: 'terms',
      title: '利用規約',
      versionLabel: 'v1',
      state: 'draft',
      effectiveDate: '2026-07-01',
      sourceId: 'S6',
    });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/documents/${createdBody.id}`,
      payload: { versionLabel: 'v1.1', body: '改定本文', nextReviewDate: null },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: createdBody.id, versionLabel: 'v1.1', body: '改定本文' });

    const listed = await app.inject({ method: 'GET', url: '/api/documents?docType=terms' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const fetched = await app.inject({ method: 'GET', url: `/api/documents/${createdBody.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ docType: 'terms' });

    const deleted = await app.inject({ method: 'DELETE', url: `/api/documents/${createdBody.id}` });
    expect(deleted.statusCode).toBe(204);

    const missing = await app.inject({ method: 'GET', url: `/api/documents/${createdBody.id}` });
    expect(missing.statusCode).toBe(404);

    const auditActions = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('document_version')
      .map((row) => (row as { action: string }).action);
    expect(auditActions).toEqual(['create', 'update', 'delete']);
  });

  it('publishで同一doc_typeの旧publishedをarchivedにし履歴を返す', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        docType: 'privacy',
        title: 'プライバシーポリシー',
        versionLabel: 'v1',
        body: '初版',
        state: 'published',
        effectiveDate: '2026-07-01',
        sourceId: 'S9',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        docType: 'privacy',
        title: 'プライバシーポリシー',
        versionLabel: 'v2',
        body: '改定版',
        effectiveDate: '2026-10-01',
        sourceId: 'S9',
      },
    });
    const firstBody = first.json();
    const secondBody = second.json();

    const published = await app.inject({ method: 'POST', url: `/api/documents/${secondBody.id}/publish` });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ id: secondBody.id, state: 'published' });

    const old = await app.inject({ method: 'GET', url: `/api/documents/${firstBody.id}` });
    expect(old.json()).toMatchObject({ id: firstBody.id, state: 'archived' });

    const history = await app.inject({ method: 'GET', url: '/api/documents/history/privacy' });
    expect(history.statusCode).toBe(200);
    expect(history.json().map((version: { versionLabel: string; state: string }) => [version.versionLabel, version.state])).toEqual([
      ['v2', 'published'],
      ['v1', 'archived'],
    ]);

    const actions = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('document_version')
      .map((row) => (row as { action: string }).action);
    expect(actions).toEqual(['create', 'create', 'publish']);
  });

  it('不正payloadと不正idは400', async () => {
    const invalidPayload = await app.inject({
      method: 'POST',
      url: '/api/documents',
      payload: {
        docType: 'unknown',
        title: '不正',
        versionLabel: 'v1',
        body: 'body',
      },
    });
    expect(invalidPayload.statusCode).toBe(400);
    expect(invalidPayload.json().message).toMatch(/docType must be one of/);

    const invalidId = await app.inject({ method: 'GET', url: '/api/documents/not-a-number' });
    expect(invalidId.statusCode).toBe(400);

    const invalidType = await app.inject({ method: 'GET', url: '/api/documents?docType=unknown' });
    expect(invalidType.statusCode).toBe(400);
  });
});
