import type { BuiltPush, ClaimedRow, NotificationKind } from './types.ts';

const DAY_SECONDS = 24 * 60 * 60;

const URLS: Record<NotificationKind, string> = {
  cutoff_reminder: '/c',
  booking_created: '/t',
  booking_cancelled: '/t',
  credit_topup: '/c/zgodovina',
  credit_adjustment: '/c/zgodovina',
  appointment_cancelled_by_trainer: '/c/zgodovina',
};

export function buildPush(row: ClaimedRow, now: Date): BuiltPush {
  const url = URLS[row.kind] ?? '/';
  const payload = JSON.stringify({ kind: row.kind, data: row.data, url });

  if (row.kind === 'cutoff_reminder') {
    const cutoff = Date.parse(String(row.data.cutoff_at));
    const ttl = Number.isNaN(cutoff) ? 0 : Math.max(0, Math.floor((cutoff - now.getTime()) / 1000));
    return { payload, ttl, urgency: 'high', topic: topicFor(row.data.appointment_id) };
  }
  return { payload, ttl: DAY_SECONDS, urgency: 'normal' };
}

function topicFor(appointmentId: unknown): string | undefined {
  const topic = String(appointmentId ?? '').replace(/[^A-Za-z0-9]/g, '');
  return topic.length > 0 ? topic.slice(0, 32) : undefined;
}
