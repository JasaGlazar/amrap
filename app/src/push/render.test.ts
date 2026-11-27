import { describe, expect, it } from 'vitest';
import { fill, formatAmount, t } from '../i18n';
import { formatLongDay, formatTime } from '../lib/time';
import { parsePush, renderNotification } from './render';

const tz = 'Europe/Ljubljana';
const startsAt = '2026-10-25T08:00:00Z';
const appointmentId = 'a1b2c3d4-0000-4000-8000-000000000001';

function when(iso: string) {
  const date = new Date(iso);
  return { day: formatLongDay(date, tz), time: formatTime(date, tz) };
}

describe('renderNotification', () => {
  it('reminds of the appointment and the cutoff time on the same day', () => {
    const cutoffAt = '2026-10-25T03:00:00Z';
    const rendered = renderNotification('cutoff_reminder', {
      appointment_id: appointmentId,
      starts_at: startsAt,
      cutoff_at: cutoffAt,
      timezone: tz,
    });
    expect(rendered).toEqual({
      title: fill(t.push.reminderTitle, when(startsAt)),
      body: fill(t.push.reminderBody, { cutoff: formatTime(new Date(cutoffAt), tz) }),
      tag: `cutoff_reminder:${appointmentId}`,
    });
    expect(when(startsAt).time).toBe('09:00');
  });

  it('names the day of a cutoff that falls on an earlier day', () => {
    const cutoffAt = '2026-10-24T08:00:00Z';
    const { body } = renderNotification('cutoff_reminder', {
      appointment_id: appointmentId,
      starts_at: startsAt,
      cutoff_at: cutoffAt,
      timezone: tz,
    });
    expect(body).toBe(fill(t.push.reminderBody, { cutoff: fill(t.slot.when, when(cutoffAt)) }));
  });

  it.each([
    ['booking_created', false, t.push.bookingCreatedTitle],
    ['booking_cancelled', false, t.push.bookingCancelledTitle],
    ['booking_cancelled', true, t.push.bookingCancelledLateTitle],
  ])('tells the trainer about %s (late %s)', (kind, late, title) => {
    const data = {
      appointment_id: appointmentId,
      customer_name: 'Ana Novak',
      starts_at: startsAt,
      late,
      timezone: tz,
    };
    expect(renderNotification(kind, data)).toEqual({
      title,
      body: fill(t.push.bookingBody, { name: 'Ana Novak', ...when(startsAt) }),
      tag: `${kind}:${appointmentId}`,
    });
  });

  it('tells the trainer about a restored booking', () => {
    const data = {
      appointment_id: appointmentId,
      customer_name: 'Ana Novak',
      starts_at: startsAt,
      timezone: tz,
    };
    expect(renderNotification('booking_restored', data)).toEqual({
      title: t.push.bookingRestoredTitle,
      body: fill(t.push.bookingBody, { name: 'Ana Novak', ...when(startsAt) }),
      tag: `booking_restored:${appointmentId}`,
    });
  });

  it('tells the trainer about a registration, tagged by the customer', () => {
    const data = { customer_id: 'c-1', customer_name: 'Ana Novak' };
    expect(renderNotification('customer_registered', data)).toEqual({
      title: t.push.customerRegisteredTitle,
      body: fill(t.push.customerRegisteredBody, { name: 'Ana Novak' }),
      tag: 'customer_registered:c-1',
    });
  });

  it('tells the customer about a top-up with the new balance', () => {
    const data = { transaction_id: 'tx-1', amount: 8, note: null, balance: 7 };
    expect(renderNotification('credit_topup', data)).toEqual({
      title: t.push.topupTitle,
      body: fill(t.push.topupBody, { amount: formatAmount(8), balance: 7 }),
      tag: 'credit_topup:tx-1',
    });
  });

  it('adds the note to an adjustment', () => {
    const data = { transaction_id: 'tx-2', amount: -2, note: 'Napaka pri vpisu', balance: -1 };
    const body = fill(t.push.adjustmentBody, { amount: formatAmount(-2), balance: -1 });
    expect(renderNotification('credit_adjustment', data)).toEqual({
      title: t.push.adjustmentTitle,
      body: fill(t.push.withNote, { body, note: 'Napaka pri vpisu' }),
      tag: 'credit_adjustment:tx-2',
    });
  });

  it('tells the customer the trainer cancelled, without a refund or a reason', () => {
    const data = {
      appointment_id: appointmentId,
      starts_at: startsAt,
      timezone: tz,
      refunded: false,
      reason: null,
    };
    expect(renderNotification('appointment_cancelled_by_trainer', data)).toEqual({
      title: t.push.trainerCancelledTitle,
      body: fill(t.push.trainerCancelledBody, when(startsAt)),
      tag: `appointment_cancelled_by_trainer:${appointmentId}`,
    });
  });

  it('adds the refund and then the reason to a trainer cancel', () => {
    const data = {
      appointment_id: appointmentId,
      starts_at: startsAt,
      timezone: tz,
      refunded: true,
      reason: 'Bolezen trenerja',
    };
    const body = fill(t.push.withRefund, {
      body: fill(t.push.trainerCancelledBody, when(startsAt)),
    });
    expect(renderNotification('appointment_cancelled_by_trainer', data).body).toBe(
      fill(t.push.withReason, { body, reason: 'Bolezen trenerja' }),
    );
  });

  it('leaves out a blank reason', () => {
    const data = { appointment_id: appointmentId, starts_at: startsAt, timezone: tz, reason: ' ' };
    expect(renderNotification('appointment_cancelled_by_trainer', data).body).toBe(
      fill(t.push.trainerCancelledBody, when(startsAt)),
    );
  });

  it.each([
    ['an unknown kind', 'something_new', { starts_at: startsAt }],
    ['a trainer cancel without a start', 'appointment_cancelled_by_trainer', { refunded: true }],
    ['a reminder without dates', 'cutoff_reminder', { appointment_id: appointmentId }],
    ['a booking with a broken date', 'booking_created', { starts_at: 'yesterday' }],
    ['a top-up without a balance', 'credit_topup', { amount: 1 }],
    ['a registration without a name', 'customer_registered', { customer_id: 'c-1' }],
  ])('falls back to generic copy for %s', (_name, kind, data) => {
    const rendered = renderNotification(kind, data);
    expect([rendered.title, rendered.body]).toEqual([t.push.genericTitle, t.push.genericBody]);
  });
});

