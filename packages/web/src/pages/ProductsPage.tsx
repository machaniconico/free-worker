import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Product {
  id?: string;
  sku: string;
  title: string;
  productType: string;
  priceTaxIncluded: number;
  licenseSummary?: string;
  operatingEnvironment?: string;
  refundPolicy?: string;
  status?: string;
}

interface CompletenessWarning {
  field: string;
  message: string;
  sourceIds?: string[];
  reason?: string;
}

const PRODUCT_TYPES = [
  { value: 'download', label: 'ダウンロード' },
  { value: 'course', label: 'コース' },
  { value: 'membership', label: 'メンバーシップ' },
  { value: 'template', label: 'テンプレート' },
  { value: 'service', label: 'サービス' },
  { value: 'other', label: 'その他' },
];

const EMPTY: Product = { sku: '', title: '', productType: 'download', priceTaxIncluded: 0 };

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<Product>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Record<string, CompletenessWarning[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<Product[]>('/api/products')
      .then(setProducts)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const loadWarnings = async (id: string) => {
    try {
      const res = await api.get<{ warnings: CompletenessWarning[] }>(`/api/products/${id}/completeness`);
      setWarnings((prev) => ({ ...prev, [id]: res.warnings }));
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    for (const p of products) {
      if (p.id) void loadWarnings(p.id);
    }
  }, [products]);

  const save = async () => {
    setError(null);
    try {
      if (editId) {
        await api.put<Product>(`/api/products/${editId}`, form);
      } else {
        await api.post<Product>('/api/products', form);
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
      await api.del(`/api/products/${id}`);
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const startEdit = (p: Product) => {
    setForm({ ...p });
    setEditId(p.id ?? null);
  };

  return (
    <div>
      <h1>商品・サブスク管理</h1>
      <p className="lead">販売商品の登録と掲載前チェックを管理します。</p>

      {error && <p className="error">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      {products.length > 0 && (
        <section className="card">
          <h2>商品一覧</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>タイトル</th>
                <th>種別</th>
                <th>税込価格</th>
                <th>状態</th>
                <th>チェック</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const ws = p.id ? (warnings[p.id] ?? []) : [];
                return (
                  <tr key={p.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{p.sku}</td>
                    <td>{p.title}</td>
                    <td>{PRODUCT_TYPES.find((t) => t.value === p.productType)?.label ?? p.productType}</td>
                    <td>{p.priceTaxIncluded.toLocaleString('ja-JP')}円</td>
                    <td><span className="badge badge-default">{p.status ?? '—'}</span></td>
                    <td>
                      {ws.length > 0 ? (
                        <span title={ws.map((w) => w.message).join('\n')} style={{ cursor: 'help', color: 'var(--danger)' }}>
                          ⚠️ {ws.length}件
                        </span>
                      ) : (
                        <span style={{ color: 'var(--accent-2)' }}>✓</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn" onClick={() => startEdit(p)}>編集</button>
                        {p.id && <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => void del(p.id!)}>削除</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Warnings detail */}
      {products.some((p) => p.id && (warnings[p.id]?.length ?? 0) > 0) && (
        <section className="card">
          <h2>掲載前チェック警告</h2>
          {products.map((p) => {
            const ws = p.id ? (warnings[p.id] ?? []) : [];
            if (ws.length === 0) return null;
            return (
              <div key={p.id} style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
                {ws.map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
                    <span style={{ color: 'var(--danger)' }}>⚠️</span>
                    <span style={{ color: 'var(--muted)', width: 100 }}>{w.field}</span>
                    <span>{w.message}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      )}

      <section className="card">
        <h2>{editId ? '商品編集' : '新規商品登録'}</h2>

        <label className="field">
          <span>SKU *</span>
          <input type="text" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="例: DL-001" />
        </label>
        <label className="field">
          <span>タイトル *</span>
          <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="field">
          <span>種別 *</span>
          <select value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })}>
            {PRODUCT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>税込価格(円) *</span>
          <input type="number" value={form.priceTaxIncluded} onChange={(e) => setForm({ ...form, priceTaxIncluded: Number(e.target.value) })} min={0} />
        </label>
        <label className="field">
          <span>ライセンス概要</span>
          <input type="text" value={form.licenseSummary ?? ''} onChange={(e) => setForm({ ...form, licenseSummary: e.target.value })} />
        </label>
        <label className="field">
          <span>動作環境</span>
          <input type="text" value={form.operatingEnvironment ?? ''} onChange={(e) => setForm({ ...form, operatingEnvironment: e.target.value })} />
        </label>
        <label className="field">
          <span>返金ポリシー</span>
          <input type="text" value={form.refundPolicy ?? ''} onChange={(e) => setForm({ ...form, refundPolicy: e.target.value })} />
        </label>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn primary" onClick={() => void save()}>{editId ? '更新' : '登録'}</button>
          {editId && <button className="btn" onClick={() => { setForm(EMPTY); setEditId(null); }}>キャンセル</button>}
          {saved && <span className="saved">保存しました</span>}
        </div>
      </section>
    </div>
  );
}
