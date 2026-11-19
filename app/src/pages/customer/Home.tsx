import { useCallback, useState } from 'react';
import { useCustomer } from '../../auth/AuthContext';
import {
  futureCancelledAppointments,
  undoCancel,
  upcomingAppointments,
  type Appointment,
} from '../../data/appointments';
import { balanceOf } from '../../data/credits';
import { getSettings } from '../../data/settings';
import { fill, formatBalance, formatTimeUntil, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatLongDay, formatTime, isFreeCancel, timeUntil } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { CancelDialog } from '../shared/CancelDialog';
import { PushToggle } from '../shared/PushToggle';

export function CustomerHome() {
  const customer = useCustomer();
  const load = useCallback(async () => {
    const now = new Date();
    const [settings, balance, upcoming, cancelled] = await Promise.all([
      getSettings(supabase),
      balanceOf(supabase, customer.id),
      upcomingAppointments(supabase, customer.id, now),
      futureCancelledAppointments(supabase, customer.id, now),
    ]);
    return { now, settings, balance, upcoming, cancelled };
  }, [customer.id]);
  const [state, reload] = useLoad(load);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [done, setDone] = useState<'cancelled' | 'restored' | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const { now, settings, balance, upcoming, cancelled } = state.data;
  const { timeZone, lateCancelHours } = settings;
  const next = upcoming[0];
  const bookedStarts = new Set(upcoming.map((appointment) => appointment.startsAt.getTime()));
  const undoable = cancelled.filter(
    (appointment) =>
      isFreeCancel(appointment.startsAt, lateCancelHours, now) &&
      !bookedStarts.has(appointment.startsAt.getTime()),
  );
  const when = (appointment: Appointment) =>
    fill(t.slot.when, {
      day: formatLongDay(appointment.startsAt, timeZone),
      time: formatTime(appointment.startsAt, timeZone),
    });

  async function undo(appointment: Appointment) {
    setUndoing(appointment.id);
    setDone(null);
    setUndoError(null);
    const result = await undoCancel(supabase, appointment.id);
    if (result.ok) {
      setDone('restored');
      await reload();
    } else {
      setUndoError(result.message);
    }
    setUndoing(null);
  }

  return (
    <>
      <h1>{t.nav.home}</h1>
      <section>
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
      {done !== null && (
        <p role="status" className="ok">
          {done === 'cancelled' ? t.cancelDialog.done : t.customer.restored}
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
      {undoable.length > 0 && (
        <section aria-labelledby="cancelled-title">
          <h2 id="cancelled-title">{t.customer.cancelledTitle}</h2>
          {undoError !== null && (
            <p role="alert" className="error">
              {undoError}
            </p>
          )}
          <ul className="list">
            {undoable.map((appointment) => (
              <li key={appointment.id} aria-label={when(appointment)} className="row">
                <span>{when(appointment)}</span>
                <button
                  type="button"
                  className="button secondary small"
                  disabled={undoing !== null}
                  onClick={() => void undo(appointment)}
                >
                  {t.customer.undo}
                </button>
              </li>
            ))}
          </ul>
        </section>
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
            setDone('cancelled');
            setUndoError(null);
            void reload();
          }}
        />
      )}
    </>
  );
}
