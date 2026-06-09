import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Profile {
  id?: string;
  tradeName: string;
  legalNamePublicPolicy?: string;
  businessStartDate?: string;
  taxOffice?: string;
  blueReturnEnabled?: boolean;
  invoiceRegistrationNumber?: string;
}

const EMPTY: Profile = { tradeName: '' };

export function ProfilePage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [form, setForm] = useState<Profile>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<Profile[]>('/api/profile')
      .then((data) => {
        const arr = Array.isArray(data) ? data : [data];
        setProfiles(arr.filter(Boolean));
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async () => {
    setError(null);
    try {
      if (editId) {
        await api.put<Profile>(`/api/profile/${editId}`, form);
      } else {
        await api.post<Profile>('/api/profile', form);
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

  const del = async (id: string) => {
    if (!confirm('削除しますか？')) return;
    try {
      await api.del(`/api/profile/${id}`);
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const startEdit = (p: Profile) => {
    setForm({ ...p });
    setEditId(p.id ?? null);
  };

  return (
    <div>
      <h1>事業プロフィール</h1>
      <p className="lead">屋号・税務情報など事業の基本情報を管理します。</p>

      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}
      {error && <p className="error">{error}</p>}

      {profiles.length > 0 && (
        <section className="card">
          <h2>登録済みプロフィール</h2>
          {profiles.map((p, i) => (
            <div key={p.id ?? i} style={{ borderBottom: '1px dashed var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              <ul className="kv">
                <li><span>屋号</span><b>{p.tradeName}</b></li>
                {p.businessStartDate && <li><span>開業日</span><b>{p.businessStartDate}</b></li>}
                {p.taxOffice && <li><span>所轄税務署</span><b>{p.taxOffice}</b></li>}
                {p.invoiceRegistrationNumber && <li><span>インボイス登録番号</span><b>{p.invoiceRegistrationNumber}</b></li>}
                <li><span>青色申告</span><b>{p.blueReturnEnabled ? 'はい' : 'いいえ'}</b></li>
              </ul>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => startEdit(p)}>編集</button>
                {p.id && <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => void del(p.id!)}>削除</button>}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>{editId ? 'プロフィール編集' : '新規登録'}</h2>

        <label className="field">
          <span>屋号 *</span>
          <input type="text" value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} placeholder="例: フリーランス田中" />
        </label>
        <label className="field">
          <span>氏名公開方針</span>
          <input type="text" value={form.legalNamePublicPolicy ?? ''} onChange={(e) => setForm({ ...form, legalNamePublicPolicy: e.target.value })} />
        </label>
        <label className="field">
          <span>開業日</span>
          <input type="text" value={form.businessStartDate ?? ''} onChange={(e) => setForm({ ...form, businessStartDate: e.target.value })} placeholder="YYYY-MM-DD" />
        </label>
        <label className="field">
          <span>所轄税務署</span>
          <input type="text" value={form.taxOffice ?? ''} onChange={(e) => setForm({ ...form, taxOffice: e.target.value })} />
        </label>
        <label className="field">
          <span>インボイス番号</span>
          <input type="text" value={form.invoiceRegistrationNumber ?? ''} onChange={(e) => setForm({ ...form, invoiceRegistrationNumber: e.target.value })} placeholder="T1234567890123" />
        </label>
        <label className="field">
          <span>青色申告</span>
          <input type="checkbox" checked={form.blueReturnEnabled ?? false} onChange={(e) => setForm({ ...form, blueReturnEnabled: e.target.checked })} />
        </label>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={() => void save()}>{editId ? '更新' : '登録'}</button>
          {editId && (
            <button className="btn" onClick={() => { setForm(EMPTY); setEditId(null); }}>キャンセル</button>
          )}
          {saved && <span className="saved">保存しました</span>}
        </div>
      </section>
    </div>
  );
}
