import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { db, fakeSupabase, makeCustomer, resetFake } from '../test/fakeSupabase';
import { book } from './appointments';
import type { Client } from './client';
import { adjust, allBalances, topUp } from './credits';
import {
  createCustomer,
  createInvite,
  deleteCustomer,
  getCustomer,
  inviteStatus,
  listCustomers,
  type Customer,
} from './customers';
import { getRegistrationCode, setRegistrationCode } from './registration';
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

  it('reads when a customer registered and whether any rule exists, a stopped one included', async () => {
    const registeredAt = '2026-10-20T08:00:00+00:00';
    db.tables.customers.push(
      makeCustomer({ id: 'c-c', name: 'Cene', registered_at: registeredAt }),
      makeCustomer({ id: 'c-d', name: 'Dora', registered_at: registeredAt }),
    );
    db.tables.recurring_rules = [
      { id: 'r1', customer_id: 'c-a', slot_template_id: 't', active: true },
      { id: 'r2', customer_id: 'c-d', slot_template_id: 't', active: false },
    ];
    const byId = new Map((await listCustomers(client)).map((row) => [row.id, row]));
    expect(byId.get('c-c')).toMatchObject({
      registeredAt: new Date(registeredAt),
      hasRules: false,
    });
    expect(byId.get('c-d')).toMatchObject({ registeredAt: new Date(registeredAt), hasRules: true });
    expect(byId.get('c-a')).toMatchObject({ registeredAt: null, hasRules: true });
    expect(byId.get('c-b')).toMatchObject({ registeredAt: null, hasRules: false });
  });

  it('reads the same fields for one customer', async () => {
    db.tables.recurring_rules = [
      { id: 'r1', customer_id: 'c-a', slot_template_id: 't', active: false },
    ];
    expect(await getCustomer(client, 'c-a')).toMatchObject({ registeredAt: null, hasRules: true });
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
      registeredAt: null,
      hasRules: false,
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

  it('deletes a record through delete_customer', async () => {
    expect(await deleteCustomer(client, 'c-b')).toEqual({ ok: true, data: null });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('delete_customer', { p_customer_id: 'c-b' });
    expect(db.tables.customers.some((row) => row.id === 'c-b')).toBe(false);
  });

  it('turns a refused delete into its copy', async () => {
    fakeSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'AMRAP_NOT_DELETABLE: customer c-a has appointments' },
    });
    expect(await deleteCustomer(client, 'c-a')).toEqual({
      ok: false,
      message: t.errors.AMRAP_NOT_DELETABLE,
    });
  });
});

describe('registration code', () => {
  it('reads the gym code, or null while registration is closed', async () => {
    expect(await getRegistrationCode(client)).toBeNull();
    db.registrationCode = 'gym-code-1234';
    expect(await getRegistrationCode(client)).toBe(db.registrationCode);
  });

  it('sets the gym code through set_registration_code', async () => {
    expect(await setRegistrationCode(client, 'gym-code-1234')).toEqual({ ok: true, data: null });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('set_registration_code', {
      p_code: 'gym-code-1234',
    });
    expect(db.registrationCode).toBe('gym-code-1234');
  });

  it('clears the gym code with null', async () => {
    db.registrationCode = 'gym-code-1234';
    expect(await setRegistrationCode(client, null)).toEqual({ ok: true, data: null });
    expect(fakeSupabase.rpc).toHaveBeenCalledWith('set_registration_code', { p_code: null });
    expect(db.registrationCode).toBeNull();
  });

  it('turns a refused code into its copy', async () => {
    expect(await setRegistrationCode(client, 'short')).toEqual({
      ok: false,
      message: t.errors.AMRAP_INVALID_ARGUMENT,
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
