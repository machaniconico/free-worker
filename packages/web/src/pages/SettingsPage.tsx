import { useEffect, useState } from 'react';
import { api, type AiConfig } from '../api.js';

const PROVIDERS: ReadonlyArray<{ value: AiConfig['provider']; label: string; hint: string }> = [
  { value: 'none', label: '無効(既定)', hint: 'AI補助を使わない。全機能はこのままで動きます。' },
  { value: 'ollama', label: 'Ollama(ローカル)', hint: 'http://127.0.0.1:11434 等のローカルLLM。' },
  { value: 'lmstudio', label: 'LM Studio(ローカル)', hint: 'ローカルのOpenAI互換サーバ。' },
  { value: 'gemini_flash', label: 'Gemini Flash(無料枠)', hint: '唯一許可されるクラウド。任意・無料枠のみ。' },
];

export function SettingsPage() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<AiConfig>('/api/settings/ai').then(setCfg).catch(() => setCfg({ enabled: false, provider: 'none' }));
  }, []);

  if (!cfg) return <p>読み込み中…</p>;

  const save = async () => {
    const next = await api.put<AiConfig>('/api/settings/ai', cfg);
    setCfg(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h1>設定</h1>
      <section className="card">
        <h2>AI補助(任意)</h2>
        <p className="lead">
          AIは任意機能です。<b>無効でも全機能が使えます。</b>
          クラウドLLMは使いません(例外: Gemini Flash 無料枠のみ)。ローカルLLMは推奨です。
        </p>

        <label className="field">
          <span>有効化</span>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
          />
        </label>

        <label className="field">
          <span>プロバイダ</span>
          <select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value as AiConfig['provider'] })}>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        <p className="hint">{PROVIDERS.find((p) => p.value === cfg.provider)?.hint}</p>

        {(cfg.provider === 'ollama' || cfg.provider === 'lmstudio') && (
          <label className="field">
            <span>エンドポイント</span>
            <input
              type="text"
              placeholder="http://127.0.0.1:11434"
              value={cfg.endpoint ?? ''}
              onChange={(e) => setCfg({ ...cfg, endpoint: e.target.value })}
            />
          </label>
        )}

        <button className="btn primary" onClick={() => void save()}>保存</button>
        {saved && <span className="saved">保存しました</span>}
      </section>
    </div>
  );
}
