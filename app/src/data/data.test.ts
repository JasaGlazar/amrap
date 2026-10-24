import { beforeEach, describe, expect, it } from 'vitest';
import { errorMessages } from '../i18n';
import { db, fakeSupabase, makeCustomer, postgrestTime, resetFake } from '../test/fakeSupabase';
import {
  book,
  cancel,
  chargedSince,
  liveAppointmentsBetween,
  pastAppointments,
  upcomingAppointments,
} from './appointments';
import type { Client } from './client';
import { balanceOf, ledgerOf } from './credits';
import { PAGE_SIZE, type Page } from './page';
import { getSettings } from './settings';
import { activeTemplates, blockedBetween, occupancyBetween } from './slots';

const client = fakeSupabase as unknown as Client;
const me = 'customer-1';
const now = new Date('2026-10-23T10:00:00Z');

function at(hoursFromNow: number): string {
  return new Date(now.getTime() + hoursFromNow * 3_600_000).toISOString();
}

function appointment(id: string, customer: string, hoursFromNow: number, status: string) {
  return {
    id,
    customer_id: customer,
    slot_template_id: 'tpl-1',
    starts_at: postgrestTime(new Date(at(hoursFromNow))),
    ends_at: postgrestTime(new Date(at(hoursFromNow + 1))),
    status,
  };
}

const fixtures = [
  appointment('future-booked', me, 48, 'booked'),
  appointment('soon-booked', me, 2, 'booked'),
  appointment('future-cancelled', me, 24, 'cancelled'),
  appointment('past-charged', me, -24, 'charged'),
  appointment('started-booked', me, -0.5, 'booked'),
  appointment('other-future', 'customer-2', 48, 'booked'),
  appointment('other-past', 'customer-2', -24, 'charged'),
];

beforeEach(() => {
  resetFake();
  db.tables.appointments = fixtures.map((row) => ({ ...row }));
});

const mine = () => fixtures.filter((row) => row.customer_id === me);

describe('appointments', () => {
  it('lists my booked future appointments, soonest first', async () => {
    const expected = mine()
      .filter((row) => row.status === 'booked' && Date.parse(row.starts_at) > now.getTime())
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map((row) => row.id);
    const result = await upcomingAppointments(client, me, now);
    expect(result.map((a) => a.id)).toEqual(expected);
  });

  it('lists everything else of mine as history, newest first', async () => {
    const upcoming = (await upcomingAppointments(client, me, now)).map((a) => a.id);
    const expected = mine()
      .filter((row) => !upcoming.includes(row.id))
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
      .map((row) => row.id);
    const result = await pastAppointments(client, me, now);
    expect(result.rows.map((a) => a.id)).toEqual(expected);
    expect(result.more).toBe(false);
  });

  it('returns dates as Date objects', async () => {
    const [first] = await upcomingAppointments(client, me, now);
    expect(first.startsAt).toBeInstanceOf(Date);
  });

  it('lists my live appointments in a range', async () => {
    const from = new Date(at(-48));
    const to = new Date(at(36));
    const expected = mine()
      .filter(
        (row) =>
          ['booked', 'charged'].includes(row.status) &&
          Date.parse(row.starts_at) >= from.getTime() &&
          Date.parse(row.starts_at) < to.getTime(),
      )
      .map((row) => row.id)
      .sort();
    const result = await liveAppointmentsBetween(client, from, to, me);
    expect(result.map((a) => a.id).sort()).toEqual(expected);
  });
});

describe('slots', () => {
  it('lists only active templates', async () => {
    db.tables.slot_templates = [
      {
        id: 'a',
        weekday: 0,
        start_time: '07:00:00',
        duration_minutes: 60,
        capacity: 5,
        active: true,
      },
      {
        id: 'b',
        weekday: 1,
        start_time: '07:00:00',
        duration_minutes: 60,
        capacity: 5,
        active: false,
      },
    ];
    expect((await activeTemplates(client)).map((row) => row.id)).toEqual(['a']);
  });

  it('reads occupancy inside the range only', async () => {
    db.tables.slot_occupancy = [
      { slot_template_id: 'a', starts_at: at(1), booked_count: 3 },
      { slot_template_id: 'a', starts_at: at(200), booked_count: 1 },
    ];
    const result = await occupancyBetween(client, new Date(at(0)), new Date(at(100)));
    expect(result).toEqual([{ slotTemplateId: 'a', startsAt: new Date(at(1)), bookedCount: 3 }]);
  });

  it('reads blocked periods that overlap the range', async () => {
    db.tables.blocked_periods = [
      { starts_at: at(-5), ends_at: at(1), reason: 'overlaps start' },
      { starts_at: at(-5), ends_at: at(0), reason: 'ends at range start' },
      { starts_at: at(50), ends_at: at(60), reason: 'inside' },
      { starts_at: at(100), ends_at: at(110), reason: 'starts at range end' },
    ];
    const result = await blockedBetween(client, new Date(at(0)), new Date(at(100)));
    expect(result.map((row) => row.reason)).toEqual(['overlaps start', 'inside']);
  });
});

