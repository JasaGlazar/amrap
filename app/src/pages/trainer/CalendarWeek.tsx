import { useId, type ReactNode } from 'react';
import type { Appointment } from '../../data/appointments';
import { appointmentsOutsideSlots, type Week, type WeekSlot } from '../../data/week';
import { fill, t } from '../../i18n';
import {
  addDays,
  formatLocalDate,
  formatLongDay,
  formatTime,
  localDateOf,
  weekdayHeading,
  type LocalDate,
} from '../../lib/time';
import { SlotRoster } from './SlotRoster';

type Props = {
  week: Week;
  today: LocalDate;
  names: Map<string, string>;
  roster: (slot: WeekSlot) => ReactNode;
  onCancel: (appointment: Appointment) => void;
};

type Item =
  | { kind: 'slot'; at: Date; slot: WeekSlot }
  | { kind: 'other'; at: Date; appointment: Appointment };

function SlotCard({
  slot,
  timeZone,
  roster,
}: {
  slot: WeekSlot;
  timeZone: string;
  roster: ReactNode;
}) {
  const time = formatTime(slot.startsAt, timeZone);
  return (
    <li
      tabIndex={-1}
      aria-label={fill(t.slot.when, { day: formatLongDay(slot.startsAt, timeZone), time })}
      className={slot.blocked || slot.past ? 'week-card muted' : 'week-card'}
    >
      <span className="slot-time">
        {fill(t.slot.timeRange, { from: time, to: formatTime(slot.endsAt, timeZone) })}
      </span>
      <span className="week-card-info">
        <span>{fill(t.calendar.spots, { free: slot.free, capacity: slot.capacity })}</span>
        {slot.blocked && <span className="tag">{t.calendar.blocked}</span>}
      </span>
      {roster}
    </li>
  );
}

function OtherCard({
  appointment,
  timeZone,
  names,
  onCancel,
}: {
  appointment: Appointment;
  timeZone: string;
  names: Map<string, string>;
  onCancel: (appointment: Appointment) => void;
}) {
  const adHoc = appointment.slotTemplateId === null;
  return (
    <li
      className="week-card other"
      aria-label={fill(t.slot.when, {
        day: formatLongDay(appointment.startsAt, timeZone),
        time: fill(t.slot.timeRange, {
          from: formatTime(appointment.startsAt, timeZone),
          to: formatTime(appointment.endsAt, timeZone),
        }),
      })}
    >
      <span className="slot-time">
        {fill(t.slot.timeRange, {
          from: formatTime(appointment.startsAt, timeZone),
          to: formatTime(appointment.endsAt, timeZone),
        })}
      </span>
      <span className={adHoc ? 'tag' : 'tag late'}>
        {adHoc ? t.trainer.adHocTag : t.trainer.offGridTag}
      </span>
      <SlotRoster appointments={[appointment]} names={names} onCancel={onCancel} />
    </li>
  );
}

export function CalendarWeek({ week, today, names, roster, onCancel }: Props) {
  const id = useId();
  const { timeZone } = week.settings;
  const other = appointmentsOutsideSlots(week);
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(week.start, offset));
  const itemsOn = (date: LocalDate): Item[] =>
    [
      ...week.slots
        .filter((slot) => slot.date === date)
        .map((slot): Item => ({ kind: 'slot', at: slot.startsAt, slot })),
      ...other
        .filter((appointment) => localDateOf(appointment.startsAt, timeZone) === date)
        .map((appointment): Item => ({ kind: 'other', at: appointment.startsAt, appointment })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="wide">
      <div className="week-grid">
        {days.map((date, weekday) => {
          const items = itemsOn(date);
          const isToday = date === today;
          return (
            <section
              key={date}
              className={isToday ? 'week-day today' : 'week-day'}
              aria-labelledby={`${id}-${weekday}`}
            >
              <div className="week-day-head">
                <h2 id={`${id}-${weekday}`} aria-current={isToday ? 'date' : undefined}>
                  {weekdayHeading(weekday)}{' '}
                  <span className="week-day-date">
                    {formatLocalDate(date, { day: 'numeric', month: 'numeric' })}
                  </span>
                </h2>
                {isToday && <span className="tag">{t.trainer.todayTag}</span>}
              </div>
              {items.length > 0 && (
                <ul className="week-items">
                  {items.map((item) =>
                    item.kind === 'slot' ? (
                      <SlotCard
                        key={item.slot.key}
                        slot={item.slot}
                        timeZone={timeZone}
                        roster={roster(item.slot)}
                      />
                    ) : (
                      <OtherCard
                        key={item.appointment.id}
                        appointment={item.appointment}
                        timeZone={timeZone}
                        names={names}
                        onCancel={onCancel}
                      />
                    ),
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
