import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Doc {
  id?: string;
  docType: string;
  versionLabel?: string;
  state?: string;
  body?: string;
  createdAt?: string;
}

const DOC_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'tokushoho', label: '特定商取引法表記' },
  { value: 'terms', label: '利用規約' },
  { value: 'privacy', label: 'プライバシーポリシー' },
  { value: 'contract_template', label: '契約書テンプレート' },
  { value: 'license', label: 'ライセンス' },
  { value: 'other', label: 'その他' },
];

const EMPTY: Omit<Doc, 'id'> = { docType: 'terms', versionLabel: '', body: '' };

export function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [form, setForm] = useState<Omit<Doc, 'id'>>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<Doc[]>('/api/documents')
      .then(setDocs)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async () => {
    setError(null);
    try {
      if (editId) {
        await api.put<Doc>(`/api/documents/${editId}`, form);
      } else {
        await api.post<Doc>('/api/documents', form);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setForm(EMPTY);
      setEditId(null);
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const publish = async (id: string) => {
    setPublishMsg(null);
    try {
      await api.post(`/api/documents/${id}/publish`);
      setPublishMsg('公開しました');
      setTimeout(() => setPublishMsg(null), 2000);
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const startEdit = (d: Doc) => {
    setForm({ docType: d.docType, versionLabel: d.versionLabel ?? '', body: d.body ?? '' });
    setEditId(d.id ?? null);
  };

  const docTypeLabel = (v: string) => DOC_TYPES.find((t) => t.value === v)?.label ?? v;

  return (
    <div>
      <h1>文書・規約管理</h1>
      <p className="lead">利用規約・プライバシーポリシー等の版管理と公開を行います。</p>

      {error && <p className="error">{error}</p>}
      {publishMsg && <p style={{ color: 'var(--accent-2)' }}>{publishMsg}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      {docs.length > 0 && (
        <section className="card">
          <h2>文書一覧</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>種別</th>
                <th>バージョン</th>
                <th>状態</th>
                <th>作成日</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => (
                <tr key={d.id ?? i}>
                  <td>{docTypeLabel(d.docType)}</td>
                  <td>{d.versionLabel ?? '—'}</td>
                  <td>
                    <span className={`badge ${d.state === 'published' ? 'badge-ok' : 'badge-default'}`}>
                      {d.state === 'published' ? '公開中' : d.state ?? '下書き'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{String(d.createdAt ?? '—')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn" onClick={() => startEdit(d)}>編集</button>
                      {d.id && d.state !== 'published' && (
                        <button className="btn primary" onClick={() => void publish(d.id!)}>公開</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>{editId ? '文書編集' : '新規文書作成'}</h2>
        <label className="field">
          <span>種別 *</span>
          <select value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
            {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>バージョン</span>
          <input type="text" value={form.versionLabel ?? ''} onChange={(e) => setForm({ ...form, versionLabel: e.target.value })} placeholder="例: v1.0" />
        </label>
        <div style={{ margin: '10px 0' }}>
          <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 6 }}>本文</div>
          <textarea
            value={form.body ?? ''}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={8}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--panel-2)',
              color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical', fontSize: 14,
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={() => void save()}>{editId ? '更新' : '作成'}</button>
          {editId && <button className="btn" onClick={() => { setForm(EMPTY); setEditId(null); }}>キャンセル</button>}
          {saved && <span className="saved">保存しました</span>}
        </div>
      </section>
    </div>
  );
}
