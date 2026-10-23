import { useCallback, useState } from 'react';
import { book, type Appointment, type Booking } from '../../data/appointments';
import { listCustomers } from '../../data/customers';
import { appointmentsIn, appointmentsOutsideSlots, loadWeek } from '../../data/week';
import { fill, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { formatLongDay, formatTime } from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { CancelDialog } from '../shared/CancelDialog';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { WeekNav } from '../shared/WeekNav';
import { WeekSlots } from '../shared/WeekSlots';
import { AdHocForm } from './AdHocForm';
import { OtherAppointments } from './OtherAppointments';
import { SlotRoster } from './SlotRoster';

export function TrainerCalendar() {
  const [weekOffset, setWeekOffset] = useState(0);
  const load = useCallback(async () => {
    const [week, customers] = await Promise.all([
      loadWeek(supabase, { now: new Date(), weekOffset }),
      listCustomers(supabase),
    ]);
    return { week, customers };
  }, [weekOffset]);
  const [state, reload] = useLoad(load);
  const [message, setMessage] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);

  async function addBooking(booking: Booking) {
    setPending(true);
    setMessage(null);
    const result = await book(supabase, booking);
    setMessage(
      result.ok ? { error: false, text: t.trainer.added } : { error: true, text: result.message },
    );
    await reload();
    setPending(false);
  }

  function goToWeek(offset: number) {
    setMessage(null);
    setWeekOffset(offset);
  }

  const data = state.status === 'ok' ? state.data : null;
  const names = new Map(data?.customers.map((customer) => [customer.id, customer.name]));
  const timeZone = data?.week.settings.timeZone ?? '';

  return (
    <>
      <h1>{t.trainer.calendarTitle}</h1>
      <WeekNav
        start={data?.week.start ?? null}
        canGoBack
        onPrevious={() => goToWeek(weekOffset - 1)}
        onNext={() => goToWeek(weekOffset + 1)}
      />
      <NoticeLine notice={message} />
      {state.status === 'loading' && <p className="status">{t.common.loading}</p>}
      {state.status === 'error' && (
        <p role="alert" className="error">
          {t.common.loadFailed}
        </p>
      )}
      {data !== null && (
        <>
          <WeekSlots
            slots={data.week.slots}
            timeZone={timeZone}
            actions={() => null}
            details={(slot) => (
              <SlotRoster
                appointments={appointmentsIn(data.week, slot)}
                names={names}
                onCancel={setCancelling}
                add={{
                  label: fill(t.trainer.addTo, {
                    when: fill(t.slot.when, {
                      day: formatLongDay(slot.startsAt, timeZone),
                      time: formatTime(slot.startsAt, timeZone),
                    }),
                  }),
                  customers: data.customers,
                  disabled: pending || slot.free === 0 || slot.blocked,
                  onAdd: (customerId) =>
                    void addBooking({
                      customerId,
                      startsAt: slot.startsAt,
                      slotTemplateId: slot.templateId,
                    }),
                }}
              />
            )}
          />
          <OtherAppointments
            appointments={appointmentsOutsideSlots(data.week)}
            names={names}
            timeZone={timeZone}
            onCancel={setCancelling}
          />
          <AdHocForm
            key={data.week.start}
            customers={data.customers}
            defaultDate={data.week.start}
            timeZone={timeZone}
            disabled={pending}
            onSubmit={(booking) => void addBooking(booking)}
          />
        </>
      )}
      {cancelling !== null && data !== null && (
        <CancelDialog
          appointment={cancelling}
          settings={data.week.settings}
          customerName={names.get(cancelling.customerId) ?? t.trainer.unknownCustomer}
          asTrainer
          onClose={() => {
            setCancelling(null);
            void reload();
          }}
          onCancelled={() => {
            setCancelling(null);
            setMessage({ error: false, text: t.cancelDialog.done });
            void reload();
          }}
        />
      )}
    </>
  );
}
