import { useEffect, useState } from 'react';
import { api } from '../api.js';

// ── Types ────────────────────────────────────────────────────────────────────

type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted';

interface QuoteItem {
  id?: string;
  productId?: string | null;
  description?: string | null;
  quantity: number;
  unitPriceTaxIncluded: number;
  subtotalTaxIncluded?: number;
}

interface Quote {
  id: string;
  quoteNo: string;
  customerId?: string | null;
  issuedAt: string;
  validUntil?: string | null;
  status: QuoteStatus;
  subtotalTaxIncluded: number;
  taxAmount?: number | null;
  note?: string | null;
  convertedOrderId?: string | null;
  createdAt: string;
  items: QuoteItem[];
}

interface ConvertResult {
  quote: Quote;
  order: { id: string; orderNo?: string; [k: string]: unknown };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: '下書き',
  sent: '送付済',
  accepted: '承認済',
  declined: '辞退',
  expired: '期限切',
  converted: '注文変換済',
};

const STATUS_BADGE: Record<QuoteStatus, string> = {
  draft: 'badge badge-default',
  sent: 'badge badge-info',
  accepted: 'badge badge-ok',
  declined: 'badge badge-danger',
  expired: 'badge badge-muted',
  converted: 'badge badge-converted',
};

function fmtYen(v: number): string {
  return v.toLocaleString('ja-JP') + '円';
}

function calcClientTotal(items: FormItem[]): number {
  return items.reduce((sum, it) => {
    const qty = parseInt(it.quantity, 10) || 0;
    const unit = parseInt(it.unitPriceTaxIncluded, 10) || 0;
    return sum + qty * unit;
  }, 0);
}

// ── Form item state ───────────────────────────────────────────────────────────

interface FormItem {
  productId: string;
  description: string;
  quantity: string;
  unitPriceTaxIncluded: string;
}

