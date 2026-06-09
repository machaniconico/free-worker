import { NavLink, Outlet } from 'react-router-dom';

const NAV: ReadonlyArray<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'ホーム', end: true },
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
