import { useEffect, useState } from 'react';
import { api } from '../api.js';

// ── Types ────────────────────────────────────────────────────────────────────

type BillingPeriod = 'monthly' | 'yearly';
type RecurringBillingStatus = 'active' | 'paused' | 'ended';

interface RecurringBilling {
  id: string;
  customerId?: string | null;
  productId: string;
  planName: string;
  amountTaxIncluded: number;
  taxAmount?: number | null;
  billingPeriod: BillingPeriod;
  startDate: string;
  nextBillingDate: string;
  status: RecurringBillingStatus;
  lastGeneratedOrderId?: string | null;
  note?: string | null;
  createdAt: string;
}

interface RunResult {
  asOf: string;
  generated: Array<{ billingId: number; order: { id: string; orderNo?: string; [k: string]: unknown } }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<BillingPeriod, string> = {
  monthly: '月次',
  yearly: '年次',
};

const STATUS_LABELS: Record<RecurringBillingStatus, string> = {
  active: '有効',
  paused: '停止中',
  ended: '終了',
};

const STATUS_BADGE: Record<RecurringBillingStatus, string> = {
  active: 'badge badge-ok',
  paused: 'badge badge-info',
  ended: 'badge badge-muted',
};

function fmtYen(v: number): string {
  return v.toLocaleString('ja-JP') + '円';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RecurringBillingPage() {
  const [billings, setBillings] = useState<RecurringBilling[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formProductId, setFormProductId] = useState('');
  const [formPlanName, setFormPlanName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formTaxAmount, setFormTaxAmount] = useState('');
  const [formPeriod, setFormPeriod] = useState<BillingPeriod>('monthly');
  const [formStartDate, setFormStartDate] = useState('');
  const [formNextBillingDate, setFormNextBillingDate] = useState('');
  const [formStatus, setFormStatus] = useState<RecurringBillingStatus>('active');
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // per-row action feedback
  const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});

