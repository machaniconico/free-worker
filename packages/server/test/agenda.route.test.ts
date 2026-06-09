import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrap,
  createContentProject,
  createContentTask,
  createDocumentVersion,
  createObligation,
  type DB,
} from '@free-worker/core';
import { agendaRoutes } from '../src/routes/agenda.js';

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
  await app.register(agendaRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('agendaRoutes', () => {
  it('GET /api/agenda returns cross-domain alerts with severity', async () => {
    const project = createContentProject(db, { title: '講座制作' });
    createObligation(db, { category: '税務', title: '申告準備', dueDate: '2026-06-08' });
    createContentTask(db, { projectId: project.id, title: '販売ページ確認', dueDate: '2026-06-10' });
    createDocumentVersion(db, {
      docType: 'privacy',
      title: 'プライバシーポリシー',
      versionLabel: 'v1',
      body: '本文',
      nextReviewDate: '2026-06-11',
    });
    db.prepare(
      `INSERT INTO backup_history (file_path, sha256, size_bytes, encrypted, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('/tmp/old-route.fwbak', '2'.repeat(64), 10, 1, 'manual', '2026-06-01 00:00:00');

    const res = await app.inject({ method: 'GET', url: '/api/agenda?today=2026-06-09&soonDays=3&staleDays=7' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ today: '2026-06-09' });
    expect(res.json().alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'obligation', severity: 'overdue', title: '申告準備' }),
        expect.objectContaining({ kind: 'task', severity: 'due_soon', title: '販売ページ確認' }),
        expect.objectContaining({ kind: 'document_review', severity: 'due_soon', title: 'プライバシーポリシー の見直し' }),
        expect.objectContaining({ kind: 'backup', severity: 'overdue', title: 'バックアップ未実施' }),
      ]),
    );
  });

  it('today omitted and empty backup history do not throw', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agenda' });

    expect(res.statusCode).toBe(200);
    expect(res.json().today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.json().alerts).toEqual([
      {
        kind: 'backup',
        severity: 'overdue',
        title: 'バックアップ未実施',
        ref: { type: 'backup_history', reason: 'empty' },
      },
    ]);
  });

  it('invalid query parameters return 400', async () => {
    const invalidToday = await app.inject({ method: 'GET', url: '/api/agenda?today=20260609' });
    expect(invalidToday.statusCode).toBe(400);
    expect(invalidToday.json()).toEqual({ error: 'invalid_today' });

    const invalidSoonDays = await app.inject({ method: 'GET', url: '/api/agenda?soonDays=-1' });
    expect(invalidSoonDays.statusCode).toBe(400);
    expect(invalidSoonDays.json()).toEqual({ error: 'invalid_soon_days' });
  });
});
