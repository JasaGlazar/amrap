import { describe, expect, it } from 'vitest';
import { fill, formatTimeUntil, plural, type Plural } from './fill';
import { sl } from './sl';

describe('fill', () => {
  it('replaces named placeholders and leaves unknown ones', () => {
    expect(fill('{a} in {b} {c}', { a: 1, b: 'x' })).toBe('1 in x {c}');
  });
});

describe('formatTimeUntil', () => {
  it('shows days and hours when at least a day is left', () => {
    const left = { days: 2, hours: 3, minutes: 5 };
    expect(formatTimeUntil(left)).toBe(fill(sl.time.inDaysHours, left));
  });

  it('shows hours and minutes under a day', () => {
    const left = { days: 0, hours: 4, minutes: 0 };
    expect(formatTimeUntil(left)).toBe(fill(sl.time.inHoursMinutes, left));
  });

  it('shows minutes under an hour', () => {
    const left = { days: 0, hours: 0, minutes: 12 };
    expect(formatTimeUntil(left)).toBe(fill(sl.time.inMinutes, left));
  });
});

describe('plural', () => {
  const places: Plural = {
    one: '{count} mesto',
    two: '{count} mesti',
    few: '{count} mesta',
    other: '{count} mest',
  };
  const rules = new Intl.PluralRules('sl');

  it.each([1, 2, 3, 4, 5, 0, 11, 101, 102, 103, 104, 105])(
    'picks the Slovenian form for %i',
    (count) => {
      const category = rules.select(count) as keyof Plural;
      expect(plural(places, count)).toBe(fill(places[category], { count }));
    },
  );

  it('uses all four forms', () => {
    expect([1, 2, 3, 5].map((count) => plural(places, count))).toEqual([
      '1 mesto',
      '2 mesti',
      '3 mesta',
      '5 mest',
    ]);
  });
});
