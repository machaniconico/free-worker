import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface ContentProject {
  id?: string;
  title?: string;
  status?: string;
  createdAt?: string;
  [k: string]: unknown;
}

interface PreReleaseCheck {
  blockers?: Array<{ field?: string; message?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

const EMPTY: Omit<ContentProject, 'id'> = { title: '', status: 'draft' };

export function ContentPage() {
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [form, setForm] = useState<Omit<ContentProject, 'id'>>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<Record<string, PreReleaseCheck>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<ContentProject[]>('/api/content/projects')
      .then(setProjects)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async () => {
    setError(null);
    try {
      await api.post<ContentProject>('/api/content/projects', form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setForm(EMPTY);
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.post(`/api/content/projects/${id}/status`, { status });
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const loadCheck = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (checks[id]) return;
    try {
      const res = await api.get<PreReleaseCheck>(`/api/content/projects/${id}/pre-release-check`);
      setChecks((prev) => ({ ...prev, [id]: res }));
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const STATUS_LABELS: Record<string, string> = {
    draft: '下書き',
    review: 'レビュー中',
    scheduled: '公開予定',
    published: '公開済',
    archived: 'アーカイブ',
  };

  return (
    <div>
      <h1>コンテンツ管理</h1>
      <p className="lead">コンテンツプロジェクトのワークフローと公開前チェックを管理します。</p>

      {error && <p className="error">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      {projects.length > 0 && (
        <section className="card">
          <h2>プロジェクト一覧</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>タイトル</th>
                <th>状態</th>
                <th>作成日</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => {
                const check = p.id ? checks[p.id] : undefined;
                const blockers = check?.blockers ?? [];
                return (
                  <>
                    <tr key={p.id ?? i}>
                      <td>{String(p.title ?? '—')}</td>
                      <td>
                        <span className={`badge ${p.status === 'published' ? 'badge-ok' : p.status === 'archived' ? 'badge-muted' : 'badge-default'}`}>
                          {STATUS_LABELS[String(p.status ?? '')] ?? String(p.status ?? '—')}
                        </span>
                      </td>
                      <td style={{ fontSize: 12 }}>{String(p.createdAt ?? '—')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <select
                            value={String(p.status ?? 'draft')}
                            onChange={(e) => p.id && void updateStatus(p.id, e.target.value)}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13 }}
                          >
                            {Object.entries(STATUS_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                          {p.id && (
                            <button className="btn" onClick={() => void loadCheck(p.id!)}>
                              {expandedId === p.id ? '▲ チェック' : '▼ 公開前チェック'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr key={`${p.id ?? i}-check`}>
                        <td colSpan={4} style={{ background: 'var(--panel-2)', padding: '10px 14px' }}>
                          {!check && <span style={{ color: 'var(--muted)' }}>読み込み中…</span>}
                          {check && blockers.length === 0 && (
                            <span style={{ color: 'var(--accent-2)' }}>✓ ブロッカーなし。公開可能です。</span>
                          )}
                          {check && blockers.length > 0 && (
                            <div>
                              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>ブロッカー {blockers.length}件:</span>
                              {blockers.map((b, bi) => (
                                <div key={bi} style={{ fontSize: 13, padding: '3px 0', color: 'var(--muted)' }}>
                                  ⚠️ {b.field && <b>{String(b.field)}: </b>}{String(b.message ?? JSON.stringify(b))}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>新規プロジェクト作成</h2>
        <label className="field">
          <span>タイトル *</span>
          <input type="text" value={String(form.title ?? '')} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={() => void save()}>作成</button>
          {saved && <span className="saved">保存しました</span>}
        </div>
      </section>
    </div>
  );
}
