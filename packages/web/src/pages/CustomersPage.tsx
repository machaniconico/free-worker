import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Customer {
  id?: string;
  displayName?: string;
  note?: string;
  createdAt?: string;
  [k: string]: unknown;
}

interface Consent {
  id?: string;
  consentType?: string;
  grantedAt?: string;
  revokedAt?: string;
  status?: string;
  [k: string]: unknown;
}

const EMPTY_CUSTOMER: Omit<Customer, 'id'> = { displayName: '' };

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState<Omit<Customer, 'id'>>(EMPTY_CUSTOMER);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [consentType, setConsentType] = useState('');
  const [consentMsg, setConsentMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.get<Customer[]>('/api/customers')
      .then(setCustomers)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const loadConsents = (id: string) => {
    setSelectedId(id);
    api.get<Consent[]>(`/api/customers/${id}/consents`)
      .then(setConsents)
      .catch((e: unknown) => setError(String(e)));
  };

  const addCustomer = async () => {
    setError(null);
    try {
      await api.post<Customer>('/api/customers', form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setForm(EMPTY_CUSTOMER);
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const addConsent = async () => {
    if (!selectedId || !consentType) return;
    setConsentMsg(null);
    try {
      await api.post(`/api/customers/${selectedId}/consents`, { consentType });
      setConsentMsg('同意を追加しました');
      setConsentType('');
      loadConsents(selectedId);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const revokeConsent = async (consentId: string) => {
    if (!selectedId) return;
    try {
      await api.post(`/api/customers/${selectedId}/consents/${consentId}/revoke`);
      loadConsents(selectedId);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const selectedCustomer = customers.find((c) => c.id === selectedId);

  return (
    <div>
      <h1>顧客・同意管理</h1>
      <p className="lead">顧客情報と同意記録を管理します。</p>

      <section className="card" style={{ borderColor: 'var(--accent)', borderWidth: 1 }}>
        <h2>プライバシーに関する注意</h2>
        <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>
          このシステムはメールアドレスを平文保存しない設計です。顧客登録時もメールアドレスの入力は任意です。
          個人を特定できる情報の入力は最小限にとどめることを推奨します。
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 0 }}>
        <section className="card" style={{ marginTop: 18 }}>
          <h2>顧客一覧</h2>
          {customers.length === 0 && !loading && <p style={{ color: 'var(--muted)' }}>顧客がいません。</p>}
          {customers.map((c, i) => (
            <div
              key={c.id ?? i}
              onClick={() => c.id && loadConsents(c.id)}
              style={{
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
                background: selectedId === c.id ? 'var(--panel-2)' : 'transparent',
                border: '1px solid ' + (selectedId === c.id ? 'var(--accent)' : 'transparent'),
              }}
            >
              <div style={{ fontWeight: 600 }}>{String(c.displayName ?? '(名前なし)')}</div>
              {c.note && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{String(c.note)}</div>}
            </div>
          ))}
        </section>

        <section className="card" style={{ marginTop: 18 }}>
          <h2>顧客登録</h2>
          <label className="field">
            <span>表示名</span>
            <input
              type="text"
              value={String(form.displayName ?? '')}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="例: 顧客A"
            />
          </label>
          <p className="hint">メールアドレスは入力不要です(平文保存しない設計)。</p>
          <label className="field">
            <span>メモ</span>
            <input type="text" value={String(form.note ?? '')} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn primary" onClick={() => void addCustomer()}>登録</button>
            {saved && <span className="saved">保存しました</span>}
          </div>
        </section>
      </div>

      {selectedCustomer && (
        <section className="card">
          <h2>{String(selectedCustomer.displayName ?? '顧客')} の同意記録</h2>
          {consentMsg && <p style={{ color: 'var(--accent-2)' }}>{consentMsg}</p>}
          {consents.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr><th>種別</th><th>同意日</th><th>状態</th><th>操作</th></tr>
              </thead>
              <tbody>
                {consents.map((con, i) => (
                  <tr key={con.id ?? i}>
                    <td>{String(con.consentType ?? '—')}</td>
                    <td>{String(con.grantedAt ?? '—')}</td>
                    <td>
                      <span className={`badge ${con.revokedAt ? 'badge-danger' : 'badge-ok'}`}>
                        {con.revokedAt ? '取消済' : '有効'}
                      </span>
                    </td>
                    <td>
                      {!con.revokedAt && con.id && (
                        <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => void revokeConsent(con.id!)}>取消</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: 'var(--muted)' }}>同意記録がありません。</p>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={consentType}
              onChange={(e) => setConsentType(e.target.value)}
              placeholder="同意種別(例: terms_v1)"
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', flex: 1 }}
            />
            <button className="btn primary" onClick={() => void addConsent()}>同意追加</button>
          </div>
        </section>
      )}
    </div>
  );
}
