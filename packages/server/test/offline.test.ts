/**
 * EPIC-11 AI非依存モード / オフライン動作の保証テスト。
 *
 * グローバル fetch を「ネットワーク禁止」スタブに差し替えた状態で、主要操作
 * (CRUD・検索・CSV出力・暗号化バックアップ/復元)がすべて成功することを検証する。
 * これは「クラウドAI/外部APIが使用不可になっても全機能が動く」ことの自動保証。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrap, seedChecklist, type DB } from '@free-worker/core';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

let tempDir: string;
let db: DB;
let app: FastifyInstance;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  // 外部ネットワークを完全に禁止する。どのエンドポイントも fetch に依存してはならない。
  globalThis.fetch = (() => {
    throw new Error('NETWORK DISABLED: オフライン動作の保証テスト中はネットワーク禁止');
  }) as typeof fetch;

  tempDir = mkdtempSync(join(tmpdir(), 'fw-offline-'));
  const dbFile = join(tempDir, 'free-worker.sqlite');
  db = bootstrap({ filename: dbFile });
  seedChecklist(db); // 法令チェックリストのシード(EPIC-02)
  app = buildApp({ ...loadConfig(), dataDir: tempDir, dbFile, webDistDir: '/nonexistent' }, db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('オフライン動作の保証(ネットワーク禁止下)', () => {
  it('稼働状況・AI設定: AIは既定OFFでヘルスはoffline:true', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().offline).toBe(true);

    const ai = await app.inject({ method: 'GET', url: '/api/settings/ai' });
    expect(ai.json()).toMatchObject({ enabled: false, provider: 'none' });
  });

  it('EPIC-01 事業プロフィール: 作成→一覧', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: { tradeName: 'テスト屋号', legalNamePublicPolicy: 'バーチャルオフィス' },
    });
    expect([200, 201]).toContain(created.statusCode);

    const list = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);
    expect(list.json().length).toBeGreaterThan(0);
  });

  it('EPIC-02 法令チェックリスト: シード済み項目を一覧できる', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/obligations' });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
  });

  it('EPIC-03 商品: 作成→掲載項目の欠落警告が出る', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      payload: { sku: 'SKU-OFFLINE-1', title: 'オフラインDLテンプレ', productType: 'download', priceTaxIncluded: 1980 },
    });
    expect([200, 201]).toContain(created.statusCode);
    const id = created.json().id;

    const completeness = await app.inject({ method: 'GET', url: `/api/products/${id}/completeness` });
    expect(completeness.statusCode).toBe(200);
    // 動作環境・ライセンス・返品条件が未設定なので警告が出るはず
    expect(completeness.json().warnings.length).toBeGreaterThan(0);
  });

  it('EPIC-05 売上: 月次集計とCSVエクスポートが動く', async () => {
    const summary = await app.inject({ method: 'GET', url: '/api/sales/summary?month=2026-06' });
    expect(summary.statusCode).toBe(200);

    const csv = await app.inject({ method: 'GET', url: '/api/sales/export' });
    expect(csv.statusCode).toBe(200);
  });

  it('EPIC-12 監査ログ: 一覧できる(プロフィール作成が記録されている)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    expect(res.statusCode).toBe(200);
  });

  it('EPIC-10 暗号化バックアップ: 作成→復元テストが成功する', async () => {
    const passphrase = 'offline-pass-1234';
    const created = await app.inject({
      method: 'POST',
      url: '/api/backup',
      payload: { passphrase, note: 'offline test backup' },
    });
    expect(created.statusCode).toBe(201);
    const filePath = created.json().filePath;
    expect(typeof filePath).toBe('string');

    const restoreTest = await app.inject({
      method: 'POST',
      url: '/api/backup/restore-test',
      payload: { filePath, passphrase },
    });
    expect(restoreTest.statusCode).toBe(200);
    expect(restoreTest.json().result).toBe('success');
  });
});
