import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface SalesSummary {
  month: string;
  totalSales: number;
  totalTax: number;
  totalUnpaid: number;
  totalRefund: number;
  orderCount: number;
  subscriptionSales?: number;
}

interface ExpensesSummary {
  month: string;
  totalAmount: number;
}

interface Obligation {
  id: string;
  category: string;
  title: string;
  dueDate: string;
  status: string;
  dueStatus?: string;
}

function fmtYen(n: number) {
  return n.toLocaleString('ja-JP') + '円';
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [expenses, setExpenses] = useState<ExpensesSummary | null>(null);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<SalesSummary>(`/api/sales/summary?month=${month}`),
      api.get<ExpensesSummary>(`/api/expenses/summary?month=${month}`),
      api.get<Obligation[]>('/api/obligations'),
    ])
      .then(([s, e, o]) => {
        setSales(s);
        setExpenses(e);
        setObligations(
          o.filter((ob) => ob.dueStatus === 'overdue' || ob.dueStatus === 'due_soon'),
        );
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [month]);

  const grossProfit =
    sales && expenses ? sales.totalSales - expenses.totalAmount : null;

  return (
    <div>
      <h1>ダッシュボード</h1>
      <p className="lead">月次KPIと期限アラートを一覧します。</p>

      <div className="field" style={{ marginTop: 16 }}>
        <span>対象月</span>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)' }}
        />
      </div>

      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
      {loading && <p style={{ color: 'var(--muted)', marginTop: 12 }}>読み込み中…</p>}

      {!loading && sales && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">売上</div>
            <div className="kpi-value">{fmtYen(sales.totalSales)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">経費</div>
            <div className="kpi-value">{expenses ? fmtYen(expenses.totalAmount) : '—'}</div>
          </div>
          <div className="kpi-card accent-green">
            <div className="kpi-label">粗利</div>
            <div className="kpi-value">{grossProfit !== null ? fmtYen(grossProfit) : '—'}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">消費税</div>
            <div className="kpi-value">{fmtYen(sales.totalTax)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">未収</div>
            <div className="kpi-value">{fmtYen(sales.totalUnpaid)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">返金</div>
            <div className="kpi-value">{fmtYen(sales.totalRefund)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">件数</div>
            <div className="kpi-value">{sales.orderCount}件</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">MRR概算</div>
            <div className="kpi-value">
              {sales.subscriptionSales != null && sales.subscriptionSales > 0
                ? fmtYen(sales.subscriptionSales)
                : '—'}
            </div>
          </div>
        </div>
      )}

      {obligations.length > 0 && (
        <section className="card">
          <h2>今月の期限アラート</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>カテゴリ</th>
                <th>タイトル</th>
                <th>期日</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {obligations.map((ob) => (
                <tr key={ob.id}>
                  <td>{ob.category}</td>
                  <td>{ob.title}</td>
                  <td>{ob.dueDate}</td>
                  <td>
                    <span className={`badge ${ob.dueStatus === 'overdue' ? 'badge-danger' : 'badge-warn'}`}>
                      {ob.dueStatus === 'overdue' ? '期限超過' : '期限間近'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {!loading && obligations.length === 0 && (
        <section className="card">
          <h2>今月の期限アラート</h2>
          <p style={{ color: 'var(--muted)' }}>期限切れ・期限間近の項目はありません。</p>
        </section>
      )}
    </div>
  );
}
