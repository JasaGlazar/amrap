import { createContext, useContext, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { getSettings } from '../data/settings';
import { t } from '../i18n';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { AppShell } from './AppShell';

type Booking = 'loading' | 'off' | 'on';

const BookingContext = createContext<Booking>('loading');

const loadSettings = () => getSettings(supabase);

export function CustomerShell() {
  const [settings] = useLoad(loadSettings);
  // A failed read counts as off, so the app never offers booking it cannot confirm.
  const booking: Booking =
    settings.status === 'loading'
      ? 'loading'
      : settings.status === 'ok' && settings.data.customerBookingEnabled
        ? 'on'
        : 'off';
  const items = [
    { to: '/c', label: t.nav.home, end: true },
    ...(booking === 'on' ? [{ to: '/c/koledar', label: t.nav.calendar }] : []),
    { to: '/c/zgodovina', label: t.nav.history },
  ];
  return (
    <BookingContext.Provider value={booking}>
      <AppShell items={items} label={t.nav.customerLabel} audience="customer" />
    </BookingContext.Provider>
  );
}

export function CustomerBookingRoute({ children }: { children: ReactNode }) {
  const booking = useContext(BookingContext);
  if (booking === 'loading') return null;
  if (booking === 'off') return <Navigate to="/c" replace />;
  return children;
}
