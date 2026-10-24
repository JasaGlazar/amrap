import { Link, NavLink, Outlet } from 'react-router';
import { t } from '../i18n';
import { InstallCard } from './shared/InstallCard';

export type NavItem = { to: string; label: string; end?: boolean };

export function AppShell({
  items,
  label,
  audience,
}: {
  items: NavItem[];
  label: string;
  audience: 'customer' | 'trainer';
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">{t.app.name}</span>
        <Link to="/logout">{t.common.signOut}</Link>
      </header>
      <main className="page">
        <InstallCard audience={audience} />
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label={label}>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
