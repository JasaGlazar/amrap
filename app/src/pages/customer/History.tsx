import { useCallback } from 'react';
import { useCustomer } from '../../auth/AuthContext';
import { pastAppointments } from '../../data/appointments';
import { ledgerOf } from '../../data/credits';
import { getSettings } from '../../data/settings';
import { t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { AppointmentHistory } from '../shared/AppointmentHistory';
import { LedgerList } from '../shared/LedgerList';
import { PagedList } from '../shared/PagedList';

export function CustomerHistory() {
  const customer = useCustomer();
  const load = useCallback(async () => {
    const now = new Date();
    const [settings, appointments, ledger] = await Promise.all([
      getSettings(supabase),
      pastAppointments(supabase, customer.id, now),
      ledgerOf(supabase, customer.id),
    ]);
    return { now, settings, appointments, ledger };
  }, [customer.id]);
  const [state] = useLoad(load);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const { now, settings, appointments, ledger } = state.data;
  const { timeZone } = settings;

  return (
    <>
      <h1>{t.customer.historyTitle}</h1>
      <section aria-labelledby="history-appointments">
        <h2 id="history-appointments">{t.history.appointmentsTitle}</h2>
        <PagedList
          first={appointments}
          fetchPage={(from) => pastAppointments(supabase, customer.id, now, from)}
        >
          {(rows, rowRef) => (
            <AppointmentHistory appointments={rows} timeZone={timeZone} rowRef={rowRef} />
          )}
        </PagedList>
      </section>
      <section aria-labelledby="history-ledger">
        <h2 id="history-ledger">{t.history.ledgerTitle}</h2>
        <PagedList first={ledger} fetchPage={(from) => ledgerOf(supabase, customer.id, from)}>
          {(rows, rowRef) => <LedgerList ledger={rows} timeZone={timeZone} rowRef={rowRef} />}
        </PagedList>
      </section>
    </>
  );
}
