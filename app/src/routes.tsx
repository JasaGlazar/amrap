import { Navigate, Outlet, redirect, type RouteObject } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth, RequireRole, RoleRedirect } from './auth/guards';
import { fromError } from './i18n';
import { supabase } from './lib/supabase';
import { CustomerShell } from './pages/CustomerPages';
import { CustomerCalendar } from './pages/customer/Calendar';
import { CustomerHistory } from './pages/customer/History';
import { CustomerHome } from './pages/customer/Home';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { LogoutFailedPage } from './pages/LogoutFailedPage';
import { TrainerCustomers, TrainerSettings, TrainerShell } from './pages/TrainerPages';
import { TrainerCalendar } from './pages/trainer/Calendar';
import { TrainerToday } from './pages/trainer/Today';

function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('sign out failed', error);
    return { message: fromError(error) };
  }
  return redirect('/login');
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/invite/:token', element: <InvitePage /> },
      { path: '/logout', loader: logout, element: <LogoutFailedPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <RoleRedirect /> },
          {
            element: <RequireRole role="customer" />,
            children: [
              {
                path: '/c',
                element: <CustomerShell />,
                children: [
                  { index: true, element: <CustomerHome /> },
                  { path: 'koledar', element: <CustomerCalendar /> },
                  { path: 'zgodovina', element: <CustomerHistory /> },
                ],
              },
            ],
          },
          {
            element: <RequireRole role="trainer" />,
            children: [
              {
                path: '/t',
                element: <TrainerShell />,
                children: [
                  { index: true, element: <TrainerToday /> },
                  { path: 'koledar', element: <TrainerCalendar /> },
                  { path: 'stranke', element: <TrainerCustomers /> },
                  { path: 'nastavitve', element: <TrainerSettings /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
