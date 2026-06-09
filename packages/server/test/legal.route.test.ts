import { describe, it, expect, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { bootstrap, createProfile, type DB } from '@free-worker/core';
import { legalRoutes } from '../src/routes/legal.js';

const db: DB = bootstrap({ filename: ':memory:' });
createProfile(db, { tradeName: 'テスト商店', invoiceRegistrationNumber: 'T9999999999999' });

const app: FastifyInstance = Fastify();
app.decorate('db', db);
app.register(legalRoutes);

afterAll(async () => {
  await app.close();
});

describe('legalRoutes', () => {
  it('特商法草案を生成して返す', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/legal/generate', payload: { docType: 'tokushoho' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().draft.docType).toBe('tokushoho');
    expect(res.json().draft.body).toContain('テスト商店');
  });

  it('save:true で document_versions に draft 保存する', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/legal/generate',
      payload: { docType: 'privacy', save: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().saved.id).toBeGreaterThan(0);
    expect(res.json().saved.state).toBe('draft');
  });

  it('不正な docType は 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/legal/generate', payload: { docType: 'nope' } });
    expect(res.statusCode).toBe(400);
  });
});
