import { NavLink, Outlet } from 'react-router-dom';

const NAV: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/dashboard', label: 'ダッシュボード' },
  { to: '/profile', label: '事業プロフィール' },
  { to: '/checklist', label: 'チェックリスト' },
  { to: '/products', label: '商品管理' },
  { to: '/sales', label: '売上・請求' },
  { to: '/expenses', label: '経費管理' },
  { to: '/documents', label: '文書・規約' },
  { to: '/customers', label: '顧客・同意' },
  { to: '/content', label: 'コンテンツ' },
  { to: '/backup', label: 'バックアップ' },
  { to: '/audit', label: '監査ログ' },
  { to: '/tax', label: '確定申告' },
  { to: '/settings', label: '設定' },
];

export function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">FW</span>
          <div>
            <div className="brand-title">free-worker</div>
            <div className="brand-sub">個人事業支援デスク</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'nav active' : 'nav')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="offline-badge" title="クラウドAIに依存しません">● ローカル動作 / AI非依存</div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
