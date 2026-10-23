import { beforeEach, describe, expect, it } from 'vitest';
import { db, fakeSupabase, makeCustomer, resetFake } from '../test/fakeSupabase';
import { book } from './appointments';
import type { Client } from './client';
import { adjust, allBalances, topUp } from './credits';
import {
  createCustomer,
  createInvite,
  inviteStatus,
  listCustomers,
  type Customer,
} from './customers';
import { addRule, deactivateRule } from './rules';
import { setLateCancelHours } from './settings';
import { deleteBlocked, saveBlocked, upcomingBlocked } from './slots';

const client = fakeSupabase as unknown as Client;
const now = new Date('2026-10-23T10:00:00Z');
const trainer = makeCustomer({ id: 'trainer-1', role: 'trainer', auth_user_id: 'user-t' });

beforeEach(() => {
  resetFake({ customer: trainer });
  db.tables.customers = [
    makeCustomer({ id: 'c-b', name: 'Bojan', auth_user_id: null }),
    makeCustomer({ id: 'c-a', name: 'Ana', auth_user_id: 'user-a' }),
  ];
});

describe('customers', () => {
  it('lists customer records by name, without the trainer', async () => {
    const expected = db.tables.customers.map((row) => String(row.name)).sort();
    expect((await listCustomers(client)).map((row) => row.name)).toEqual(expected);
  });

  it('derives the invite status', () => {
    const base: Customer = {
      id: 'x',
      name: 'X',
      phone: null,
      email: null,
      linked: false,
      inviteToken: null,
      inviteExpiresAt: null,
    };
    const later = new Date(now.getTime() + 60_000);
    const earlier = new Date(now.getTime() - 60_000);
    expect(inviteStatus({ ...base, linked: true }, now)).toBe('linked');
    expect(inviteStatus({ ...base, inviteToken: 't', inviteExpiresAt: later }, now)).toBe(
      'pending',
    );
    expect(inviteStatus({ ...base, inviteToken: 't', inviteExpiresAt: earlier }, now)).toBe('none');
    expect(inviteStatus(base, now)).toBe('none');
  });

  it('creates a customer and returns its id', async () => {
    const result = await createCustomer(client, { name: 'Cene', phone: null, email: null });
    expect(result.ok && result.data?.id).toBe(
      db.tables.customers.find((row) => row.name === 'Cene')?.id,
    );
  });

  it('returns the invite token from create_invite', async () => {
    const result = await createInvite(client, 'c-b');
    expect(result).toEqual({
      ok: true,
      data: db.tables.customers.find((row) => row.id === 'c-b')?.invite_token,
    });
  });
});

describe('credits', () => {
  it('reads every balance', async () => {
    db.tables.customer_balances = [
      { customer_id: 'c-a', balance: 3 },
      { customer_id: 'c-b', balance: -2 },
    ];
    const balances = await allBalances(client);
    for (const row of db.tables.customer_balances) {
      expect(balances.get(String(row.customer_id))).toBe(row.balance);
    }
  });

  it('tops up and adjusts through the RPCs', async () => {
    await topUp(client, 'c-a', 10, 'Gotovina');
    await adjust(client, 'c-a', -1, null);
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('top_up', {
      p_customer_id: 'c-a',
      p_amount: 10,
      p_note: 'Gotovina',
    });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('adjust', {
      p_customer_id: 'c-a',
      p_amount: -1,
      p_note: undefined,
    });
  });
});

describe('ad-hoc booking', () => {
  it('sends the end and no template', async () => {
    const startsAt = new Date('2026-10-26T15:00:00Z');
    const endsAt = new Date('2026-10-26T16:30:00Z');
    await book(client, { customerId: 'c-a', startsAt, endsAt });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('book', {
      p_customer_id: 'c-a',
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
    });
  });
});

describe('rules', () => {
  it('inserts a rule and activates it', async () => {
    await addRule(client, 'c-a', 'tpl-1');
    const rule = db.tables.recurring_rules.find((row) => row.customer_id === 'c-a');
    expect(rule?.slot_template_id).toBe('tpl-1');
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('activate_rule', { p_rule_id: rule?.id });
  });

  it('deactivates through the RPC', async () => {
    db.tables.recurring_rules = [
      { id: 'r1', customer_id: 'c-a', slot_template_id: 't', active: true },
    ];
    await deactivateRule(client, 'r1');
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('deactivate_rule', { p_rule_id: 'r1' });
  });
});

describe('settings and blocked periods', () => {
  it('updates the cutoff hours', async () => {
    await setLateCancelHours(client, 12);
    expect(db.settings.late_cancel_hours).toBe(12);
  });

  it('creates, lists and deletes a blocked period', async () => {
    const startsAt = new Date('2026-12-24T00:00:00Z');
    const endsAt = new Date('2026-12-27T00:00:00Z');
    await saveBlocked(client, null, { startsAt, endsAt, reason: 'Prazniki' });
    const [stored] = await upcomingBlocked(client, now);
    expect(stored).toMatchObject({ startsAt, endsAt, reason: 'Prazniki' });
    await deleteBlocked(client, stored.id);
    expect(await upcomingBlocked(client, now)).toEqual([]);
  });
});