describe('parsePush', () => {
  it.each(['//[', '/\\[', '//a b'])(
    'keeps the copy and opens the root for the unparseable %s',
    (url) => {
      const data = { transaction_id: 'tx-1', amount: 3, note: null, balance: 3 };
      expect(parsePush(JSON.stringify({ kind: 'credit_topup', data, url }))).toEqual({
        ...renderNotification('credit_topup', data),
        url: '/',
      });
    },
  );

  it('keeps the query and hash of an in-app path', () => {
    expect(
      parsePush(JSON.stringify({ kind: 'x', data: {}, url: '/c/zgodovina?x=1#top' })).url,
    ).toBe('/c/zgodovina?x=1#top');
  });

  it('renders a payload and keeps its in-app path', () => {
    const data = { transaction_id: 'tx-1', amount: 3, note: null, balance: 3 };
    const parsed = parsePush(JSON.stringify({ kind: 'credit_topup', data, url: '/c/zgodovina' }));
    expect(parsed).toEqual({ ...renderNotification('credit_topup', data), url: '/c/zgodovina' });
  });

  it.each([
    'https://evil.example/',
    '//evil.example/x',
    '/\\evil.example',
    '/\t/evil.example',
    42,
    undefined,
  ])('opens the app root instead of %s', (url) => {
    expect(parsePush(JSON.stringify({ kind: 'credit_topup', data: {}, url })).url).toBe('/');
  });

  it.each([undefined, '', 'not json', 'null', '[1]'])('shows generic copy for %s', (text) => {
    expect(parsePush(text)).toMatchObject({
      title: t.push.genericTitle,
      body: t.push.genericBody,
      url: '/',
    });
  });
});
