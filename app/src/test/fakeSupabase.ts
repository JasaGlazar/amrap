import type { AuthError, Session } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { CustomerRow } from '../auth/AuthContext';

type AuthListener = (event: string, session: Session | null) => void;
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Predicate = (row: Row) => boolean;

type Query = PromiseLike<Result> & {
  select: (columns?: string) => Query;
  insert: (values: Row | Row[]) => Query;
  update: (values: Row) => Query;
  delete: () => Query;
  single: () => Promise<Result>;
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
  customers: Row[];
  customer_balances: Row[];
  recurring_rules: Row[];
  slot_templates: Row[];
  slot_occupancy: Row[];
  appointments: Row[];
  credit_transactions: Row[];
  blocked_periods: Row[];
  push_subscriptions: Row[];
};

export const db: {
  session: Session | null;
  customer: CustomerRow | null;
  balance: number;
  settings: { id: number; late_cancel_hours: number; timezone: string };
  settingsError: { message: string } | null;
  customersError: { message: string } | null;
  readErrors: Record<string, { message: string }>;
  tables: Tables;
} = {
  session: null,
  customer: null,
  balance: 0,
  settings: defaultSettings(),
  settingsError: null,
  customersError: null,
  readErrors: {},
  tables: emptyTables(),
};

function defaultSettings() {
  return { id: 1, late_cancel_hours: 5, timezone: 'Europe/Ljubljana' };
}

function emptyTables(): Tables {
  return {
    customers: [],
    customer_balances: [],
    recurring_rules: [],
    slot_templates: [],
    slot_occupancy: [],
    appointments: [],
    credit_transactions: [],
    blocked_periods: [],
    push_subscriptions: [],
  };
}

export const selects: { table: string; columns: string | undefined }[] = [];

const listeners = new Set<AuthListener>();

export function postgrestTime(instant: Date): string {
  return instant
    .toISOString()
    .replace(/\.000Z$/, '+00:00')
    .replace(/Z$/, '+00:00');
}

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

function signedInCustomer(): Row[] {
  if (db.customer === null) return [];
  const listed = db.tables.customers.some((row) => row.id === db.customer?.id);
  return listed ? [] : [db.customer];
}

function rowsOf(table: string): Row[] | Result {
  if (table in db.readErrors) return { data: null, error: db.readErrors[table] };
  if (table === 'customers') {
    if (db.customersError) return { data: null, error: db.customersError };
    return [...signedInCustomer(), ...db.tables.customers];
  }
  if (table === 'customer_balances') {
    const own = signedInCustomer().map((row) => ({ customer_id: row.id, balance: db.balance }));
    return [...own, ...db.tables.customer_balances];
  }
  if (table === 'settings') {
    return db.settingsError ? { data: null, error: db.settingsError } : [db.settings];
  }
  if (table in db.tables) return db.tables[table as keyof Tables];
  throw new Error(`fakeSupabase: unexpected table ${table}`);
}

const insertDefaults: Record<string, Row> = {
  customers: { role: 'customer', auth_user_id: null, invite_token: null, invite_expires_at: null },
  recurring_rules: { active: true },
  slot_templates: { active: true, duration_minutes: 60, capacity: 5 },
  blocked_periods: { reason: null },
};