function emptyFormItem(): FormItem {
  return { productId: '', description: '', quantity: '1', unitPriceTaxIncluded: '' };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formQuoteNo, setFormQuoteNo] = useState('');
  const [formIssuedAt, setFormIssuedAt] = useState('');
  const [formValidUntil, setFormValidUntil] = useState('');
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formStatus, setFormStatus] = useState<QuoteStatus>('draft');
  const [formItems, setFormItems] = useState<FormItem[]>([emptyFormItem()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // per-row action feedback
  const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>({});
  const [convertLoading, setConvertLoading] = useState<Record<string, boolean>>({});
  const [convertMsg, setConvertMsg] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = () => {
    setLoading(true);
    api.get<Quote[]>('/api/quotes')
      .then(setQuotes)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // ── Form helpers ────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditId(null);
    setFormQuoteNo('');
    setFormIssuedAt(new Date().toISOString().slice(0, 10));
    setFormValidUntil('');
    setFormCustomerId('');
    setFormNote('');
    setFormStatus('draft');
    setFormItems([emptyFormItem()]);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (q: Quote) => {
    setEditId(q.id);
    setFormQuoteNo(q.quoteNo);
    setFormIssuedAt(q.issuedAt);
    setFormValidUntil(q.validUntil ?? '');
    setFormCustomerId(q.customerId != null ? String(q.customerId) : '');
    setFormNote(q.note ?? '');
    setFormStatus(q.status);
    setFormItems(
      q.items.length > 0
        ? q.items.map((it) => ({
            productId: it.productId ?? '',
            description: it.description ?? '',
            quantity: String(it.quantity),
            unitPriceTaxIncluded: String(it.unitPriceTaxIncluded),
          }))
        : [emptyFormItem()],
    );
    setFormError(null);
    setFormOpen(true);
  };

  const addFormItem = () => setFormItems((prev) => [...prev, emptyFormItem()]);

  const removeFormItem = (idx: number) =>
    setFormItems((prev) => prev.filter((_, i) => i !== idx));

  const updateFormItem = (idx: number, field: keyof FormItem, value: string) =>
    setFormItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)),
    );

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    setFormLoading(true);

    const items = formItems
      .filter((it) => it.description.trim() || it.unitPriceTaxIncluded.trim())
      .map((it) => ({
        productId: it.productId.trim() || undefined,
        description: it.description.trim() || undefined,
        quantity: parseInt(it.quantity, 10) || 1,
        unitPriceTaxIncluded: parseInt(it.unitPriceTaxIncluded, 10) || 0,
      }));

    const body = {
      quoteNo: formQuoteNo,
      issuedAt: formIssuedAt,
      validUntil: formValidUntil || undefined,
      customerId: formCustomerId ? parseInt(formCustomerId, 10) : undefined,
      status: formStatus,
      note: formNote || undefined,
      items,
    };

    try {
      if (editId) {
        await api.put(`/api/quotes/${editId}`, body);
      } else {
        await api.post('/api/quotes', body);
      }
      setFormOpen(false);
      load();
    } catch (e: unknown) {
      setFormError(String(e));
    } finally {
      setFormLoading(false);
    }
  };

  // ── Status PATCH ────────────────────────────────────────────────────────────

  const handleStatusChange = async (id: string, status: QuoteStatus) => {
    setStatusLoading((prev) => ({ ...prev, [id]: true }));
    setActionError((prev) => ({ ...prev, [id]: '' }));
    try {
      const updated = await api.post<Quote>(`/api/quotes/${id}/status`, { status });
      setQuotes((prev) => prev.map((q) => (q.id === id ? updated : q)));
    } catch (e: unknown) {
      setActionError((prev) => ({ ...prev, [id]: String(e) }));
    } finally {
      setStatusLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  // ── Convert ─────────────────────────────────────────────────────────────────

  const handleConvert = async (id: string) => {
    setConvertLoading((prev) => ({ ...prev, [id]: true }));
    setActionError((prev) => ({ ...prev, [id]: '' }));
    setConvertMsg((prev) => ({ ...prev, [id]: '' }));
    try {
      const result = await api.post<ConvertResult>(`/api/quotes/${id}/convert`);
      const orderNo = result.order.orderNo ?? result.order.id;
      setConvertMsg((prev) => ({ ...prev, [id]: `注文変換完了 (注文番号: ${String(orderNo)})` }));
      setQuotes((prev) => prev.map((q) => (q.id === id ? result.quote : q)));
    } catch (e: unknown) {
      const err = e as { data?: { error?: string; message?: string } };
      if (err?.data?.error === 'cannot_convert') {
        setActionError((prev) => ({
          ...prev,
          [id]: `変換不可: ${err.data?.message ?? '変換済みまたは自由記述行が含まれています'}`,
        }));
      } else {
        setActionError((prev) => ({ ...prev, [id]: String(e) }));
      }
    } finally {
      setConvertLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async (id: string, quoteNo: string) => {
    if (!window.confirm(`見積書「${quoteNo}」を削除しますか?`)) return;
    try {
      await api.del(`/api/quotes/${id}`);
      setQuotes((prev) => prev.filter((q) => q.id !== id));
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const clientTotal = calcClientTotal(formItems);

  return (
    <div>
      <h1>見積書管理</h1>
      <p className="lead">見積書の作成・送付・注文変換を管理します。</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn" onClick={openCreate}>+ 見積書追加</button>
      </div>

      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      {loading && <p style={{ color: 'var(--muted)', marginTop: 8 }}>読み込み中…</p>}

      {/* ── 作成/編集フォーム ── */}
      {formOpen && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>{editId ? '見積書編集' : '見積書追加'}</h2>
          <form onSubmit={(ev) => void handleSubmit(ev)}>
            <div className="field">
              <span>見積番号</span>
              <input
                type="text"
                value={formQuoteNo}
                onChange={(e) => setFormQuoteNo(e.target.value)}
                placeholder="例: QUO-2026-001"
                required
              />
            </div>
            <div className="field">
              <span>発行日</span>
              <input
                type="date"
                value={formIssuedAt}
                onChange={(e) => setFormIssuedAt(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <span>有効期限</span>
              <input
                type="date"
                value={formValidUntil}
                onChange={(e) => setFormValidUntil(e.target.value)}
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
              <span>状態</span>
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as QuoteStatus)}
              >
                {(Object.keys(STATUS_LABELS) as QuoteStatus[]).map((s) => (
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

            {/* 明細行 */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>明細行</strong>
                <button type="button" className="btn" style={{ fontSize: 12, padding: '3px 10px' }} onClick={addFormItem}>
                  + 行追加
                </button>
              </div>
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>商品ID(任意)</th>
                    <th>説明</th>
                    <th style={{ width: 80 }}>数量</th>
                    <th style={{ width: 130 }}>単価(税込,円)</th>
                    <th style={{ width: 120 }}>小計</th>
                    <th style={{ width: 48 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {formItems.map((it, idx) => {
                    const qty = parseInt(it.quantity, 10) || 0;
                    const unit = parseInt(it.unitPriceTaxIncluded, 10) || 0;
                    const sub = qty * unit;
                    return (
                      <tr key={idx}>
                        <td>
                          <input
                            type="text"
                            value={it.productId}
                            onChange={(e) => updateFormItem(idx, 'productId', e.target.value)}
                            placeholder="任意"
                            style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13 }}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={it.description}
                            onChange={(e) => updateFormItem(idx, 'description', e.target.value)}
                            placeholder="説明"
                            style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13 }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={it.quantity}
                            onChange={(e) => updateFormItem(idx, 'quantity', e.target.value)}
                            min={1}
                            step={1}
                            style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13 }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={it.unitPriceTaxIncluded}
                            onChange={(e) => updateFormItem(idx, 'unitPriceTaxIncluded', e.target.value)}
                            min={0}
                            step={1}
                            placeholder="0"
                            style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13 }}
                          />
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: 13 }}>
                          {sub > 0 ? fmtYen(sub) : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn"
                            style={{ fontSize: 12, padding: '3px 8px' }}
                            onClick={() => removeFormItem(idx)}
                            disabled={formItems.length === 1}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--muted)', fontSize: 13 }}>
                      税込合計(表示)
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text)' }}>
                      {fmtYen(clientTotal)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <p className="hint" style={{ marginLeft: 0 }}>※ 合計はクライアント表示のみ。保存後はサーバーが正確な値を計算します。</p>
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
        <h2>見積一覧</h2>
        {!loading && quotes.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>見積書がありません。</p>
        )}
        {quotes.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>見積番号</th>
                <th>発行日</th>
                <th>有効期限</th>
                <th>状態</th>
                <th>税込合計</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td style={{ fontWeight: 500 }}>{q.quoteNo}</td>
                  <td>{q.issuedAt}</td>
                  <td>{q.validUntil ?? '—'}</td>
                  <td>
                    <span className={STATUS_BADGE[q.status] ?? 'badge badge-default'}>
                      {STATUS_LABELS[q.status] ?? q.status}
                    </span>
                  </td>
                  <td>{fmtYen(q.subtotalTaxIncluded)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* ステータス変更 */}
                      <select
                        value={q.status}
                        disabled={statusLoading[q.id]}
                        onChange={(e) => void handleStatusChange(q.id, e.target.value as QuoteStatus)}
                        style={{
                          padding: '3px 6px',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--panel-2)',
                          color: 'var(--text)',
                          fontSize: 12,
                        }}
                      >
                        {(Object.keys(STATUS_LABELS) as QuoteStatus[]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                        ))}
                      </select>

                      <button
                        className="btn"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => openEdit(q)}
                      >
                        編集
                      </button>

                      {/* 注文変換ボタン: accepted のみ */}
                      {q.status === 'accepted' && (
                        <button
                          className="btn primary"
                          style={{ fontSize: 12, padding: '4px 10px' }}
                          disabled={convertLoading[q.id]}
                          onClick={() => void handleConvert(q.id)}
                        >
                          {convertLoading[q.id] ? '変換中…' : '注文へ変換'}
                        </button>
                      )}

                      <button
                        className="btn"
                        style={{ fontSize: 12, padding: '4px 10px', color: 'var(--danger)' }}
                        onClick={() => void handleDelete(q.id, q.quoteNo)}
                      >
                        削除
                      </button>
                    </div>

                    {/* 変換成功メッセージ */}
                    {convertMsg[q.id] && (
                      <p style={{ color: 'var(--accent-2)', fontSize: 12, margin: '4px 0 0' }}>
                        {convertMsg[q.id]}
                      </p>
                    )}
                    {/* 行単位エラー */}
                    {actionError[q.id] && (
                      <p className="error" style={{ fontSize: 12, margin: '4px 0 0' }}>
                        {actionError[q.id]}
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
