import type { DB } from './db/connection.js';
import { type AiConfig, type AiProvider, DEFAULT_AI_CONFIG } from './ai/adapter.js';

const VALID_AI_PROVIDERS: ReadonlySet<AiProvider> = new Set<AiProvider>([
  'none',
  'ollama',
  'lmstudio',
  'gemini_flash',
]);

const AI_CONFIG_KEY = 'ai_config';

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(key, value);
}

export function getAiConfig(db: DB): AiConfig {
  const raw = getSetting(db, AI_CONFIG_KEY);
  if (!raw) return { ...DEFAULT_AI_CONFIG };
  try {
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    const merged = { ...DEFAULT_AI_CONFIG, ...parsed };
    // 不正な provider はデフォルトへフォールバック(throw せずグレースフル)。
    if (!VALID_AI_PROVIDERS.has(merged.provider)) {
      merged.provider = DEFAULT_AI_CONFIG.provider;
    }
    return merged;
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export function setAiConfig(db: DB, config: AiConfig): void {
  setSetting(db, AI_CONFIG_KEY, JSON.stringify(config));
}
