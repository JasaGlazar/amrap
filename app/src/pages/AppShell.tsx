import { NavLink, Outlet } from 'react-router';

export type NavItem = { to: string; label: string; end?: boolean };

export function AppShell({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <div className="shell">
      <main className="page">
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