function writableRows(table: string): Row[] {
  if (table === 'settings') return [db.settings];
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
  let write:
    { kind: 'insert'; rows: Row[] } | { kind: 'update'; values: Row } | { kind: 'delete' } | null =
    null;
  let written: Row[] | null = null;

  function applyWrite(): Row[] {
    if (written !== null || write === null) return written ?? [];
    const target = writableRows(table);
    const matches = () => target.filter((row) => predicates.every((predicate) => predicate(row)));
    if (write.kind === 'insert') {
      written = write.rows.map((values) => ({
        id: `${table}-${nextId++}`,
        ...insertDefaults[table],
        ...values,
      }));
      target.push(...written);
    } else if (write.kind === 'update') {
      written = matches();
      for (const row of written) Object.assign(row, write.values);
    } else {
      written = matches();
      for (const row of written) target.splice(target.indexOf(row), 1);
    }
    return written;
  }

  function rows(): Result {
    if (write !== null) return { data: applyWrite(), error: null };
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
    select: (columns) => {
      if (write === null) selects.push({ table, columns });
      return query;
    },
    insert: (values) => {
      write = { kind: 'insert', rows: Array.isArray(values) ? values : [values] };
      return query;
    },
    update: (values) => {
      write = { kind: 'update', values };
      return query;
    },
    delete: () => {
      write = { kind: 'delete' };
      return query;
    },
    single: () => {
      const result = rows();
      const first = Array.isArray(result.data) ? result.data[0] : result.data;
      return Promise.resolve(
        first === undefined || first === null
          ? { data: null, error: { message: 'fakeSupabase: no row for single()' } }
          : { data: first, error: result.error },
      );
    },
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
    slot_template_id: args.p_slot_template_id ?? null,
    starts_at: startsAt,
    ends_at: args.p_ends_at ?? new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(),
    status: 'booked',
  });
  if (args.p_slot_template_id === undefined) return { data: id, error: null };
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
  if (appointment.status === 'charged') {
    db.tables.credit_transactions.push({
      id: `refund-${nextId++}`,
      customer_id: appointment.customer_id,
      amount: 1,
      type: 'refund',
      note: null,
      created_at: new Date().toISOString(),
    });
  }
  appointment.status = db.customer?.role === 'trainer' ? 'cancelled_by_trainer' : 'cancelled';
  const occupancy = occupancyRow(appointment.slot_template_id, appointment.starts_at);
  if (occupancy) occupancy.booked_count = Number(occupancy.booked_count) - 1;
  return { data: null, error: null };
}

function fakeCredit(type: 'topup' | 'adjustment', args: Row): Result {
  const id = `${type}-${nextId++}`;
  db.tables.credit_transactions.push({
    id,
    customer_id: args.p_customer_id,
    amount: args.p_amount,
    type,
    note: args.p_note ?? null,
    created_at: new Date().toISOString(),
  });
  const balance = db.tables.customer_balances.find((row) => row.customer_id === args.p_customer_id);
  if (balance) balance.balance = Number(balance.balance) + Number(args.p_amount);
  return { data: id, error: null };
}

function fakeCreateInvite(args: Row): Result {
  const customer = db.tables.customers.find((row) => row.id === args.p_customer_id);
  if (customer === undefined) return { data: null, error: { message: 'AMRAP_NOT_FOUND: x' } };
  const token = `token-${nextId++}`;
  customer.invite_token = token;
  customer.invite_expires_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return { data: token, error: null };
}

function fakeSetRule(args: Row, active: boolean): Result {
  const rule = db.tables.recurring_rules.find((row) => row.id === args.p_rule_id);
  if (rule === undefined) return { data: null, error: { message: 'AMRAP_NOT_FOUND: x' } };
  rule.active = active;
  if (active) return { data: 0, error: null };
  const cancelled = db.tables.appointments.filter(
    (row) =>
      row.rule_id === rule.id &&
      row.status === 'booked' &&
      compare(row.starts_at, new Date().toISOString()) > 0,
  );
  for (const row of cancelled) row.status = 'cancelled_by_trainer';
  return { data: cancelled.length, error: null };
}

function fakeSavePushSubscription(args: Row): Result {
  const subscriptions = db.tables.push_subscriptions.filter(
    (row) => row.endpoint !== args.p_endpoint,
  );
  subscriptions.push({
    id: `push-${nextId++}`,
    user_id: db.session?.user.id ?? null,
    endpoint: args.p_endpoint,
    p256dh: args.p_p256dh,
    auth: args.p_auth,
  });
  db.tables.push_subscriptions = subscriptions;
  return { data: null, error: null };
}

const rpcs: Record<string, (args: Row) => Result> = {
  book: fakeBook,
  cancel: fakeCancel,
  top_up: (args) => fakeCredit('topup', args),
  adjust: (args) => fakeCredit('adjustment', args),
  create_invite: fakeCreateInvite,
  activate_rule: (args) => fakeSetRule(args, true),
  deactivate_rule: (args) => fakeSetRule(args, false),
  save_push_subscription: fakeSavePushSubscription,
};

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
  selects.length = 0;
  db.settingsError = null;
  db.customersError = null;
  db.readErrors = {};
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
    const handler = rpcs[name];
    if (handler === undefined) throw new Error(`fakeSupabase: unexpected rpc ${name}`);
    return handler(args);
  });
}
