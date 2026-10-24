import { sl } from './sl';

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export type Plural = { one: string; two: string; few: string; other: string };

const pluralRules = new Intl.PluralRules('sl');

export function plural(forms: Plural, count: number): string {
  const category = pluralRules.select(count);
  const template = category in forms ? forms[category as keyof Plural] : forms.other;
  return fill(template, { count });
}

const signedAmount = new Intl.NumberFormat('sl-SI', { signDisplay: 'always' });

export function formatAmount(amount: number): string {
  return signedAmount.format(amount);
}

export function formatTimeUntil(left: { days: number; hours: number; minutes: number }): string {
  if (left.days > 0) return fill(sl.time.inDaysHours, left);
  if (left.hours > 0) return fill(sl.time.inHoursMinutes, left);
  return fill(sl.time.inMinutes, left);
}
