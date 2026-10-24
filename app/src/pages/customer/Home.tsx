import { useCallback, useState } from 'react';
import { useCustomer } from '../../auth/AuthContext';
import { upcomingAppointments, type Appointment } from '../../data/appointments';
import { balanceOf } from '../../data/credits';
import { getSettings } from '../../data/settings';
import { fill, formatBalance, formatTimeUntil, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatLongDay, formatTime, timeUntil } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { CancelDialog } from '../shared/CancelDialog';
import { PushToggle } from '../shared/PushToggle';

export function CustomerHome() {
  const customer = useCustomer();
  const load = useCallback(async () => {
    const now = new Date();
    const [settings, balance, upcoming] = await Promise.all([
      getSettings(supabase),
      balanceOf(supabase, customer.id),
      upcomingAppointments(supabase, customer.id, now),
    ]);
    return { now, settings, balance, upcoming };
  }, [customer.id]);
  const [state, reload] = useLoad(load);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [cancelled, setCancelled] = useState(false);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const { now, settings, balance, upcoming } = state.data;
  const { timeZone } = settings;
  const next = upcoming[0];
  const when = (appointment: Appointment) =>
    fill(t.slot.when, {
      day: formatLongDay(appointment.startsAt, timeZone),
      time: formatTime(appointment.startsAt, timeZone),
    });

  return (
    <>
      <h1>{t.nav.home}</h1>
      <section className="balance-panel">
        <p className="label">{t.customer.balanceLabel}</p>
        <p className="balance-row">
          <span className={balance < 0 ? 'balance negative' : 'balance'}>
            {formatBalance(balance)}
          </span>
          {balance < 0 && <span className="tag late">{t.customer.debt}</span>}
        </p>
      </section>
      {next !== undefined && (
        <section className="card" aria-label={t.customer.nextLabel}>
          <p className="label">{t.customer.nextLabel}</p>
          <p className="next-when">{when(next)}</p>
          <p>{formatTimeUntil(timeUntil(next.startsAt, now))}</p>
        </section>
      )}
      <h2>{t.customer.upcomingTitle}</h2>
      {cancelled && (
        <p role="status" className="ok">
          {t.cancelDialog.done}
        </p>
      )}
      {upcoming.length === 0 ? (
        <p>{t.customer.noUpcoming}</p>
      ) : (
        <ul className="list">
          {upcoming.map((appointment) => (
            <li key={appointment.id} aria-label={when(appointment)} className="row">
              <span>{when(appointment)}</span>
              <button
                type="button"
                className="button secondary small"
                onClick={() => setCancelling(appointment)}
              >
                {t.slot.cancel}
              </button>
            </li>
          ))}
        </ul>
      )}
      <PushToggle audience="customer" userId={customer.auth_user_id ?? ''} />
      {cancelling !== null && (
        <CancelDialog
          appointment={cancelling}
          settings={settings}
          onClose={() => {
            setCancelling(null);
            void reload();
          }}
          onCancelled={() => {
            setCancelling(null);
            setCancelled(true);
            void reload();
          }}
        />
      )}
    </>
  );
}
