import { describe, expect, it } from 'vitest';
import {
  addDays,
  cutoffOf,
  defaultDayOf,
  formatDay,
  formatTime,
  isFreeCancel,
  localDateOf,
  occurrenceInWeek,
  overlaps,
  parseLocalDate,
  timeUntil,
  weekdayHeading,
  weekdayName,
  weekdayOf,
  weekRange,
  weekStart,
  zonedInstant,
} from './time';

const tz = 'Europe/Ljubljana';

describe('local dates', () => {
  it('numbers weekdays from Monday = 0', () => {
    expect(weekdayOf('2026-10-26')).toBe(0);
    expect(weekdayOf('2026-11-01')).toBe(6);
  });

  it('finds the Monday of the week', () => {
    expect(weekStart('2026-10-23')).toBe('2026-10-19');
    expect(weekStart('2026-10-26')).toBe('2026-10-26');
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-11-02', -3)).toBe('2026-10-30');
  });

  it('reads the local date of an instant in the gym timezone', () => {
    expect(localDateOf(new Date('2026-10-25T22:30:00Z'), tz)).toBe('2026-10-25');
    expect(localDateOf(new Date('2026-10-25T23:30:00Z'), tz)).toBe('2026-10-26');
  });
});

describe('parseLocalDate', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(parseLocalDate('2026-10-26')).toBe('2026-10-26');
    expect(parseLocalDate('2028-02-29')).toBe('2028-02-29');
  });

  it('accepts the first and last day of the years 2000-2099', () => {
    expect(parseLocalDate('2000-01-01')).toBe('2000-01-01');
    expect(parseLocalDate('2099-12-31')).toBe('2099-12-31');
  });

  it.each([
    null,
    '',
    '2026-10-26x',
    '26.10.2026',
    '2026-1-26',
    '2026-13-01',
    '2026-02-30',
    '2026-10-32',
    '1999-12-31',
    '2100-01-01',
    '9999-12-31',
    '0000-01-01',
  ])('rejects %s', (value) => {
    expect(parseLocalDate(value)).toBeNull();
  });
});

describe('defaultDayOf', () => {
  it('is today when today is in the week', () => {
    expect(defaultDayOf('2026-10-19', '2026-10-25')).toBe('2026-10-25');
    expect(defaultDayOf('2026-10-19', '2026-10-19')).toBe('2026-10-19');
  });

  it('is the Monday of any other week', () => {
    expect(defaultDayOf('2026-10-26', '2026-10-25')).toBe('2026-10-26');
    expect(defaultDayOf('2026-10-12', '2026-10-25')).toBe('2026-10-12');
  });
});

describe('zonedInstant', () => {
  it('uses summer time before the autumn change and winter time after it', () => {
    expect(zonedInstant('2026-10-24', '10:00', tz)?.toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(zonedInstant('2026-10-26', '10:00:00', tz)?.toISOString()).toBe(
      '2026-10-26T09:00:00.000Z',
    );
  });

  it('takes the later instant for a time the autumn change repeats, as Postgres does', () => {
    expect(zonedInstant('2026-10-25', '02:30', tz)?.toISOString()).toBe('2026-10-25T01:30:00.000Z');
  });

  it('has no instant for a time inside the spring-forward gap', () => {
    expect(zonedInstant('2026-03-29', '02:30', tz)).toBeNull();
    expect(zonedInstant('2026-03-29', '03:30', tz)?.toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('weeks and occurrences', () => {
  it('spans a week from local midnight to local midnight, 169 h across the autumn change', () => {
    const { from, to } = weekRange('2026-10-19', tz);
    expect(from.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('places a template occurrence on its weekday at its wall-clock time', () => {
    const template = { weekday: 0, start_time: '07:00:00', duration_minutes: 60 };
    const occurrence = occurrenceInWeek(template, '2026-10-26', tz);
    expect(occurrence?.date).toBe('2026-10-26');
    expect(occurrence?.startsAt.toISOString()).toBe('2026-10-26T06:00:00.000Z');
    expect(occurrence?.endsAt.toISOString()).toBe('2026-10-26T07:00:00.000Z');
  });

  it('skips an occurrence whose start time does not exist that day', () => {
    const template = { weekday: 6, start_time: '02:30:00', duration_minutes: 60 };
    expect(occurrenceInWeek(template, '2026-03-23', tz)).toBeNull();
  });

  it('treats ranges as half-open when checking overlap', () => {
    const slot = {
      startsAt: new Date('2026-10-26T06:00:00Z'),
      endsAt: new Date('2026-10-26T07:00:00Z'),
    };
    const touching = { startsAt: slot.endsAt, endsAt: new Date('2026-10-26T09:00:00Z') };
    const inside = { startsAt: new Date('2026-10-26T06:30:00Z'), endsAt: slot.endsAt };
    expect(overlaps(slot, touching)).toBe(false);
    expect(overlaps(slot, inside)).toBe(true);
  });
});

describe('cutoff', () => {
  const startsAt = new Date('2026-10-26T06:00:00Z');
  const hours = 5;
  const cutoff = cutoffOf(startsAt, hours);

  it('is the start minus the late-cancel hours', () => {
    expect(startsAt.getTime() - cutoff.getTime()).toBe(hours * 3_600_000);
  });

  it('is free until one minute before the cutoff and late from the cutoff on', () => {
    expect(isFreeCancel(startsAt, hours, new Date(cutoff.getTime() - 60_000))).toBe(true);
    expect(isFreeCancel(startsAt, hours, cutoff)).toBe(false);
    expect(isFreeCancel(startsAt, hours, new Date(cutoff.getTime() + 60_000))).toBe(false);
  });
});

describe('timeUntil', () => {
  it('splits the remaining time into days, hours and minutes, rounding minutes up', () => {
    const now = new Date('2026-10-23T10:00:30Z');
    expect(timeUntil(new Date('2026-10-25T13:05:00Z'), now)).toEqual({
      days: 2,
      hours: 3,
      minutes: 5,
    });
  });

  it('never goes negative', () => {
    const now = new Date('2026-10-23T10:00:00Z');
    expect(timeUntil(new Date('2026-10-23T09:00:00Z'), now)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
    });
  });
});

describe('weekdayName', () => {
  it('names weekdays from Monday = 0 in Slovenian', () => {
    expect(weekdayName(0)).toBe('ponedeljek');
    expect(weekdayName(6)).toBe('nedelja');
  });
});

describe('weekdayHeading', () => {
  it('capitalises the weekday for a heading and leaves weekdayName lowercase', () => {
    expect(weekdayHeading(0)).toBe('Ponedeljek');
    expect(weekdayHeading(3)).toBe('Četrtek');
    expect(weekdayHeading(6)).toBe('Nedelja');
    expect(weekdayName(3)).toBe('četrtek');
  });
});

describe('formatting', () => {
  it('formats in sl-SI in the gym timezone', () => {
    const instant = new Date('2026-10-26T06:00:00Z');
    expect(formatTime(instant, tz)).toBe('07:00');
    expect(formatDay(instant, tz)).toBe('pon., 26. 10.');
  });
});
