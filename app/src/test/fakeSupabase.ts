import type { AuthError, Session } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { CustomerRow } from '../auth/AuthContext';

type AuthListener = (event: string, session: Session | null) => void;
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Predicate = (row: Row) => boolean;

type Query = PromiseLike<Result> & {
  select: (columns?: string) => Query;
  eq: (column: string, value: unknown) => Query;
  neq: (column: string, value: unknown) => Query;
  gt: (column: string, value: unknown) => Query;
  gte: (column: string, value: unknown) => Query;
  lt: (column: string, value: unknown) => Query;
  lte: (column: string, value: unknown) => Query;
  in: (column: string, values: unknown[]) => Query;
  or: (filters: string) => Query;
  order: (column: string, options?: { ascending?: boolean }) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<Result>;
};

type Tables = {
  slot_templates: Row[];
  slot_occupancy: Row[];
  appointments: Row[];
  credit_transactions: Row[];
  blocked_periods: Row[];
};

export const db: {
  session: Session | null;
  customer: CustomerRow | null;
  balance: number;
  settings: { id: number; late_cancel_hours: number; timezone: string };
  settingsError: { message: string } | null;
  customersError: { message: string } | null;
  tables: Tables;
} = {
  session: null,
  customer: null,
  balance: 0,
  settings: defaultSettings(),
  settingsError: null,
  customersError: null,
  tables: emptyTables(),
};

function defaultSettings() {
  return { id: 1, late_cancel_hours: 5, timezone: 'Europe/Ljubljana' };
}

function emptyTables(): Tables {
  return {
    slot_templates: [],
    slot_occupancy: [],
    appointments: [],
    credit_transactions: [],
    blocked_periods: [],
  };
}

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

export function emitAuth(event: string, session: Session | null) {
  db.session = session;
  listeners.forEach((listener) => listener(event, session));
}

function rowsOf(table: string): Row[] | Result {
  if (table === 'customers') {
    if (db.customersError) return { data: null, error: db.customersError };
    return db.customer ? [db.customer] : [];
  }
  if (table === 'customer_balances') {
    return db.customer ? [{ customer_id: db.customer.id, balance: db.balance }] : [];
  }
  if (table === 'settings') {
    return db.settingsError ? { data: null, error: db.settingsError } : [db.settings];
  }
  if (table in db.tables) return db.tables[table as keyof Tables];
  throw new Error(`fakeSupabase: unexpected table ${table}`);
}

function comparable(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return Date.parse(value);
  return value;
}

function compare(a: unknown, b: unknown): number {
  const left = comparable(a) as number | string;
  const right = comparable(b) as number | string;
  return left < right ? -1 : left > right ? 1 : 0;
}

const operators: Record<string, (a: unknown, b: unknown) => boolean> = {
  eq: (a, b) => compare(a, b) === 0,
  neq: (a, b) => compare(a, b) !== 0,
  gt: (a, b) => compare(a, b) > 0,
  gte: (a, b) => compare(a, b) >= 0,
  lt: (a, b) => compare(a, b) < 0,
  lte: (a, b) => compare(a, b) <= 0,
};

function orPredicate(filters: string): Predicate {
  const parts = filters.split(',').map((part) => {
    const [column, operator, ...rest] = part.split('.');
    const check = operators[operator];
    if (check === undefined) throw new Error(`fakeSupabase: unsupported or operator ${operator}`);
    return (row: Row) => check(row[column], rest.join('.'));
  });
  return (row) => parts.some((part) => part(row));
}

function makeQuery(table: string): Query {
  const predicates: Predicate[] = [];
  const orders: { column: string; ascending: boolean }[] = [];
  let limit: number | undefined;

  function rows(): Result {
    const source = rowsOf(table);
    if (!Array.isArray(source)) return source;
    const matched = source.filter((row) => predicates.every((predicate) => predicate(row)));
    matched.sort((a, b) => {
      for (const { column, ascending } of orders) {
        const order = compare(a[column], b[column]);
        if (order !== 0) return ascending ? order : -order;
      }
      return 0;
    });
    return { data: matched.slice(0, limit), error: null };
  }

  function where(operator: string) {
    return (column: string, value: unknown) => {
      predicates.push((row) => operators[operator](row[column], value));
      return query;
    };
  }

  const query: Query = {
    select: () => query,
    eq: where('eq'),
    neq: where('neq'),
    gt: where('gt'),
    gte: where('gte'),
    lt: where('lt'),
    lte: where('lte'),
    in: (column, values) => {
      predicates.push((row) => values.some((value) => compare(row[column], value) === 0));
      return query;
    },
    or: (filters) => {
      predicates.push(orPredicate(filters));
      return query;
    },
    order: (column, options) => {
      orders.push({ column, ascending: options?.ascending ?? true });
      return query;
    },
    limit: (count) => {
      limit = count;
      return query;
    },
    maybeSingle: () => {
      const result = rows();
      const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
      return Promise.resolve({ data, error: result.error });
    },
    then: (onFulfilled, onRejected) => Promise.resolve(rows()).then(onFulfilled, onRejected),
  };
  return query;
}

let nextId = 1;

function occupancyRow(templateId: unknown, startsAt: unknown): Row | undefined {
  return db.tables.slot_occupancy.find(
    (row) => row.slot_template_id === templateId && compare(row.starts_at, startsAt) === 0,
  );
}

function fakeBook(args: Row): Result {
  const template = db.tables.slot_templates.find((row) => row.id === args.p_slot_template_id);
  const startsAt = String(args.p_starts_at);
  const minutes = Number(template?.duration_minutes ?? 60);
  const id = `booked-${nextId++}`;
  db.tables.appointments.push({
    id,
    customer_id: args.p_customer_id,
    slot_template_id: args.p_slot_template_id,
    starts_at: startsAt,
    ends_at: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
    status: 'booked',
  });
  const occupancy = occupancyRow(args.p_slot_template_id, startsAt);
  if (occupancy) occupancy.booked_count = Number(occupancy.booked_count) + 1;
  else
    db.tables.slot_occupancy.push({
      slot_template_id: args.p_slot_template_id,
      starts_at: startsAt,
      booked_count: 1,
    });
  return { data: id, error: null };
}

function fakeCancel(args: Row): Result {
  const appointment = db.tables.appointments.find((row) => row.id === args.p_appointment_id);
  if (appointment === undefined) return { data: null, error: { message: 'AMRAP_NOT_FOUND: x' } };
  appointment.status = 'cancelled';
  const occupancy = occupancyRow(appointment.slot_template_id, appointment.starts_at);
  if (occupancy) occupancy.booked_count = Number(occupancy.booked_count) - 1;
  return { data: null, error: null };
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

export function resetFake(initial: { session?: Session; customer?: CustomerRow | null } = {}) {
  db.session = initial.session ?? null;
  db.customer = initial.customer ?? null;
  db.balance = 0;
  db.settings = defaultSettings();
  db.tables = emptyTables();
  db.settingsError = null;
  db.customersError = null;
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
  fakeSupabase.rpc.mockReset().mockImplementation(async (name: string, args: Row) => {
    if (name === 'book') return fakeBook(args);
    if (name === 'cancel') return fakeCancel(args);
    throw new Error(`fakeSupabase: unexpected rpc ${name}`);
  });
}
