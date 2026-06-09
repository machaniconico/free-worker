import { describe, it, expect, afterAll } from 'vitest';
import { bootstrap } from '@free-worker/core';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const db = bootstrap({ filename: ':memory:' });
const app = buildApp({ ...loadConfig(), webDistDir: '/nonexistent' }, db);

afterAll(async () => {
  await app.close();
});

describe('server (offline, inject)', () => {
  it('GET /api/health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.offline).toBe(true);
    expect(body.migrations).toBeGreaterThanOrEqual(2);
  });

  it('host は 127.0.0.1 に固定(外部公開しない)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/app-info' });
    expect(res.json().host).toBe('127.0.0.1');
  });

  it('AI設定は既定OFF、更新できる', async () => {
    const def = await app.inject({ method: 'GET', url: '/api/settings/ai' });
    expect(def.json()).toMatchObject({ enabled: false, provider: 'none' });

    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings/ai',
      payload: { enabled: true, provider: 'ollama', endpoint: 'http://127.0.0.1:11434' },
    });
    expect(put.json()).toMatchObject({ enabled: true, provider: 'ollama' });
  });

  it('不正プロバイダは400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/ai',
      payload: { provider: 'openai' },
    });
    expect(res.statusCode).toBe(400);
  });
});
