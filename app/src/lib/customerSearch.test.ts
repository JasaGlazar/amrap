import { describe, expect, it } from 'vitest';
import {
  customerFilterOf,
  matchesCustomer,
  searchCustomers,
  type SearchableCustomer,
} from './customerSearch';

const now = new Date('2026-10-25T10:00:00Z');
const later = new Date(now.getTime() + 86_400_000);
const earlier = new Date(now.getTime() - 86_400_000);

function customer(overrides: Partial<SearchableCustomer>): SearchableCustomer {
  return {
    id: overrides.name ?? 'x',
    name: 'Test',
    phone: null,
    email: null,
    linked: true,
    inviteToken: null,
    inviteExpiresAt: null,
    balance: 0,
    ...overrides,
  };
}

const maja = customer({ name: 'Maja Zupančič', phone: '+386 31 444 444' });
const ana = customer({ name: 'Ana Novak', phone: '+386 40 111 111', email: 'ana@amrap.local' });
const dorde = customer({ name: 'Đorđe Šimić', phone: '041 222 333' });

describe('matchesCustomer', () => {
  it('ignores case and diacritics in the name', () => {
    expect(matchesCustomer(maja, 'zupancic')).toBe(true);
    expect(matchesCustomer(maja, 'ZUPANČIČ')).toBe(true);
    expect(matchesCustomer(dorde, 'dorde simic')).toBe(true);
  });

  it('matches every word anywhere in the name or email', () => {
    expect(matchesCustomer(ana, 'novak ana')).toBe(true);
    expect(matchesCustomer(ana, 'amrap.local')).toBe(true);
    expect(matchesCustomer(ana, 'ana horvat')).toBe(false);
  });

  it('matches a phone number ignoring spaces', () => {
    expect(matchesCustomer(ana, '40111')).toBe(true);
    expect(matchesCustomer(ana, '40 111 1')).toBe(true);
    expect(matchesCustomer(dorde, '041222')).toBe(true);
  });

  it('treats +386 and a leading 0 as the same prefix', () => {
    expect(matchesCustomer(ana, '040111')).toBe(true);
    expect(matchesCustomer(ana, '040 111 111')).toBe(true);
    expect(matchesCustomer(dorde, '+386 41 222')).toBe(true);
    expect(matchesCustomer(dorde, '0038641222')).toBe(true);
  });

  it('does not match a number against a customer without a phone', () => {
    expect(matchesCustomer(customer({ name: 'Eva Kos' }), '040')).toBe(false);
  });

  it('matches everyone on an empty or blank query', () => {
    expect(matchesCustomer(maja, '')).toBe(true);
    expect(matchesCustomer(maja, '   ')).toBe(true);
  });
});

describe('customerFilterOf', () => {
  it('reads the known filters and falls back to all', () => {
    expect(customerFilterOf('dolzniki')).toBe('dolzniki');
    expect(customerFilterOf('brez')).toBe('brez');
    expect(customerFilterOf('vsi')).toBe('vsi');
    expect(customerFilterOf(null)).toBe('vsi');
    expect(customerFilterOf('unknown')).toBe('vsi');
  });
});

describe('searchCustomers', () => {
  const list = [
    customer({ name: 'Cvetka', balance: -1, linked: false }),
    customer({ name: 'Čeh', balance: 3 }),
    customer({ name: 'Ana', balance: -4 }),
    customer({ name: 'Dora', balance: 0, linked: false, inviteToken: 't', inviteExpiresAt: later }),
    customer({
      name: 'Bor',
      balance: 2,
      linked: false,
      inviteToken: 't',
      inviteExpiresAt: earlier,
    }),
    customer({ name: 'Zala', balance: 1 }),
    customer({ name: 'Žan', balance: -2 }),
  ];
  const names = (rows: SearchableCustomer[]) => rows.map((row) => row.name);

  it('sorts by name in Slovenian order', () => {
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'sl'));
    expect(names(searchCustomers(list, '', 'vsi'))).toEqual(names(sorted));
    expect(names(searchCustomers(list, '', 'vsi')).slice(2, 4)).toEqual(['Cvetka', 'Čeh']);
    expect(names(searchCustomers(list, '', 'vsi')).slice(-2)).toEqual(['Zala', 'Žan']);
  });

  it('keeps only negative balances for dolzniki', () => {
    const result = searchCustomers(list, '', 'dolzniki');
    expect(result.length).toBe(list.filter((row) => row.balance < 0).length);
    expect(result.every((row) => row.balance < 0)).toBe(true);
  });

  it('keeps every customer without an account for brez, a pending invite included', () => {
    const result = searchCustomers(list, '', 'brez');
    expect(names(result).sort()).toEqual(names(list.filter((row) => !row.linked)).sort());
    expect(names(result)).toContain('Dora');
  });

  it('combines a filter with the search', () => {
    const result = searchCustomers(list, 'zan', 'dolzniki');
    expect(names(result)).toEqual(['Žan']);
    expect(searchCustomers(list, 'zala', 'dolzniki')).toEqual([]);
  });
});
