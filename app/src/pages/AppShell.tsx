import { NavLink, Outlet } from 'react-router';
import { AccountMenu } from './shared/AccountMenu';
import { BrandMark } from './shared/BrandMark';
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
        <BrandMark />
        <nav className="main-nav" aria-label={label}>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <AccountMenu />
      </header>
      <main className="page">
        <InstallCard audience={audience} />
        <Outlet />
      </main>
    </div>
  );
}
