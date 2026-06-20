import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

interface Order {
  id?: string;
  orderedAt?: string;
  productTitle?: string;
  amountTaxIncluded?: number;
  taxAmount?: number;
  status?: string;
  [k: string]: unknown;
}

interface SalesSummary {
  month: string;
  totalSales: number;
  totalTax: number;
  totalUnpaid: number;
  totalRefund: number;
  orderCount: number;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function SalesPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<Order[]>('/api/sales'),
      api.get<SalesSummary>(`/api/sales/summary?month=${month}`),
    ])
      .then(([o, s]) => { setOrders(o); setSummary(s); })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [month]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    let res: Response;
    try {
      res = await fetch('/api/sales/import', { method: 'POST', body: formData });
    } catch {
      setImportMsg('サーバーに接続できませんでした。ネットワークを確認してください。');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    let data: Record<string, unknown>;
    try {
      data = await res.json() as Record<string, unknown>;
    } catch {
      setImportMsg('サーバー応答が不正です。管理者にお問い合わせください。');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (!res.ok) {
      const msg = typeof data['error'] === 'string' ? data['error'] : `APIエラー (${res.status})`;
      setImportMsg(`インポート失敗: ${msg}`);
    } else {
      const imported = typeof data['imported'] === 'number' ? data['imported'] : '?';
      const created = typeof data['created'] === 'number' ? data['created'] : undefined;
      const updated = typeof data['updated'] === 'number' ? data['updated'] : undefined;
      const detail = [
        created !== undefined ? `新規 ${created} 件` : null,
        updated !== undefined ? `更新 ${updated} 件` : null,
      ].filter(Boolean).join('、');
      setImportMsg(`インポート完了: ${imported} 件処理${detail ? `（${detail}）` : ''}`);
      load();
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div>
      <h1>売上・請求管理</h1>
      <p className="lead">注文一覧・月次集計・CSV入出力を管理します。</p>

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
        <a href="/api/sales/export" className="btn" download>CSVエクスポート</a>
        <label className="btn" style={{ cursor: 'pointer' }}>
          CSVインポート
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => void handleImport(e)} />
        </label>
      </div>

      {importMsg && <p style={{ color: 'var(--accent-2)', marginTop: 8 }}>{importMsg}</p>}
      {error && <p className="error">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      {summary && (
        <section className="card">
          <h2>{month} 月次集計</h2>
          <ul className="kv">
            <li><span>売上合計</span><b>{summary.totalSales.toLocaleString('ja-JP')}円</b></li>
            <li><span>消費税合計</span><b>{summary.totalTax.toLocaleString('ja-JP')}円</b></li>
            <li><span>未収合計</span><b>{summary.totalUnpaid.toLocaleString('ja-JP')}円</b></li>
            <li><span>返金合計</span><b>{summary.totalRefund.toLocaleString('ja-JP')}円</b></li>
            <li><span>件数</span><b>{summary.orderCount}件</b></li>
          </ul>
        </section>
      )}

      <section className="card">
        <h2>注文一覧</h2>
        {orders.length === 0 && !loading && (
          <p style={{ color: 'var(--muted)' }}>注文がありません。</p>
        )}
        {orders.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>注文日</th>
                <th>商品</th>
                <th>税込金額</th>
                <th>消費税</th>
                <th>状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.id ?? i}>
                  <td>{String(o.orderedAt ?? '—')}</td>
                  <td>{String(o.productTitle ?? '—')}</td>
                  <td>{o.amountTaxIncluded != null ? o.amountTaxIncluded.toLocaleString('ja-JP') + '円' : '—'}</td>
                  <td>{o.taxAmount != null ? o.taxAmount.toLocaleString('ja-JP') + '円' : '—'}</td>
                  <td><span className="badge badge-default">{String(o.status ?? '—')}</span></td>
                  <td>
                    {o.id && (
                      <Link to={`/invoice/${o.id}`} className="btn" style={{ fontSize: 12, padding: '4px 10px' }}>
                        請求書
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
