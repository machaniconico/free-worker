import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';

interface InvoiceItem {
  productTitle: string;
  quantity: number;
  unitPriceTaxIncluded: number;
  subtotalTaxIncluded: number;
  taxRate: number;
}

interface TaxRateBreakdown {
  taxRate: number;
  taxableAmountTaxIncluded: number;
  taxAmount: number;
}

interface InvoiceView {
  qualified: boolean;
  issuer: { name: string; invoiceRegistrationNumber?: string };
  buyer: { name?: string };
  order: { id: string; orderNo?: string; orderedAt?: string };
  items: InvoiceItem[];
  taxRateBreakdown: TaxRateBreakdown[];
  totalTaxIncluded: number;
}

function fmtYen(n: number) {
  return '¥' + n.toLocaleString('ja-JP');
}

export function InvoicePrintPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    api.get<InvoiceView>(`/api/invoices/${orderId}/view`)
      .then(setInvoice)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <p style={{ padding: 32, color: 'var(--muted)' }}>読み込み中…</p>;
  if (error) return <p style={{ padding: 32, color: 'var(--danger)' }}>エラー: {error}</p>;
  if (!invoice) return <p style={{ padding: 32, color: 'var(--muted)' }}>請求書が見つかりません。</p>;

  return (
    <div className="invoice-wrap">
      {/* Screen-only header: print button + nav hint */}
      <div className="invoice-screen-header">
        <button className="btn primary" onClick={() => window.print()}>
          印刷 / PDF保存
        </button>
        <a href="/sales" className="btn" style={{ marginLeft: 8 }}>← 売上一覧に戻る</a>
      </div>

      {/* Unqualified warning */}
      {!invoice.qualified && (
        <div className="invoice-unqualified-banner">
          ⚠️ 登録番号未設定 — 適格請求書の要件を満たしていません
        </div>
      )}

      {/* Invoice body */}
      <div className="invoice-body">
        <h1 className="invoice-title">
          {invoice.qualified ? '適格請求書' : '請求書'}
        </h1>

        <div className="invoice-meta">
          <div className="invoice-meta-left">
            <div className="invoice-to">
              <span className="invoice-label">請求先</span>
              <strong>{invoice.buyer.name ?? '—'} 御中</strong>
            </div>
          </div>
          <div className="invoice-meta-right">
            <div><span className="invoice-label">発行者</span>{invoice.issuer.name}</div>
            {invoice.issuer.invoiceRegistrationNumber && (
              <div>
                <span className="invoice-label">登録番号</span>
                {invoice.issuer.invoiceRegistrationNumber}
              </div>
            )}
            {invoice.order.orderNo && (
              <div><span className="invoice-label">注文番号</span>{invoice.order.orderNo}</div>
            )}
            {invoice.order.orderedAt && (
              <div><span className="invoice-label">注文日</span>{invoice.order.orderedAt}</div>
            )}
          </div>
        </div>

        {/* Line items */}
        <table className="invoice-table">
          <thead>
            <tr>
              <th>品目</th>
              <th style={{ textAlign: 'center' }}>数量</th>
              <th style={{ textAlign: 'right' }}>単価(税込)</th>
              <th style={{ textAlign: 'right' }}>小計(税込)</th>
              <th style={{ textAlign: 'center' }}>税率</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, i) => (
              <tr key={i}>
                <td>{item.productTitle}</td>
                <td style={{ textAlign: 'center' }}>{item.quantity}</td>
                <td style={{ textAlign: 'right' }}>{fmtYen(item.unitPriceTaxIncluded)}</td>
                <td style={{ textAlign: 'right' }}>{fmtYen(item.subtotalTaxIncluded)}</td>
                <td style={{ textAlign: 'center' }}>{item.taxRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Tax rate breakdown */}
        {invoice.taxRateBreakdown.length > 0 && (
          <div className="invoice-breakdown">
            <div className="invoice-breakdown-title">税率別内訳</div>
            {invoice.taxRateBreakdown.map((row, i) => (
              <div key={i} className="invoice-breakdown-row">
                <span>{row.taxRate}% 対象</span>
                <span>{fmtYen(row.taxableAmountTaxIncluded)}</span>
                <span>消費税 {fmtYen(row.taxAmount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Total */}
        <div className="invoice-total">
          <span>合計(税込)</span>
          <strong>{fmtYen(invoice.totalTaxIncluded)}</strong>
        </div>
      </div>
    </div>
  );
}
