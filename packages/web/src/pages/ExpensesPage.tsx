import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Expense {
  id?: string;
  spentAt: string;
  vendor?: string;
  category: string;
  amountTaxIncluded: number;
}

interface ExpensesSummary {
  month: string;
  totalAmount: number;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const EMPTY: Omit<Expense, 'id'> = { spentAt: '', vendor: '', category: '', amountTaxIncluded: 0 };

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpensesSummary | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [form, setForm] = useState<Omit<Expense, 'id'>>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<Expense[]>('/api/expenses'),
      api.get<ExpensesSummary>(`/api/expenses/summary?month=${month}`),
    ])
      .then(([e, s]) => { setExpenses(e); setSummary(s); })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [month]);

  const save = async () => {
    setError(null);
    try {
      await api.post<Expense>('/api/expenses', form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setForm(EMPTY);
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  return (
    <div>
      <h1>経費管理</h1>
      <p className="lead">経費の登録・集計・CSVエクスポートを行います。</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0 }}>
          <span>対象月</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)' }}
          />
        </div>
        <a href="/api/expenses/export" className="btn" download>CSVエクスポート</a>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      {summary && (
        <section className="card">
          <h2>{month} 月次集計</h2>
          <ul className="kv">
            <li><span>経費合計</span><b>{summary.totalAmount.toLocaleString('ja-JP')}円</b></li>
          </ul>
        </section>
      )}

      <section className="card">
        <h2>経費一覧</h2>
        {expenses.length === 0 && !loading && (
          <p style={{ color: 'var(--muted)' }}>経費がありません。</p>
        )}
        {expenses.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>支出日</th>
                <th>取引先</th>
                <th>カテゴリ</th>
                <th>税込金額</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e, i) => (
                <tr key={e.id ?? i}>
                  <td>{e.spentAt}</td>
                  <td>{e.vendor ?? '—'}</td>
                  <td>{e.category}</td>
                  <td>{e.amountTaxIncluded.toLocaleString('ja-JP')}円</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>経費登録</h2>
        <label className="field">
          <span>支出日 *</span>
          <input type="text" placeholder="YYYY-MM-DD" value={form.spentAt} onChange={(e) => setForm({ ...form, spentAt: e.target.value })} />
        </label>
        <label className="field">
          <span>取引先</span>
          <input type="text" value={form.vendor ?? ''} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
        </label>
        <label className="field">
          <span>カテゴリ *</span>
          <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="例: 通信費" />
        </label>
        <label className="field">
          <span>税込金額(円) *</span>
          <input type="number" min={0} value={form.amountTaxIncluded} onChange={(e) => setForm({ ...form, amountTaxIncluded: Number(e.target.value) })} />
        </label>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={() => void save()}>登録</button>
          {saved && <span className="saved">保存しました</span>}
        </div>
      </section>
    </div>
  );
}
