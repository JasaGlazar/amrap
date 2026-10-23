import { useCallback, useState } from 'react';
import { useCustomer } from '../../auth/AuthContext';
import { book, liveAppointmentsBetween, type Appointment } from '../../data/appointments';
import { getSettings } from '../../data/settings';
import { activeTemplates, blockedBetween, occupancyBetween } from '../../data/slots';
import { fill, t } from '../../i18n';
import { supabase } from '../../lib/supabase';
import {
  addDays,
  formatLocalDate,
  formatLongDay,
  formatTime,
  localDateOf,
  occurrenceInWeek,
  overlaps,
  weekRange,
  weekStart,
  type LocalDate,
} from '../../lib/time';
import { useLoad } from '../../lib/useLoad';
import { CancelDialog } from './CancelDialog';

type Slot = {
  key: string;
  templateId: string;
  date: LocalDate;
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
  free: number;
  past: boolean;
  blocked: boolean;
  mine: Appointment | undefined;
};

function sameStart(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export function CustomerCalendar() {
  const customer = useCustomer();
  const [weekOffset, setWeekOffset] = useState(0);
  const load = useCallback(async () => {
    const now = new Date();
    const settings = await getSettings(supabase);
    const start = addDays(weekStart(localDateOf(now, settings.timeZone)), weekOffset * 7);
    const { from, to } = weekRange(start, settings.timeZone);
    const [templates, occupancy, blocked, mine] = await Promise.all([
      activeTemplates(supabase),
      occupancyBetween(supabase, from, to),
      blockedBetween(supabase, from, to),
      liveAppointmentsBetween(supabase, customer.id, from, to),
    ]);
    const slots: Slot[] = templates.flatMap((template) => {
      const occurrence = occurrenceInWeek(template, start, settings.timeZone);
      if (occurrence === null) return [];
      const booked =
        occupancy.find(
          (row) =>
            row.slotTemplateId === template.id && sameStart(row.startsAt, occurrence.startsAt),
        )?.bookedCount ?? 0;
      return [
        {
          key: `${template.id}@${occurrence.startsAt.toISOString()}`,
          templateId: template.id,
          date: occurrence.date,
          startsAt: occurrence.startsAt,
          durationMinutes: template.duration_minutes,
          capacity: template.capacity,
          free: Math.max(0, template.capacity - booked),
          past: occurrence.startsAt.getTime() <= now.getTime(),
          blocked: blocked.some((period) => overlaps(occurrence, period)),
          mine: mine.find(
            (appointment) =>
              appointment.slotTemplateId === template.id &&
              sameStart(appointment.startsAt, occurrence.startsAt),
          ),
        },
      ];
    });
    slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return { settings, start, slots };
  }, [customer.id, weekOffset]);
  const [state, reload] = useLoad(load);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);

  async function bookSlot(slot: Slot) {
    setPending(slot.key);
    setMessage(null);
    const result = await book(supabase, {
      customerId: customer.id,
      startsAt: slot.startsAt,
      slotTemplateId: slot.templateId,
    });
    setPending(null);
    setMessage(
      result.ok ? { error: false, text: t.calendar.booked } : { error: true, text: result.message },
    );
    reload();
  }

  function goToWeek(offset: number) {
    setMessage(null);
    setWeekOffset(offset);
  }

  const header = (
    <>
      <h1>{t.customer.calendarTitle}</h1>
      {state.status === 'ok' && (
        <div className="week-nav">
          <button
            type="button"
            className="button secondary small"
            aria-label={t.calendar.previousWeek}
            disabled={weekOffset === 0}
            onClick={() => goToWeek(weekOffset - 1)}
          >
            {t.calendar.previousArrow}
          </button>
          <span className="week-range">
            {fill(t.calendar.weekRange, {
              from: formatLocalDate(state.data.start, { day: 'numeric', month: 'numeric' }),
              to: formatLocalDate(addDays(state.data.start, 6), {
                day: 'numeric',
                month: 'numeric',
              }),
            })}
          </span>
          <button
            type="button"
            className="button secondary small"
            aria-label={t.calendar.nextWeek}
            onClick={() => goToWeek(weekOffset + 1)}
          >
            {t.calendar.nextArrow}
          </button>
        </div>
      )}
      {message !== null && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'error' : 'ok'}>
          {message.text}
        </p>
      )}
    </>
  );

  if (state.status === 'loading') {
    return (
      <>
        {header}
        <p className="status">{t.common.loading}</p>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        {header}
        <p role="alert" className="error">
          {t.customer.loadFailed}
        </p>
      </>
    );
  }

  const { settings, slots } = state.data;
  const { timeZone } = settings;
  const days = [...new Set(slots.map((slot) => slot.date))];

  return (
    <>
      {header}
      {days.length === 0 && <p>{t.calendar.noSlots}</p>}
      {days.map((date) => (
        <section key={date}>
          <h2>{formatLocalDate(date, { weekday: 'long', day: 'numeric', month: 'numeric' })}</h2>
          <ul className="list">
            {slots
              .filter((slot) => slot.date === date)
              .map((slot) => {
                const time = formatTime(slot.startsAt, timeZone);
                const full = slot.free === 0;
                return (
                  <li
                    key={slot.key}
                    aria-label={fill(t.slot.when, {
                      day: formatLongDay(slot.startsAt, timeZone),
                      time,
                    })}
                    className={slot.blocked || slot.past ? 'row slot muted' : 'row slot'}
                  >
                    <span className="slot-time">{time}</span>
                    <span className="slot-info">
                      {fill(t.slot.duration, { minutes: slot.durationMinutes })}
                      {' · '}
                      {fill(t.calendar.spots, { free: slot.free, capacity: slot.capacity })}
                      {slot.blocked && (
                        <>
                          {' · '}
                          {t.calendar.blocked}
                        </>
                      )}
                    </span>
                    {slot.mine !== undefined ? (
                      <span className="slot-mine">
                        <span className="tag">{t.calendar.mine}</span>
                        {slot.mine.status === 'booked' && !slot.past && (
                          <button
                            type="button"
                            className="button secondary small"
                            onClick={() => setCancelling(slot.mine ?? null)}
                          >
                            {t.slot.cancel}
                          </button>
                        )}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button small"
                        disabled={full || slot.past || slot.blocked || pending !== null}
                        onClick={() => void bookSlot(slot)}
                      >
                        {full ? t.calendar.full : t.calendar.book}
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      {cancelling !== null && (
        <CancelDialog
          appointment={cancelling}
          settings={settings}
          onClose={() => {
            setCancelling(null);
            reload();
          }}
          onCancelled={() => {
            setCancelling(null);
            setMessage({ error: false, text: t.calendar.cancelled });
            reload();
          }}
        />
      )}
    </>
  );
}
