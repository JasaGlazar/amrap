import { describe, expect, it } from 'vitest';
import { fill, formatTimeUntil } from './fill';
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
