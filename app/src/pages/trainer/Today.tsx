import { useCallback } from 'react';
import { Link } from 'react-router';
import { allBalances } from '../../data/credits';
import { listCustomers } from '../../data/customers';
import { appointmentsIn, appointmentsOutsideSlots, loadWeek } from '../../data/week';
import { t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { localDateOf } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { Amount } from '../shared/Amount';
import { WeekSlots } from '../shared/WeekSlots';
import { OtherAppointments } from './OtherAppointments';
import { SlotRoster } from './SlotRoster';

export function TrainerToday() {
  const load = useCallback(async () => {
    const now = new Date();
    const [week, customers, balances] = await Promise.all([
      loadWeek(supabase, { now, weekOffset: 0 }),
      listCustomers(supabase),
      allBalances(supabase),
    ]);
    return { week, today: localDateOf(now, week.settings.timeZone), customers, balances };
  }, []);
  const [state] = useLoad(load);

  if (state.status === 'loading') return <p className="status">{t.common.loading}</p>;
  if (state.status === 'error') {
    return (
      <p role="alert" className="error">
        {t.common.loadFailed}
      </p>
    );
  }

  const { week, today, customers, balances } = state.data;
  const { timeZone } = week.settings;
  const names = new Map(customers.map((customer) => [customer.id, customer.name]));
  const debtors = customers
    .filter((customer) => (balances.get(customer.id) ?? 0) < 0)
    .sort((a, b) => (balances.get(a.id) ?? 0) - (balances.get(b.id) ?? 0));
  const slots = week.slots.filter((slot) => slot.date === today);
  const other = appointmentsOutsideSlots(week).filter(
    (appointment) => localDateOf(appointment.startsAt, timeZone) === today,
  );

  return (
    <>
      <h1>{t.trainer.todayTitle}</h1>
      <section className="card" aria-label={t.trainer.debtorsTitle}>
        <p className="label">{t.trainer.debtorsTitle}</p>
        {debtors.length === 0 ? (
          <p>{t.trainer.noDebtors}</p>
        ) : (
          <ul className="chips">
            {debtors.map((customer) => (
              <li key={customer.id}>
                <Link to={`/t/stranke/${customer.id}`} className="chip">
                  {customer.name} <Amount value={balances.get(customer.id) ?? 0} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {slots.length === 0 && other.length === 0 && <p>{t.trainer.noSlotsToday}</p>}
      {slots.length > 0 && (
        <WeekSlots
          slots={slots}
          timeZone={timeZone}
          actions={() => null}
          details={(slot) => <SlotRoster appointments={appointmentsIn(week, slot)} names={names} />}
        />
      )}
      {other.length > 0 && (
        <OtherAppointments appointments={other} names={names} timeZone={timeZone} />
      )}
    </>
  );
}
