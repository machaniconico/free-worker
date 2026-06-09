import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Obligation {
  id: string;
  category: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: string;
  sourceId?: string;
  dueStatus?: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: '未対応',
  done: '完了',
  skipped: 'スキップ',
  in_progress: '対応中',
};

function statusClass(s: string) {
  if (s === 'done') return 'badge badge-ok';
  if (s === 'skipped') return 'badge badge-muted';
  if (s === 'in_progress') return 'badge badge-warn';
  return 'badge badge-default';
}

function dueStatusClass(d?: string) {
  if (d === 'overdue') return 'badge badge-danger';
  if (d === 'due_soon') return 'badge badge-warn';
  return '';
}

export function ChecklistPage() {
  const [items, setItems] = useState<Obligation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<Obligation[]>('/api/obligations')
      .then(setItems)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const changeStatus = async (id: string, status: string) => {
    try {
      await api.post(`/api/obligations/${id}/status`, { status });
      load();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  // Group by category
  const byCategory: Record<string, Obligation[]> = {};
  for (const item of items) {
    const cat = item.category ?? '未分類';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }

  return (
    <div>
      <h1>法令・税務チェックリスト</h1>
      <p className="lead">義務・手続きの状態を管理します。カテゴリごとに整理されます。</p>

      {error && <p className="error">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      {Object.entries(byCategory).map(([cat, catItems]) => (
        <section className="card" key={cat}>
          <h2>{cat}</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>タイトル</th>
                <th>期日</th>
                <th>状態</th>
                <th>出典</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {catItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div>{item.title}</div>
                    {item.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{item.description}</div>}
                  </td>
                  <td>
                    {item.dueDate && (
                      <span>
                        {item.dueDate}
                        {item.dueStatus && (
                          <span className={dueStatusClass(item.dueStatus)} style={{ marginLeft: 6 }}>
                            {item.dueStatus === 'overdue' ? '超過' : '間近'}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td><span className={statusClass(item.status)}>{STATUS_LABELS[item.status] ?? item.status}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{item.sourceId ?? '—'}</td>
                  <td>
                    <select
                      value={item.status}
                      onChange={(e) => void changeStatus(item.id, e.target.value)}
                      style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13 }}
                    >
                      {Object.entries(STATUS_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {!loading && items.length === 0 && !error && (
        <section className="card">
          <p style={{ color: 'var(--muted)' }}>チェックリスト項目がありません。</p>
        </section>
      )}
    </div>
  );
}