describe('credits and settings', () => {
  it('reads my balance', async () => {
    resetFake({ customer: makeCustomer({ id: me }) });
    db.balance = -3;
    expect(await balanceOf(client, me)).toBe(db.balance);
  });

  it('lists my ledger newest first', async () => {
    db.tables.credit_transactions = [
      { id: 't1', customer_id: me, amount: 8, type: 'topup', note: null, created_at: at(-100) },
      { id: 't2', customer_id: me, amount: -1, type: 'session', note: null, created_at: at(-10) },
      {
        id: 'x',
        customer_id: 'customer-2',
        amount: 5,
        type: 'topup',
        note: null,
        created_at: at(-5),
      },
    ];
    expect((await ledgerOf(client, me)).rows.map((row) => row.id)).toEqual(['t2', 't1']);
  });

  it('reads the cutoff hours and timezone', async () => {
    expect(await getSettings(client)).toEqual({
      lateCancelHours: db.settings.late_cancel_hours,
      timeZone: db.settings.timezone,
    });
  });
});

describe('actions', () => {
  it('books through the book RPC with the ISO start', async () => {
    const startsAt = new Date(at(48));
    expect((await book(client, { customerId: me, startsAt, slotTemplateId: 'a' })).ok).toBe(true);
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('book', {
      p_customer_id: me,
      p_starts_at: startsAt.toISOString(),
      p_slot_template_id: 'a',
    });
  });

  it('turns an RPC error into Slovenian copy', async () => {
    fakeSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'AMRAP_CAPACITY_FULL: slot is full (5 of 5)' },
    });
    expect(await cancel(client, 'future-booked')).toEqual({
      ok: false,
      message: errorMessages.AMRAP_CAPACITY_FULL,
    });
  });
});

describe('paged history', () => {
  const total = PAGE_SIZE * 2 + Math.ceil(PAGE_SIZE / 2);
  const hours = Array.from({ length: total }, (_, index) => -(index + 1) * 24);

  async function allPages<T extends { id: string }>(read: (from: number) => Promise<Page<T>>) {
    const pages: Page<T>[] = [];
    let from = 0;
    for (;;) {
      const page = await read(from);
      pages.push(page);
      if (!page.more) return pages;
      from += page.rows.length;
    }
  }

  function expectPaged<T extends { id: string }>(pages: Page<T>[], expected: string[]) {
    const sizes = Array.from({ length: Math.ceil(expected.length / PAGE_SIZE) }, (_, index) =>
      Math.min(PAGE_SIZE, expected.length - index * PAGE_SIZE),
    );
    expect(pages.map((page) => page.rows.length)).toEqual(sizes);
    expect(pages.map((page) => page.more)).toEqual(
      sizes.map((_, index) => index < sizes.length - 1),
    );
    expect(pages.flatMap((page) => page.rows.map((row) => row.id))).toEqual(expected);
  }

  it('reads past appointments a page at a time, newest first', async () => {
    db.tables.appointments = [
      ...hours.map((h, index) => appointment(`past-${index}`, me, h, 'cancelled')),
      appointment('other', 'customer-2', -12, 'charged'),
    ];
    const expected = hours.map((_, index) => `past-${index}`);
    expectPaged(await allPages((from) => pastAppointments(client, me, now, from)), expected);
  });

  it('reads charged appointments since a date a page at a time, newest first', async () => {
    db.tables.appointments = hours.map((h, index) => appointment(`c-${index}`, me, h, 'charged'));
    const since = new Date(at(hours[hours.length - 1]));
    const expected = hours.map((_, index) => `c-${index}`);
    expectPaged(await allPages((from) => chargedSince(client, me, since, from)), expected);
  });

  it('reads the ledger a page at a time, newest first', async () => {
    db.tables.credit_transactions = hours.map((h, index) => ({
      id: `t-${String(index).padStart(2, '0')}`,
      customer_id: me,
      amount: -1,
      type: 'session',
      note: null,
      created_at: at(h),
    }));
    const expected = db.tables.credit_transactions.map((row) => String(row.id));
    expectPaged(await allPages((from) => ledgerOf(client, me, from)), expected);
  });

  it('keeps rows with the same time in one order across pages', async () => {
    db.tables.credit_transactions = hours
      .map((_, index) => ({
        id: `same-${String(index).padStart(2, '0')}`,
        customer_id: me,
        amount: -1,
        type: 'session',
        note: null,
        created_at: at(-1),
      }))
      .reverse();
    const expected = db.tables.credit_transactions.map((row) => String(row.id)).sort();
    expectPaged(await allPages((from) => ledgerOf(client, me, from)), expected);
  });
});
