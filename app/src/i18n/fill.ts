import { sl } from './sl';

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export function formatTimeUntil(left: { days: number; hours: number; minutes: number }): string {
  if (left.days > 0) return fill(sl.time.inDaysHours, left);
  if (left.hours > 0) return fill(sl.time.inHoursMinutes, left);
  return fill(sl.time.inMinutes, left);
}
