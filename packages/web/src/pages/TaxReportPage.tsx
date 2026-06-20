import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface AnnualReportMonth {
  month: string;
  salesTaxIncluded: number;
  taxAmount: number;
  expenseTaxIncluded: number;
  grossProfit: number;
  withholdingTax: number;
}

interface AnnualReport {
  year: number | null;
  salesTotal: number;
  taxAmountTotal: number;
  expenseTotal: number;
  grossProfit: number;
  withholdingTotal: number;
  totals: {
    salesTaxIncluded: number;
    taxAmount: number;
    expenseTaxIncluded: number;
    grossProfit: number;
    withholdingTax: number;
  };
  months: AnnualReportMonth[];
}

function fmtYen(n: number) {
  return '¥' + n.toLocaleString('ja-JP');
}

function currentYear() {
  return new Date().getFullYear();
}

export function TaxReportPage() {
  const [year, setYear] = useState(currentYear());
  const [report, setReport] = useState<AnnualReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.get<AnnualReport>(`/api/tax-report?year=${year}`)
      .then(setReport)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [year]);

  return (
    <div>
      <h1>確定申告</h1>
      <p className="lead">年間の売上・経費・粗利を集計します。</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0 }}>
          <span>対象年</span>
          <input
            type="number"
            value={year}
            min={2000}
            max={2100}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{
              padding: '8px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--panel-2)',
              color: 'var(--text)', width: 100,
            }}
          />
        </div>
        <a href={`/api/tax-report/export?year=${year}`} className="btn" download>
          CSVダウンロード
        </a>
      </div>

      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
      {loading && <p style={{ color: 'var(--muted)', marginTop: 12 }}>読み込み中…</p>}

      {!loading && report && (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">年間売上</div>
              <div className="kpi-value">{fmtYen(report.totals.salesTaxIncluded)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">消費税合計</div>
              <div className="kpi-value">{fmtYen(report.totals.taxAmount)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">年間経費</div>
              <div className="kpi-value">{fmtYen(report.totals.expenseTaxIncluded)}</div>
            </div>
            <div className="kpi-card accent-green">
              <div className="kpi-label">年間粗利</div>
              <div className="kpi-value">{fmtYen(report.totals.grossProfit)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">源泉徴収税合計(前払い分)</div>
              <div className="kpi-value">{fmtYen(report.totals.withholdingTax ?? report.withholdingTotal ?? 0)}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                確定申告で所得税の前払いとして控除できます
              </div>
            </div>
          </div>

          {report.months.length > 0 && (
            <section className="card">
              <h2>月別内訳</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>月</th>
                    <th style={{ textAlign: 'right' }}>売上(税込)</th>
                    <th style={{ textAlign: 'right' }}>消費税</th>
                    <th style={{ textAlign: 'right' }}>経費(税込)</th>
                    <th style={{ textAlign: 'right' }}>粗利</th>
                    <th style={{ textAlign: 'right' }}>源泉徴収</th>
                  </tr>
                </thead>
                <tbody>
                  {report.months.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}</td>
                      <td style={{ textAlign: 'right' }}>{fmtYen(m.salesTaxIncluded)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtYen(m.taxAmount)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtYen(m.expenseTaxIncluded)}</td>
                      <td style={{ textAlign: 'right', color: m.grossProfit >= 0 ? 'var(--accent-2)' : 'var(--danger)' }}>
                        {fmtYen(m.grossProfit)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {m.withholdingTax != null && m.withholdingTax > 0 ? fmtYen(m.withholdingTax) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td>合計</td>
                    <td style={{ textAlign: 'right' }}>{fmtYen(report.totals.salesTaxIncluded)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtYen(report.totals.taxAmount)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtYen(report.totals.expenseTaxIncluded)}</td>
                    <td style={{ textAlign: 'right', color: report.totals.grossProfit >= 0 ? 'var(--accent-2)' : 'var(--danger)' }}>
                      {fmtYen(report.totals.grossProfit)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {fmtYen(report.totals.withholdingTax ?? report.withholdingTotal ?? 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </section>
          )}

          {report.months.length === 0 && (
            <section className="card">
              <p style={{ color: 'var(--muted)' }}>{year}年のデータがありません。</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
