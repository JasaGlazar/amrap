import { Navigate, Outlet } from 'react-router';
import { t } from '../i18n';
import { NotLinkedPage } from '../pages/NotLinkedPage';
import { useAuth, type Role } from './AuthContext';

export function homePath(role: Role): string {
  return role === 'trainer' ? '/t' : '/c';
}

// Layout route: everything below needs a signed-in user linked to a customers row.
export function RequireAuth() {
  const { loading, session, customer } = useAuth();
  if (loading) return <p className="status">{t.common.loading}</p>;
  if (session === null) return <Navigate to="/login" replace />;
  if (customer === null) return <NotLinkedPage />;
  return <Outlet />;
}

// Layout route inside RequireAuth: sends the other role to its own home.
export function RequireRole({ role }: { role: Role }) {
  const { customer } = useAuth();
  if (customer === null) return <Navigate to="/" replace />;
  if (customer.role !== role) return <Navigate to={homePath(customer.role)} replace />;
  return <Outlet />;
}

// The "/" route inside RequireAuth.
export function RoleRedirect() {
  const { customer } = useAuth();
  if (customer === null) return <Navigate to="/login" replace />;
  return <Navigate to={homePath(customer.role)} replace />;
}
