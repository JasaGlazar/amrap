import { Navigate, Outlet } from 'react-router';
import { t } from '../i18n';
import { LookupFailedPage } from '../pages/LookupFailedPage';
import { NotLinkedPage } from '../pages/NotLinkedPage';
import { useAuth, type Role } from './AuthContext';

export function homePath(role: Role): string {
  return role === 'trainer' ? '/t' : '/c';
}

export function RequireAuth() {
  const { loading, session, customer, lookupFailed } = useAuth();
  if (loading) return <p className="status">{t.common.loading}</p>;
  if (session === null) return <Navigate to="/login" replace />;
  if (lookupFailed) return <LookupFailedPage />;
  if (customer === null) return <NotLinkedPage />;
  return <Outlet />;
}

export function RequireRole({ role }: { role: Role }) {
  const { customer } = useAuth();
  if (customer === null) return <NotLinkedPage />; // RequireAuth already handles this
  if (customer.role !== role) return <Navigate to={homePath(customer.role)} replace />;
  return <Outlet />;
}

export function RoleRedirect() {
  const { customer } = useAuth();
  if (customer === null) return <NotLinkedPage />; // RequireAuth already handles this
  return <Navigate to={homePath(customer.role)} replace />;
}
