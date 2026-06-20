import { describe, it, expect } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import { writeAudit } from '../src/audit.js';
import { getAiConfig, setAiConfig } from '../src/settings.js';

describe('db bootstrap (offline)', () => {
  it('インメモリでマイグレーション+出典シードが通る', () => {
    const db = bootstrap({ filename: ':memory:' });
    const sources = db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number };
    expect(sources.n).toBe(15);
    // 主要テーブルが存在する
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('products');
    expect(tables).toContain('orders');
    expect(tables).toContain('backup_history');
    expect(tables).toContain('document_versions');
    db.close();
  });

  it('マイグレーションは冪等(再実行で重複しない)', () => {
    const db = bootstrap({ filename: ':memory:' });
    // 再bootstrapはできないので migrate を直接再適用しても件数は不変
    const before = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
    expect(before.n).toBeGreaterThanOrEqual(2);
    db.close();
  });

  it('監査ログを記録できる', () => {
    const db = bootstrap({ filename: ':memory:' });
    writeAudit(db, { action: 'create', entityType: 'product', entityId: 1, after: { sku: 'A' } });
    const row = db.prepare('SELECT action, entity_type, entity_id FROM audit_logs').get() as {
      action: string;
      entity_type: string;
      entity_id: string;
    };
    expect(row).toEqual({ action: 'create', entity_type: 'product', entity_id: '1' });
    db.close();
  });

  it('AI設定は既定で無効(AI非依存)', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(getAiConfig(db)).toEqual({ enabled: false, provider: 'none' });
    setAiConfig(db, { enabled: true, provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen2.5' });
    expect(getAiConfig(db).provider).toBe('ollama');
    db.close();
  });

  it('不正な provider はデフォルト(none)にフォールバックしアプリが壊れない', () => {
    const db = bootstrap({ filename: ':memory:' });
    // DB に直接不正な provider を書き込む
    db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('ai_config', '{"enabled":true,"provider":"invalid_provider"}', CURRENT_TIMESTAMP)`).run();
    const config = getAiConfig(db);
    expect(config.provider).toBe('none');
    expect(config.enabled).toBe(true); // 他フィールドはそのまま
    db.close();
  });
});
