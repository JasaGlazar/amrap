import { describe, expect, it } from 'vitest';
import { axisRange, clock, dayLanes, endOf, minutesOf } from './schedule';

const slot = (id: string, start_time: string, duration_minutes = 60, weekday = 0) => ({
  id,
  weekday,
  start_time,
  duration_minutes,
});

describe('minutesOf and endOf', () => {
  it('reads a start time with or without seconds as minutes after midnight', () => {
    expect(minutesOf('07:00')).toBe(7 * 60);
    expect(minutesOf('07:07:00')).toBe(7 * 60 + 7);
    expect(endOf(slot('a', '18:00', 90))).toBe(19 * 60 + 30);
  });
});

describe('clock', () => {
  it('writes minutes after midnight as a 24-hour time, past midnight on the next day', () => {
    expect(clock(7 * 60)).toBe('07:00');
    expect(clock(19 * 60 + 30)).toBe('19:30');
    expect(clock(25 * 60)).toBe('01:00');
  });
});

describe('axisRange', () => {
  it('runs from the earliest start to the latest end, rounded out to the hour', () => {
    expect(axisRange([slot('a', '06:30'), slot('b', '18:00', 90), slot('c', '09:00')])).toEqual({
      from: 6 * 60,
      to: 20 * 60,
    });
  });

  it('keeps a range that already sits on the hour', () => {
    expect(axisRange([slot('a', '07:00'), slot('b', '10:00')])).toEqual({
      from: 7 * 60,
      to: 11 * 60,
    });
  });

  it('stops at midnight', () => {
    expect(axisRange([slot('a', '23:30', 90)]).to).toBe(24 * 60);
  });
});

describe('dayLanes', () => {
  it('gives a slot that overlaps nothing the whole column', () => {
    const lanes = dayLanes([slot('a', '07:00'), slot('b', '09:00')]);
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(lanes.get('b')).toEqual({ lane: 0, lanes: 1 });
  });

  it('puts overlapping slots side by side', () => {
    const lanes = dayLanes([slot('b', '07:30'), slot('a', '07:00')]);
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get('b')).toEqual({ lane: 1, lanes: 2 });
  });

  it('keeps touching slots in one lane', () => {
    const lanes = dayLanes([slot('a', '07:00'), slot('b', '08:00')]);
    expect(lanes.get('b')).toEqual({ lane: 0, lanes: 1 });
  });

  it('reuses a lane once it is free and sizes the whole group by its widest moment', () => {
    const lanes = dayLanes([
      slot('a', '07:00', 120),
      slot('b', '07:30', 30),
      slot('c', '08:00', 60),
      slot('d', '10:00'),
    ]);
    expect(lanes.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get('c')).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get('d')).toEqual({ lane: 0, lanes: 1 });
  });
});