  // run billing
  const [runLoading, setRunLoading] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = () => {
    setLoading(true);
    api.get<RecurringBilling[]>('/api/recurring-billings')
      .then(setBillings)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // ── Form helpers ────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditId(null);
    setFormCustomerId('');
    setFormProductId('');
    setFormPlanName('');
    setFormAmount('');
    setFormTaxAmount('');
    setFormPeriod('monthly');
    setFormStartDate(todayIso());
    setFormNextBillingDate('');
    setFormStatus('active');
    setFormNote('');
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (b: RecurringBilling) => {
    setEditId(b.id);
    setFormCustomerId(b.customerId != null ? String(b.customerId) : '');
    setFormProductId(String(b.productId));
    setFormPlanName(b.planName);
    setFormAmount(String(b.amountTaxIncluded));
    setFormTaxAmount(b.taxAmount != null ? String(b.taxAmount) : '');
    setFormPeriod(b.billingPeriod);
    setFormStartDate(b.startDate);
    setFormNextBillingDate(b.nextBillingDate);
    setFormStatus(b.status);
    setFormNote(b.note ?? '');
    setFormError(null);
    setFormOpen(true);
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    setFormLoading(true);

    const body = {
      customerId: formCustomerId ? parseInt(formCustomerId, 10) : undefined,
      productId: parseInt(formProductId, 10),
      planName: formPlanName,
      amountTaxIncluded: parseInt(formAmount, 10),
      taxAmount: formTaxAmount ? parseInt(formTaxAmount, 10) : undefined,
      billingPeriod: formPeriod,
      startDate: formStartDate,
      nextBillingDate: formNextBillingDate || undefined,
      status: formStatus,
      note: formNote || undefined,
    };

    try {
      if (editId) {
        await api.put(`/api/recurring-billings/${editId}`, body);
      } else {
        await api.post('/api/recurring-billings', body);
      }
      setFormOpen(false);
      load();
    } catch (e: unknown) {
      setFormError(String(e));
    } finally {
      setFormLoading(false);
    }
  };

  // ── Status change ───────────────────────────────────────────────────────────

  const handleStatusChange = async (id: string, status: RecurringBillingStatus) => {
    setStatusLoading((prev) => ({ ...prev, [id]: true }));
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      const updated = await api.post<RecurringBilling>(`/api/recurring-billings/${id}/status`, { status });
      setBillings((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (e: unknown) {
      setActionError((prev) => ({ ...prev, [id]: String(e) }));
    } finally {
      setStatusLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string, planName: string) => {
    if (!window.confirm(`定期請求「${planName}」を削除しますか?`)) return;
    try {
      await api.del(`/api/recurring-billings/${id}`);
      setBillings((prev) => prev.filter((b) => b.id !== id));
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  // ── Run billing ─────────────────────────────────────────────────────────────

  const handleRun = async () => {
    setRunLoading(true);
    setRunMsg(null);
    setRunError(null);
    try {
      const result = await api.post<RunResult>('/api/recurring-billings/run', { asOf: todayIso() });
      const count = result.generated.length;
      setRunMsg(`請求実行完了 (${result.asOf}): ${count} 件の注文を生成しました。`);
      if (count > 0) load();
    } catch (e: unknown) {
      setRunError(String(e));
    } finally {
      setRunLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div>
      <h1>定期請求管理</h1>
      <p className="lead">顧客の継続契約(月額・年額)を登録し、期日到来分の注文を自動生成します。</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn" onClick={openCreate}>+ 定期請求追加</button>
        <button
          className="btn primary"
          disabled={runLoading}
          onClick={() => void handleRun()}
        >
          {runLoading ? '実行中…' : '請求実行 (本日分)'}
        </button>
      </div>

      {runMsg && (
        <p style={{ color: 'var(--accent-2)', marginTop: 8, fontSize: 14 }}>{runMsg}</p>
      )}
      {runError && <p className="error" style={{ marginTop: 8 }}>{runError}</p>}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      {loading && <p style={{ color: 'var(--muted)', marginTop: 8 }}>読み込み中…</p>}

      {/* ── 作成/編集フォーム ── */}
      {formOpen && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{editId ? '定期請求編集' : '定期請求追加'}</h2>
          <form onSubmit={(ev) => void handleSubmit(ev)}>
            <div className="field">
              <span>プラン名</span>
              <input
                type="text"
                value={formPlanName}
                onChange={(e) => setFormPlanName(e.target.value)}
                placeholder="例: 月額保守プラン"
                required
              />
            </div>
            <div className="field">
              <span>商品ID</span>
              <input
                type="number"
                value={formProductId}
                onChange={(e) => setFormProductId(e.target.value)}
                placeholder="商品IDを入力"
                min={1}
                step={1}
                required
              />
            </div>
            <div className="field">
              <span>顧客ID</span>
              <input
                type="number"
                value={formCustomerId}
                onChange={(e) => setFormCustomerId(e.target.value)}
                placeholder="任意 — 顧客IDを入力"
                min={1}
                step={1}
              />
            </div>
            <div className="field">
              <span>金額(税込・円)</span>
              <input
                type="number"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="例: 11000"
                min={0}
                step={1}
                required
              />
            </div>
            <div className="field">
              <span>うち消費税(円)</span>
              <input
                type="number"
                value={formTaxAmount}
                onChange={(e) => setFormTaxAmount(e.target.value)}
                placeholder="任意"
                min={0}
                step={1}
              />
            </div>
            <div className="field">
              <span>請求周期</span>
              <select
                value={formPeriod}
                onChange={(e) => setFormPeriod(e.target.value as BillingPeriod)}
              >
                {(Object.keys(PERIOD_LABELS) as BillingPeriod[]).map((p) => (
                  <option key={p} value={p}>{PERIOD_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <span>開始日</span>
              <input
                type="date"
                value={formStartDate}
                onChange={(e) => setFormStartDate(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <span>次回請求日</span>
              <input
                type="date"
                value={formNextBillingDate}
                onChange={(e) => setFormNextBillingDate(e.target.value)}
              />
            </div>
            <div className="field">
              <span>状態</span>
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as RecurringBillingStatus)}
              >
                {(Object.keys(STATUS_LABELS) as RecurringBillingStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ alignItems: 'flex-start' }}>
              <span style={{ paddingTop: 6 }}>備考</span>
              <textarea
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="任意"
                rows={2}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text)',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  fontSize: 14,
                }}
              />
            </div>

            {formError && <p className="error">{formError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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

      {/* ── 一覧 ── */}
      <section className="card">
        <h2>定期請求一覧</h2>
        {!loading && billings.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>定期請求が登録されていません。</p>
        )}
        {billings.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>プラン名</th>
                <th>商品ID</th>
                <th>顧客ID</th>
                <th>金額(税込)</th>
                <th>周期</th>
                <th>開始日</th>
                <th>次回請求日</th>
                <th>状態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {billings.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.planName}</td>
                  <td>{b.productId}</td>
                  <td>{b.customerId ?? '—'}</td>
                  <td>{fmtYen(b.amountTaxIncluded)}</td>
                  <td>{PERIOD_LABELS[b.billingPeriod] ?? b.billingPeriod}</td>
                  <td>{b.startDate}</td>
                  <td>{b.nextBillingDate}</td>
                  <td>
                    <span className={STATUS_BADGE[b.status] ?? 'badge badge-default'}>
                      {STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        value={b.status}
                        disabled={statusLoading[b.id]}
                        onChange={(e) => void handleStatusChange(b.id, e.target.value as RecurringBillingStatus)}
                        style={{
                          padding: '3px 6px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--panel-2)',
                          color: 'var(--text)',
                          fontSize: 12,
                        }}
                      >
                        {(Object.keys(STATUS_LABELS) as RecurringBillingStatus[]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>

                      <button
                        className="btn"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => openEdit(b)}
                      >
                        編集
                      </button>

                      <button
                        className="btn"
                        style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger)' }}
                        onClick={() => void handleDelete(b.id, b.planName)}
                      >
                        削除
                      </button>
                    </div>

                    {actionError[b.id] && (
                      <p className="error" style={{ fontSize: 12, margin: '4px 0 0' }}>
                        {actionError[b.id]}
                      </p>
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
