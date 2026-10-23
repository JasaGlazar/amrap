import type { AuthError, Session } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { CustomerRow } from '../auth/AuthContext';

// In-memory stand-in for the Supabase client, used through vi.mock('../lib/supabase').
// It answers only what the app asks for, and applies the same filters the real query would, so a
// test fails if the app selects the wrong row.

type AuthListener = (event: string, session: Session | null) => void;
type Result = { data: unknown; error: { message: string } | null };

type Query = PromiseLike<Result> & {
  select: (columns?: string) => Query;
  eq: (column: string, value: unknown) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<Result>;
};

export const db: {
  session: Session | null;
  customer: CustomerRow | null;
  balance: number;
  settingsError: { message: string } | null;
} = { session: null, customer: null, balance: 0, settingsError: null };

const listeners = new Set<AuthListener>();

export function makeSession(userId: string): Session {
  return { access_token: 'token', user: { id: userId } } as unknown as Session;
}

export function makeCustomer(overrides: Partial<CustomerRow>): CustomerRow {
  return {
    id: 'customer-1',
    name: 'Test',
    email: null,
    phone: null,
    role: 'customer',
    auth_user_id: 'user-1',
    invite_token: null,
    invite_expires_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Simulates Supabase Auth announcing a session change (sign-in, token refresh, sign-out). */
export function emitAuth(event: string, session: Session | null) {
  db.session = session;
  listeners.forEach((listener) => listener(event, session));
}

function runQuery(table: string, filters: Record<string, unknown>): Result {
  if (table === 'customers') {
    const row = db.customer;
    return { data: row && row.auth_user_id === filters.auth_user_id ? row : null, error: null };
  }
  if (table === 'customer_balances') {
    const row = db.customer;
    const match = row && row.id === filters.customer_id;
    return { data: match ? { balance: db.balance } : null, error: null };
  }
  if (table === 'settings') {
    return db.settingsError
      ? { data: null, error: db.settingsError }
      : { data: [{ id: 1 }], error: null };
  }
  throw new Error(`fakeSupabase: unexpected table ${table}`);
}

function makeQuery(table: string): Query {
  const filters: Record<string, unknown> = {};
  const result = () => Promise.resolve(runQuery(table, filters));
  const query: Query = {
    select: () => query,
    eq: (column, value) => {
      filters[column] = value;
      return query;
    },
    limit: () => query,
    maybeSingle: result,
    then: (onFulfilled, onRejected) => result().then(onFulfilled, onRejected),
  };
  return query;
}

export const fakeSupabase = {
  auth: {
    onAuthStateChange: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
};

export function authError(code: string, message: string): AuthError {
  return Object.assign(new Error(message), { code }) as unknown as AuthError;
}

/** Call in beforeEach: clears state and mocks, then optionally starts signed in. */
export function resetFake(initial: { session?: Session; customer?: CustomerRow | null } = {}) {
  db.session = initial.session ?? null;
  db.customer = initial.customer ?? null;
  db.balance = 0;
  db.settingsError = null;
  listeners.clear();

  fakeSupabase.auth.onAuthStateChange.mockReset().mockImplementation((listener: AuthListener) => {
    listeners.add(listener);
    queueMicrotask(() => listener('INITIAL_SESSION', db.session));
    return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
  });
  fakeSupabase.auth.signOut.mockReset().mockImplementation(() => {
    emitAuth('SIGNED_OUT', null);
    return Promise.resolve({ error: null });
  });
  fakeSupabase.auth.signInWithPassword.mockReset();
  fakeSupabase.auth.signUp.mockReset();
  fakeSupabase.from.mockReset().mockImplementation((table: string) => makeQuery(table));
  fakeSupabase.rpc.mockReset();
}
