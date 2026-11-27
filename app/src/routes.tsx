import { Navigate, Outlet, redirect, type RouteObject } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth, RequireRole, RoleRedirect } from './auth/guards';
import { fromError } from './i18n';
import { supabase } from './lib/supabase';
import { browserPlatform } from './push/browser';
import { disablePush } from './push/subscribe';
import { CustomerShell } from './pages/CustomerPages';
import { CustomerCalendar } from './pages/customer/Calendar';
import { CustomerHistory } from './pages/customer/History';
import { CustomerHome } from './pages/customer/Home';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { LogoutFailedPage } from './pages/LogoutFailedPage';
import { RegisterPage } from './pages/RegisterPage';
import { TrainerShell } from './pages/TrainerPages';
import { TrainerSettings } from './pages/trainer/Settings';
import { SettingsBlocked } from './pages/trainer/SettingsBlocked';
import { SettingsCutoff } from './pages/trainer/SettingsCutoff';
import { SettingsNotifications } from './pages/trainer/SettingsNotifications';
import { SettingsTemplates } from './pages/trainer/SettingsTemplates';
import { TrainerCustomerDetail } from './pages/trainer/CustomerDetail';
import { TrainerCustomers } from './pages/trainer/Customers';
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
  try {
    const userId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
    const removed = await disablePush(supabase, browserPlatform, userId);
    if (!removed.ok) console.warn('removing the push subscription failed', removed.message);
  } catch (error) {
    console.warn('removing the push subscription failed', error);
  }
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
      { path: '/registracija', element: <RegisterPage /> },
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
                  { path: 'stranke/:id', element: <TrainerCustomerDetail /> },
                  {
                    path: 'nastavitve',
                    element: <TrainerSettings />,
                    children: [
                      { index: true, element: <Navigate to="urnik" replace /> },
                      { path: 'urnik', element: <SettingsTemplates /> },
                      { path: 'odpoved', element: <SettingsCutoff /> },
                      { path: 'zaprto', element: <SettingsBlocked /> },
                      { path: 'obvestila', element: <SettingsNotifications /> },
                    ],
                  },
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
