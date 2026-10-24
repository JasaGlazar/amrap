import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { book, type Appointment, type Booking } from '../../data/appointments';
import { listCustomers } from '../../data/customers';
import {
  appointmentsIn,
  appointmentsOutsideSlots,
  loadWeek,
  type Week,
  type WeekSlot,
} from '../../data/week';
import { fill, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import {
  addDays,
  defaultDayOf,
  formatLocalDate,
  formatLongDay,
  formatTime,
  localDateOf,
  parseLocalDate,
  weekStart,
  type LocalDate,
} from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { useMediaQuery, weekGrid } from '../../lib/useMediaQuery';
import { CancelDialog } from '../shared/CancelDialog';
import { NoticeLine, type Notice } from '../shared/NoticeLine';
import { OnDemand } from '../shared/OnDemand';
import { WeekNav } from '../shared/WeekNav';
import { dayHeadingFormat, SlotRow } from '../shared/WeekSlots';
import { AdHocForm } from './AdHocForm';
import { CalendarWeek } from './CalendarWeek';
import { DayStrip } from './DayStrip';
import { OtherAppointments } from './OtherAppointments';
import { SlotRoster } from './SlotRoster';

const dayParam = 'dan';

function CalendarDay({
  week,
  day,
  names,
  roster,
  onCancel,
}: {
  week: Week;
  day: LocalDate;
  names: Map<string, string>;
  roster: (slot: WeekSlot) => ReactNode;
  onCancel: (appointment: Appointment) => void;
}) {
  const id = useId();
  const { timeZone } = week.settings;
  const slots = week.slots.filter((slot) => slot.date === day);
  const other = appointmentsOutsideSlots(week).filter(
    (appointment) => localDateOf(appointment.startsAt, timeZone) === day,
  );
  return (
    <>
      <section aria-labelledby={id}>
        <h2 id={id}>{formatLocalDate(day, dayHeadingFormat)}</h2>
        {slots.length > 0 && (
          <ul className="list">
            {slots.map((slot) => (
              <SlotRow
                key={slot.key}
                slot={slot}
                timeZone={timeZone}
                actions={() => null}
                details={roster}
              />
            ))}
          </ul>
        )}
        {slots.length === 0 && other.length === 0 && <p>{t.trainer.noSlotsOnDay}</p>}
      </section>
      {other.length > 0 && (
        <OtherAppointments
          appointments={other}
          names={names}
          timeZone={timeZone}
          onCancel={onCancel}
        />
      )}
    </>
  );
}

export function TrainerCalendar() {
  const [params, setParams] = useSearchParams();
  const chosen = parseLocalDate(params.get(dayParam));
  const shownStart = chosen === null ? null : weekStart(chosen);
  const [loadedWeek, setLoadedWeek] = useState(shownStart);
  const knownToday = useRef<LocalDate | null>(null);
  const load = useCallback(async () => {
    const now = new Date();
    const [week, customers] = await Promise.all([
      loadWeek(supabase, { now, weekOffset: 0, start: loadedWeek ?? undefined }),
      listCustomers(supabase),
    ]);
    const today = localDateOf(now, week.settings.timeZone);
    knownToday.current = today;
    return { week, customers, today };
  }, [loadedWeek]);
  const [state, reload] = useLoad(load);
  const wide = useMediaQuery(weekGrid);
  const [message, setMessage] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [addingAdHoc, setAddingAdHoc] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  async function addBooking(booking: Booking) {
    setPending(true);
    setMessage(null);
    const result = await book(supabase, booking);
    setMessage(
      result.ok ? { error: false, text: t.trainer.added } : { error: true, text: result.message },
    );
    await reload();
    setPending(false);
    return result.ok;
  }

  const data = state.status === 'ok' ? state.data : null;
  const sameWeek =
    shownStart === loadedWeek || (loadedWeek === null && shownStart === data?.week.start);
  if (!sameWeek) setLoadedWeek(shownStart);

  function selectDay(day: LocalDate) {
    setMessage(null);
    setAddingTo(null);
    setParams({ [dayParam]: day }, { replace: true });
  }

  function goToWeek(step: number) {
    const base = shownStart ?? data?.week.start;
    if (base === undefined) return;
    const target = addDays(base, step * 7);
    setAddingAdHoc(false);
    selectDay(knownToday.current === null ? target : defaultDayOf(target, knownToday.current));
  }

  const names = new Map(data?.customers.map((customer) => [customer.id, customer.name]));
  const timeZone = data?.week.settings.timeZone ?? '';
  const selected = data === null ? null : (chosen ?? defaultDayOf(data.week.start, data.today));

  function roster(slot: WeekSlot) {
    if (data === null) return null;
    return (
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
          open: addingTo === slot.key,
          unavailable: slot.blocked ? t.calendar.blocked : slot.free === 0 ? t.calendar.full : null,
          pending,
          onOpen: () => setAddingTo(slot.key),
          onClose: () => setAddingTo(null),
          onAdd: (customerId) =>
            void addBooking({
              customerId,
              startsAt: slot.startsAt,
              slotTemplateId: slot.templateId,
            }).then((ok) => ok && setAddingTo(null)),
        }}
      />
    );
  }

  return (
    <>
      <div className="head">
        <h1>{t.trainer.calendarTitle}</h1>
        <OnDemand
          label={t.trainer.adHocFormTitle}
          add
          disabled={data === null}
          open={addingAdHoc}
          onOpen={() => setAddingAdHoc(true)}
        >
          {data !== null && selected !== null && (
            <AdHocForm
              key={data.week.start}
              customers={data.customers}
              defaultDate={selected}
              timeZone={timeZone}
              disabled={pending}
              onSubmit={(booking) =>
                void addBooking(booking).then((ok) => ok && setAddingAdHoc(false))
              }
              onCancel={() => setAddingAdHoc(false)}
            />
          )}
        </OnDemand>
      </div>
      <WeekNav
        start={data?.week.start ?? shownStart}
        disabled={shownStart === null && data === null}
        canGoBack
        onPrevious={() => goToWeek(-1)}
        onNext={() => goToWeek(1)}
      />
      {!wide && data !== null && selected !== null && (
        <DayStrip
          start={data.week.start}
          selected={selected}
          today={data.today}
          onSelect={selectDay}
        />
      )}
      <NoticeLine notice={message} />
      {state.status === 'loading' && <p className="status">{t.common.loading}</p>}
      {state.status === 'error' && (
        <p role="alert" className="error">
          {t.common.loadFailed}
        </p>
      )}
      {data !== null &&
        selected !== null &&
        (wide ? (
          <CalendarWeek
            week={data.week}
            today={data.today}
            names={names}
            roster={roster}
            onCancel={setCancelling}
          />
        ) : (
          <CalendarDay
            week={data.week}
            day={selected}
            names={names}
            roster={roster}
            onCancel={setCancelling}
          />
        ))}
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
