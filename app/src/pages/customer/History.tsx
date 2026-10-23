import { useCallback } from 'react';
import { useCustomer } from '../../auth/AuthContext';
import { pastAppointments } from '../../data/appointments';
import { ledgerOf } from '../../data/credits';
import { getSettings } from '../../data/settings';
import { fill, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatDate, formatTime } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { LedgerList } from '../shared/LedgerList';

export function CustomerHistory() {
  const customer = useCustomer();
  const load = useCallback(async () => {
    const now = new Date();
    const [settings, appointments, ledger] = await Promise.all([
      getSettings(supabase),
      pastAppointments(supabase, customer.id, now),
      ledgerOf(supabase, customer.id),
    ]);
    return { settings, appointments, ledger };
  }, [customer.id]);
  const [state] = useLoad(load);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.customer.loadFailed}
      </p>
    );
  }

  const { settings, appointments, ledger } = state.data;
  const { timeZone } = settings;
  const when = (instant: Date) =>
    fill(t.slot.when, { day: formatDate(instant, timeZone), time: formatTime(instant, timeZone) });

  return (
    <>
      <h1>{t.customer.historyTitle}</h1>
      <section aria-labelledby="history-appointments">
        <h2 id="history-appointments">{t.history.appointmentsTitle}</h2>
        {appointments.length === 0 ? (
          <p>{t.history.noAppointments}</p>
        ) : (
          <ul className="list">
            {appointments.map((appointment) => (
              <li key={appointment.id} className="row">
                <span>{when(appointment.startsAt)}</span>
                <span className={`tag status-${appointment.status}`}>
                  {t.appointmentStatus[appointment.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="history-ledger">
        <h2 id="history-ledger">{t.history.ledgerTitle}</h2>
        <LedgerList ledger={ledger} timeZone={timeZone} />
      </section>
    </>
  );
}
