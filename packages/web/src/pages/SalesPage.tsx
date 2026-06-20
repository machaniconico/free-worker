import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

interface Order {
  id?: string;
  orderedAt?: string;
  productTitle?: string;
  amountTaxIncluded?: number;
  taxAmount?: number;
  withholdingTax?: number | null;
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

interface WithholdingCalcResult {
  base: number;
  withholdingTax: number;
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

  // フォーム状態
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formOrderedAt, setFormOrderedAt] = useState('');
  const [formProductTitle, setFormProductTitle] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formTaxAmount, setFormTaxAmount] = useState('');
  const [formWithholdingTax, setFormWithholdingTax] = useState('');
  const [formStatus, setFormStatus] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);

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

  const openCreate = () => {
    setEditId(null);
    setFormOrderedAt('');
    setFormProductTitle('');
    setFormAmount('');
    setFormTaxAmount('');
    setFormWithholdingTax('');
    setFormStatus('');
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (o: Order) => {
    setEditId(o.id ?? null);
    setFormOrderedAt(typeof o.orderedAt === 'string' ? o.orderedAt : '');
    setFormProductTitle(typeof o.productTitle === 'string' ? o.productTitle : '');
    setFormAmount(o.amountTaxIncluded != null ? String(o.amountTaxIncluded) : '');
    setFormTaxAmount(o.taxAmount != null ? String(o.taxAmount) : '');
    setFormWithholdingTax(o.withholdingTax != null ? String(o.withholdingTax) : '');
    setFormStatus(typeof o.status === 'string' ? o.status : '');
    setFormError(null);
    setFormOpen(true);
  };

  /** 自動計算: サーバーに base を渡して源泉税額を取得。自前計算しない。 */
  const handleCalcWithholding = async () => {
    const base = parseInt(formAmount, 10);
    if (!formAmount || isNaN(base) || base < 0) {
      setFormError('自動計算には税込金額(0以上の整数)を先に入力してください。');
      return;
    }
    setFormError(null);
    setCalcLoading(true);
    try {
      const result = await api.get<WithholdingCalcResult>(`/api/tax-report/withholding?base=${base}`);
      setFormWithholdingTax(String(result.withholdingTax));
    } catch (e: unknown) {
      setFormError(`源泉税額の自動計算に失敗しました: ${String(e)}`);
    } finally {
      setCalcLoading(false);
    }
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    setFormLoading(true);

    const withholdingRaw = formWithholdingTax.trim();
    const body = {
      orderedAt: formOrderedAt || undefined,
      productTitle: formProductTitle || undefined,
      amountTaxIncluded: formAmount ? parseInt(formAmount, 10) : undefined,
      taxAmount: formTaxAmount ? parseInt(formTaxAmount, 10) : undefined,
      withholdingTax: withholdingRaw !== '' ? parseInt(withholdingRaw, 10) : null,
      status: formStatus || undefined,
    };

    try {
      if (editId) {
        await api.put(`/api/sales/${editId}`, body);
      } else {
        await api.post('/api/sales', body);
      }
      setFormOpen(false);
      load();
    } catch (e: unknown) {
      setFormError(String(e));
    } finally {
      setFormLoading(false);
    }
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
        <button className="btn" onClick={openCreate}>+ 注文追加</button>
      </div>

      {importMsg && <p style={{ color: 'var(--accent-2)', marginTop: 8 }}>{importMsg}</p>}
      {error && <p className="error">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      {/* 注文フォーム */}
      {formOpen && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{editId ? '注文編集' : '注文追加'}</h2>
          <form onSubmit={(ev) => void handleSubmit(ev)}>
            <div className="field">
              <span>注文日</span>
              <input
                type="date"
                value={formOrderedAt}
                onChange={(e) => setFormOrderedAt(e.target.value)}
              />
            </div>
            <div className="field">
              <span>商品名</span>
              <input
                type="text"
                value={formProductTitle}
                onChange={(e) => setFormProductTitle(e.target.value)}
                placeholder="商品・サービス名"
              />
            </div>
            <div className="field">
              <span>税込金額(円)</span>
              <input
                type="number"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="例: 110000"
                min={0}
                step={1}
              />
            </div>
            <div className="field">
              <span>消費税(円)</span>
              <input
                type="number"
                value={formTaxAmount}
                onChange={(e) => setFormTaxAmount(e.target.value)}
                placeholder="例: 10000"
                min={0}
                step={1}
              />
            </div>
            <div className="field">
              <span>源泉徴収税(円)</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  value={formWithholdingTax}
                  onChange={(e) => setFormWithholdingTax(e.target.value)}
                  placeholder="任意 — 空白で null"
                  min={0}
                  step={1}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleCalcWithholding()}
                  disabled={calcLoading}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {calcLoading ? '計算中…' : '自動計算'}
                </button>
              </div>
              <small style={{ color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                税込金額を入力後「自動計算」でサーバーが算出(10.21% または 20.42%)
              </small>
            </div>
            <div className="field">
              <span>状態</span>
              <input
                type="text"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value)}
                placeholder="例: paid / unpaid"
              />
            </div>
            {formError && <p className="error">{formError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="submit" className="btn" disabled={formLoading}>
                {formLoading ? '送信中…' : editId ? '更新' : '登録'}
              </button>
              <button type="button" className="btn" onClick={() => setFormOpen(false)}>
                キャンセル
              </button>
            </div>
          </form>
        </section>
      )}

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
                <th>源泉徴収</th>
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
                  <td>{o.withholdingTax != null ? o.withholdingTax.toLocaleString('ja-JP') + '円' : '—'}</td>
                  <td><span className="badge badge-default">{String(o.status ?? '—')}</span></td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => openEdit(o)}
                    >
                      編集
                    </button>
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
