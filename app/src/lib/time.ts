export type LocalDate = string;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function localParts(instant: Date, timeZone: string): { date: LocalDate; time: string } {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

export function localDateOf(instant: Date, timeZone: string): LocalDate {
  return localParts(instant, timeZone).date;
}

function utcMsOf(date: LocalDate, time = '00:00:00'): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(utcMsOf(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(date: LocalDate): number {
  return (new Date(utcMsOf(date)).getUTCDay() + 6) % 7;
}

export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, -weekdayOf(date));
}

export function parseLocalDate(value: string | null): LocalDate | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return addDays(value, 0) === value ? value : null;
}

export function defaultDayOf(monday: LocalDate, today: LocalDate): LocalDate {
  return weekStart(today) === monday ? today : monday;
}

function offsetAt(ms: number, timeZone: string): number {
  const { date, time } = localParts(new Date(ms), timeZone);
  return utcMsOf(date, time) - Math.floor(ms / 1000) * 1000;
}

function normalizeTime(time: string): string {
  const [hour, minute, second = '00'] = time.split(':');
  return `${hour}:${minute}:${second}`;
}

export function zonedInstant(date: LocalDate, time: string, timeZone: string): Date | null {
  const wallClock = utcMsOf(date, time);
  const firstOffset = offsetAt(wallClock, timeZone);
  let instant = wallClock - firstOffset;
  const secondOffset = offsetAt(instant, timeZone);
  if (secondOffset !== firstOffset) instant = wallClock - secondOffset;
  const back = localParts(new Date(instant), timeZone);
  return back.date === date && back.time === normalizeTime(time) ? new Date(instant) : null;
}

export function weekRange(start: LocalDate, timeZone: string): { from: Date; to: Date } {
  const from = zonedInstant(start, '00:00', timeZone);
  const to = zonedInstant(addDays(start, 7), '00:00', timeZone);
  if (from === null || to === null) throw new Error(`no local midnight in ${timeZone}`);
  return { from, to };
}

export type Occurrence = { date: LocalDate; startsAt: Date; endsAt: Date };

export function occurrenceInWeek(
  template: { weekday: number; start_time: string; duration_minutes: number },
  start: LocalDate,
  timeZone: string,
): Occurrence | null {
  const date = addDays(start, template.weekday);
  const startsAt = zonedInstant(date, template.start_time, timeZone);
  if (startsAt === null) return null;
  return {
    date,
    startsAt,
    endsAt: new Date(startsAt.getTime() + template.duration_minutes * MINUTE_MS),
  };
}

export function cutoffOf(startsAt: Date, lateCancelHours: number): Date {
  return new Date(startsAt.getTime() - lateCancelHours * HOUR_MS);
}

export function isFreeCancel(startsAt: Date, lateCancelHours: number, now: Date): boolean {
  return now.getTime() < cutoffOf(startsAt, lateCancelHours).getTime();
}

export function overlaps(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function timeUntil(
  instant: Date,
  now: Date,
): { days: number; hours: number; minutes: number } {
  const minutes = Math.max(0, Math.ceil((instant.getTime() - now.getTime()) / MINUTE_MS));
  return {
    days: Math.floor(minutes / (24 * 60)),
    hours: Math.floor((minutes % (24 * 60)) / 60),
    minutes: minutes % 60,
  };
}

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

function display(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = displayFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('sl-SI', { timeZone, ...options });
    displayFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatTime(instant: Date, timeZone: string): string {
  return display(timeZone, { hour: '2-digit', minute: '2-digit' }).format(instant);
}

export function formatDay(instant: Date, timeZone: string): string {
  return display(timeZone, { weekday: 'short', day: 'numeric', month: 'numeric' }).format(instant);
}

export function formatLongDay(instant: Date, timeZone: string): string {
  return display(timeZone, { weekday: 'long', day: 'numeric', month: 'long' }).format(instant);
}

export function formatDate(instant: Date, timeZone: string): string {
  return display(timeZone, { day: 'numeric', month: 'numeric', year: 'numeric' }).format(instant);
}

const referenceMonday: LocalDate = '2026-10-19';

export function weekdayName(weekday: number): string {
  return formatLocalDate(addDays(referenceMonday, weekday), { weekday: 'long' });
}

export function weekdayHeading(weekday: number): string {
  const name = weekdayName(weekday);
  return name.charAt(0).toLocaleUpperCase('sl') + name.slice(1);
}

export function formatLocalDate(date: LocalDate, options: Intl.DateTimeFormatOptions): string {
  return display('UTC', options).format(new Date(utcMsOf(date)));
}
