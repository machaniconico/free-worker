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

interface LegalDraft {
  docType: string;
  title: string;
  versionLabel: string;
  body: string;
  sourceIds: string[];
  placeholderCount: number;
}

interface GenerateResponse {
  draft: LegalDraft;
  saved?: boolean;
}

const DOC_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'tokushoho', label: '特定商取引法表記' },
  { value: 'terms', label: '利用規約' },
  { value: 'privacy', label: 'プライバシーポリシー' },
  { value: 'contract_template', label: '契約書テンプレート' },
  { value: 'license', label: 'ライセンス' },
  { value: 'other', label: 'その他' },
];

const GENERATE_DOC_TYPES: ReadonlyArray<{ value: 'tokushoho' | 'terms' | 'privacy'; label: string }> = [
  { value: 'tokushoho', label: '特定商取引法表記' },
  { value: 'terms', label: '利用規約' },
  { value: 'privacy', label: 'プライバシーポリシー' },
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

  // Legal draft generation state
  const [genDocType, setGenDocType] = useState<'tokushoho' | 'terms' | 'privacy'>('tokushoho');
  const [genDraft, setGenDraft] = useState<LegalDraft | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genSaved, setGenSaved] = useState(false);
  const [genSaving, setGenSaving] = useState(false);

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

  // Generate draft from profile
  const generateDraft = async () => {
    setGenLoading(true);
    setGenError(null);
    setGenDraft(null);
    setGenSaved(false);
    try {
      const res = await api.post<GenerateResponse>('/api/legal/generate', { docType: genDocType });
      setGenDraft(res.draft);
    } catch (e: unknown) {
      setGenError(String(e));
    } finally {
      setGenLoading(false);
    }
  };

  // Save draft to documents
  const saveDraft = async () => {
    if (!genDraft) return;
    setGenSaving(true);
    setGenError(null);
    try {
      await api.post<GenerateResponse>('/api/legal/generate', { docType: genDocType, save: true });
      setGenSaved(true);
      setTimeout(() => setGenSaved(false), 3000);
      load();
    } catch (e: unknown) {
      setGenError(String(e));
    } finally {
      setGenSaving(false);
    }
  };

  return (
    <div>
      <h1>文書・規約管理</h1>
      <p className="lead">利用規約・プライバシーポリシー等の版管理と公開を行います。</p>

      {error && <p className="error">{error}</p>}
      {publishMsg && <p style={{ color: 'var(--accent-2)' }}>{publishMsg}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      {/* ── 草案生成セクション ── */}
      <section className="card">
        <h2>プロフィールから草案生成</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
          登録済みの事業プロフィール情報を元に文書の草案を自動生成します。
          生成後にプレビューで確認し、draft として保存できます。
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={genDocType}
            onChange={(e) => {
              setGenDocType(e.target.value as 'tokushoho' | 'terms' | 'privacy');
              setGenDraft(null);
              setGenSaved(false);
            }}
            style={{
              padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)',
            }}
          >
            {GENERATE_DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <button
            className="btn primary"
            onClick={() => void generateDraft()}
            disabled={genLoading}
          >
            {genLoading ? '生成中…' : '草案を生成'}
          </button>
        </div>

        {genError && <p className="error" style={{ marginTop: 8 }}>{genError}</p>}

        {genDraft && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <strong>{genDraft.title}</strong>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{genDraft.versionLabel}</span>
              {genDraft.placeholderCount > 0 && (
                <span className="badge badge-warn">
                  要記入 {genDraft.placeholderCount}件
                </span>
              )}
              {genDraft.placeholderCount === 0 && (
                <span className="badge badge-ok">プレースホルダーなし</span>
              )}
            </div>
            <textarea
              readOnly
              value={genDraft.body}
              rows={10}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--panel-2)',
                color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical', fontSize: 13,
              }}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn primary"
                onClick={() => void saveDraft()}
                disabled={genSaving || genSaved}
              >
                {genSaving ? '保存中…' : 'draftとして保存'}
              </button>
              {genSaved && <span className="saved">保存しました</span>}
            </div>
          </div>
        )}
      </section>

      {/* ── 文書一覧 ── */}
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

      {/* ── 新規作成 / 編集フォーム ── */}
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
