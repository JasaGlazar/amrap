import type { ReactNode } from 'react';
import type { WeekSlot } from '../../data/week';
import { fill, t } from '../../i18n';
import { formatLocalDate, formatLongDay, formatTime } from '../../lib/time';

type Props = {
  slots: WeekSlot[];
  timeZone: string;
  actions: (slot: WeekSlot) => ReactNode;
  details?: (slot: WeekSlot) => ReactNode;
};

export function WeekSlots({ slots, timeZone, actions, details }: Props) {
  const days = [...new Set(slots.map((slot) => slot.date))];
  if (days.length === 0) return <p>{t.calendar.noSlots}</p>;
  return (
    <>
      {days.map((date) => (
        <section key={date}>
          <h2>{formatLocalDate(date, { weekday: 'long', day: 'numeric', month: 'numeric' })}</h2>
          <ul className="list">
            {slots
              .filter((slot) => slot.date === date)
              .map((slot) => {
                const time = formatTime(slot.startsAt, timeZone);
                return (
                  <li
                    key={slot.key}
                    tabIndex={-1}
                    aria-label={fill(t.slot.when, {
                      day: formatLongDay(slot.startsAt, timeZone),
                      time,
                    })}
                    className={slot.blocked || slot.past ? 'row slot muted' : 'row slot'}
                  >
                    <span className="slot-time">{time}</span>
                    <span className="slot-info">
                      <span>
                        {fill(t.slot.duration, { minutes: slot.durationMinutes })}
                        {' ·'}
                      </span>{' '}
                      <span>
                        {fill(t.calendar.spots, { free: slot.free, capacity: slot.capacity })}
                        {slot.blocked && ' ·'}
                      </span>
                      {slot.blocked && (
                        <>
                          {' '}
                          <span>{t.calendar.blocked}</span>
                        </>
                      )}
                    </span>
                    {actions(slot)}
                    {details?.(slot)}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </>
  );
}
