import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../lib/auth';
import { useCycle, ARABIC_MONTHS } from '../lib/cycle';
import { useConnectionStatus } from '../lib/useConnectionStatus';

const NAV_ITEMS = [
  { to: '/', label: 'الرئيسية', icon: '🏠' },
  { to: '/entities', label: 'الجهات', icon: '🏢' },
  { to: '/import', label: 'استيراد الكشوف', icon: '📥' },
  { to: '/cash', label: 'جرد النقدية', icon: '💵' },
  { to: '/reconciliation', label: 'المراجعة المالية', icon: '⚖️' },
  { to: '/history', label: 'History', icon: '🕘' },
  { to: '/archive', label: 'أرشيف الدورات', icon: '🗄️' },
];

function ConnectionBadge() {
  const status = useConnectionStatus();
  const label = status === 'online' ? 'متصل' : status === 'offline' ? 'غير متصل' : 'جارٍ إعادة الاتصال...';
  return (
    <span className={clsx('conn-badge', `conn-${status}`)} title={label}>
      <span className="conn-dot" /> {label}
    </span>
  );
}

function CycleSwitcher() {
  const { cycles, activeCycle, setActiveCycleId } = useCycle();
  if (!activeCycle) return <span className="muted">لا توجد دورة بعد</span>;
  return (
    <select
      className="cycle-select"
      value={activeCycle.id}
      onChange={(e) => setActiveCycleId(e.target.value)}
    >
      {cycles.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} {c.status === 'closed' ? '(مغلقة)' : ''}
        </option>
      ))}
    </select>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">جردة القبض</div>
        <CycleSwitcher />
        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => clsx('nav-item', isActive && 'nav-item-active')}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ConnectionBadge />
          <div className="user-row">
            <span>{profile?.display_name ?? '...'}</span>
            <button className="link-btn" onClick={signOut}>تسجيل الخروج</button>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => clsx('bottom-nav-item', isActive && 'bottom-nav-item-active')}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function monthLabel(year: number, month: number) {
  return `${ARABIC_MONTHS[month - 1]} ${year}`;
}
