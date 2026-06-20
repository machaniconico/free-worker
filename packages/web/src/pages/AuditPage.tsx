import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

interface AuditEntry {
  id?: string;
  entityType?: string;
  action?: string;
  entityId?: string;
  actorId?: string;
  createdAt?: string;
  detail?: unknown;
  [k: string]: unknown;
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (action) params.set('action', action);
      const qs = params.toString();
      api.get<AuditEntry[]>(`/api/audit${qs ? '?' + qs : ''}`)
        .then(setEntries)
        .catch((e: unknown) => setError(String(e)))
        .finally(() => setLoading(false));
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [entityType, action]);

  return (
    <div>
      <h1>監査ログ</h1>
      <p className="lead">システム操作の履歴を確認します。フィルタで絞り込みができます。</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0 }}>
          <span>エンティティ種別</span>
          <input
            type="text"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="例: product"
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)' }}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <span>アクション</span>
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="例: create"
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)' }}
          />
        </div>
        <a href="/api/audit/export" className="btn" download>CSVエクスポート</a>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>読み込み中…</p>}

      <section className="card">
        <h2>ログ一覧</h2>
        {!loading && entries.length === 0 && !error && (
          <p style={{ color: 'var(--muted)' }}>ログがありません。</p>
        )}
        {entries.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>エンティティ種別</th>
                <th>アクション</th>
                <th>エンティティID</th>
                <th>アクターID</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id ?? i}>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{String(e.createdAt ?? '—')}</td>
                  <td><span className="badge badge-default">{String(e.entityType ?? '—')}</span></td>
                  <td><span className="badge badge-muted">{String(e.action ?? '—')}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(e.entityId ?? '—')}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{String(e.actorId ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
