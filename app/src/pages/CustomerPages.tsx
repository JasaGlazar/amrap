import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n';
import { supabase } from '../lib/supabase';
import { AppShell } from './AppShell';
import { PlaceholderPage } from './PlaceholderPage';

export function CustomerShell() {
  const items = [
    { to: '/c', label: t.nav.home, end: true },
    { to: '/c/calendar', label: t.nav.calendar },
    { to: '/c/history', label: t.nav.history },
  ];
  return <AppShell items={items} label={t.nav.customerLabel} />;
}

type BalanceState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; balance: number };

export function CustomerHome() {
  const { customer } = useAuth();
  const customerId = customer?.id;
  const [state, setState] = useState<BalanceState>({ status: 'loading' });

  useEffect(() => {
    if (customerId === undefined) return;
    let cancelled = false;
    void supabase
      .from('customer_balances')
      .select('balance')
      .eq('customer_id', customerId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setState(error ? { status: 'error' } : { status: 'ok', balance: data?.balance ?? 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return (
    <>
      <h1>{t.nav.home}</h1>
      <section className="card">
        <p className="label">{t.customer.balanceLabel}</p>
        {state.status === 'loading' && <p>{t.common.loading}</p>}
        {state.status === 'error' && <p role="alert">{t.customer.balanceLoadFailed}</p>}
        {state.status === 'ok' && (
          <p className={state.balance < 0 ? 'balance negative' : 'balance'}>{state.balance}</p>
        )}
      </section>
      <p>{t.customer.noUpcoming}</p>
    </>
  );
}

export function CustomerCalendar() {
  return <PlaceholderPage title={t.customer.calendarTitle} />;
}

export function CustomerHistory() {
  return <PlaceholderPage title={t.customer.historyTitle} />;
}
