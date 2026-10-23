import { fill, formatAmount } from '../i18n/fill';
import { sl } from '../i18n/sl';
import { formatLongDay, formatTime, localDateOf } from '../lib/time';

export type RenderedNotification = { title: string; body: string; tag: string; url: string };

type Data = Record<string, unknown>;

export function parsePush(text: string | undefined): RenderedNotification {
  try {
    const message: unknown = JSON.parse(text ?? '');
    if (typeof message !== 'object' || message === null) return generic();
    const { kind, data, url } = message as { kind?: unknown; data?: unknown; url?: unknown };
    const rendered = renderNotification(String(kind), isData(data) ? data : {});
    return { ...rendered, url: safePath(url) };
  } catch {
    return generic();
  }
}

export function renderNotification(kind: string, data: Data): Omit<RenderedNotification, 'url'> {
  const timeZone = typeof data.timezone === 'string' ? data.timezone : deviceTimeZone();
  const startsAt = dateOf(data.starts_at);
  const tag = `${kind}:${String(data.appointment_id ?? data.transaction_id ?? '')}`;
  const when = startsAt && {
    day: formatLongDay(startsAt, timeZone),
    time: formatTime(startsAt, timeZone),
  };

  switch (kind) {
    case 'cutoff_reminder': {
      const cutoffAt = dateOf(data.cutoff_at);
      if (!when || !startsAt || !cutoffAt) break;
      const cutoff =
        localDateOf(cutoffAt, timeZone) === localDateOf(startsAt, timeZone)
          ? formatTime(cutoffAt, timeZone)
          : fill(sl.slot.when, {
              day: formatLongDay(cutoffAt, timeZone),
              time: formatTime(cutoffAt, timeZone),
            });
      return {
        title: fill(sl.push.reminderTitle, when),
        body: fill(sl.push.reminderBody, { cutoff }),
        tag,
      };
    }
    case 'booking_created':
    case 'booking_cancelled': {
      if (!when) break;
      const title =
        kind === 'booking_created'
          ? sl.push.bookingCreatedTitle
          : data.late === true
            ? sl.push.bookingCancelledLateTitle
            : sl.push.bookingCancelledTitle;
      return {
        title,
        body: fill(sl.push.bookingBody, { name: String(data.customer_name ?? ''), ...when }),
        tag,
      };
    }
    case 'credit_topup':
    case 'credit_adjustment': {
      if (typeof data.amount !== 'number' || typeof data.balance !== 'number') break;
      const body = fill(kind === 'credit_topup' ? sl.push.topupBody : sl.push.adjustmentBody, {
        amount: formatAmount(data.amount),
        balance: data.balance,
      });
      const note = typeof data.note === 'string' && data.note.trim() !== '' ? data.note : null;
      return {
        title: kind === 'credit_topup' ? sl.push.topupTitle : sl.push.adjustmentTitle,
        body: note ? fill(sl.push.withNote, { body, note }) : body,
        tag,
      };
    }
  }
  return { title: sl.push.genericTitle, body: sl.push.genericBody, tag };
}

function generic(): RenderedNotification {
  return { title: sl.push.genericTitle, body: sl.push.genericBody, tag: 'generic', url: '/' };
}

function isData(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safePath(url: unknown): string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
