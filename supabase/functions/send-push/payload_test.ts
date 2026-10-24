import { assertEquals } from '@std/assert';
import { buildPush } from './payload.ts';
import type { ClaimedRow, NotificationKind } from './types.ts';

const now = new Date('2026-10-24T10:00:00Z');
const appointmentId = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

function row(kind: NotificationKind, data: Record<string, unknown>): ClaimedRow {
  return {
    notification_id: 'n-1',
    kind,
    data,
    endpoint: 'https://push.test/1',
    p256dh: 'k',
    auth: 'a',
  };
}

Deno.test('every kind sends its kind, data and the screen to open', () => {
  const cases: [NotificationKind, string][] = [
    ['cutoff_reminder', '/c'],
    ['booking_created', '/t'],
    ['booking_cancelled', '/t'],
    ['credit_topup', '/c/zgodovina'],
    ['credit_adjustment', '/c/zgodovina'],
    ['appointment_cancelled_by_trainer', '/c/zgodovina'],
  ];
  for (const [kind, url] of cases) {
    const data = { appointment_id: appointmentId, cutoff_at: '2026-10-24T11:00:00Z', amount: 1 };
    assertEquals(JSON.parse(buildPush(row(kind, data), now).payload), { kind, data, url });
  }
});

Deno.test('a reminder expires at the cutoff, is urgent and replaces older ones for the appointment', () => {
  const cutoff = new Date(now.getTime() + 61 * 60 * 1000);
  const push = buildPush(
    row('cutoff_reminder', { appointment_id: appointmentId, cutoff_at: cutoff.toISOString() }),
    now,
  );
  assertEquals(push.ttl, (cutoff.getTime() - now.getTime()) / 1000);
  assertEquals(push.urgency, 'high');
  assertEquals(push.topic, appointmentId.replaceAll('-', ''));
});

Deno.test('a reminder whose cutoff has passed gets a TTL of 0, never negative', () => {
  const past = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  assertEquals(
    buildPush(row('cutoff_reminder', { appointment_id: appointmentId, cutoff_at: past }), now).ttl,
    0,
  );
  assertEquals(buildPush(row('cutoff_reminder', { appointment_id: appointmentId }), now).ttl, 0);
});

Deno.test('the topic stays within 32 base64url characters', () => {
  const push = buildPush(
    row('cutoff_reminder', { appointment_id: `${appointmentId}+extra/chars`, cutoff_at: '' }),
    now,
  );
  assertEquals(push.topic?.length, 32);
  assertEquals(/^[A-Za-z0-9_-]+$/.test(push.topic ?? ''), true);
});

Deno.test('other kinds live a day at normal urgency without a topic', () => {
  for (
    const kind of [
      'booking_created',
      'booking_cancelled',
      'credit_topup',
      'credit_adjustment',
      'appointment_cancelled_by_trainer',
    ] as const
  ) {
    const push = buildPush(row(kind, { appointment_id: appointmentId }), now);
    assertEquals([push.ttl, push.urgency, push.topic], [24 * 60 * 60, 'normal', undefined]);
  }
});
