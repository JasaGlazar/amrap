-- Initial schema. Reference: docs/schema.md; ERD: docs/architecture/data-model.md.

-- Enums ------------------------------------------------------------------------------------

create type public.customer_role as enum ('trainer', 'customer');

create type public.appointment_status as enum (
  'booked', 'charged', 'cancelled', 'cancelled_late', 'cancelled_by_trainer'
);

create type public.appointment_source as enum ('recurring', 'self_booked', 'trainer');

create type public.transaction_type as enum (
  'topup', 'session', 'late_cancel', 'refund', 'adjustment'
);

-- Tables -----------------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  role public.customer_role not null default 'customer',
  auth_user_id uuid unique references auth.users (id) on delete set null,
  invite_token text unique,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.slot_templates (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  duration_minutes int not null default 60 check (duration_minutes > 0),
  capacity int not null default 5 check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  slot_template_id uuid not null references public.slot_templates (id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (customer_id, slot_template_id)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  slot_template_id uuid references public.slot_templates (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'booked',
  source public.appointment_source not null,
  rule_id uuid references public.recurring_rules (id),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index appointments_one_live_booking_idx
  on public.appointments (customer_id, starts_at)
  where status in ('booked', 'charged');
create index appointments_slot_template_id_starts_at_idx
  on public.appointments (slot_template_id, starts_at);
create index appointments_status_starts_at_idx
  on public.appointments (status, starts_at);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  amount int not null check (amount <> 0),
  type public.transaction_type not null,
  appointment_id uuid references public.appointments (id),
  created_by uuid references auth.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint credit_transactions_amount_matches_type check (
    case type
      when 'session' then amount = -1 and appointment_id is not null
      when 'late_cancel' then amount = -1 and appointment_id is not null
      when 'refund' then amount = 1 and appointment_id is not null
      when 'topup' then amount > 0
      when 'adjustment' then amount <> 0
      else false
    end
  )
);

-- refund is excluded so a charged appointment can still be refunded (ADR 0003).
create unique index credit_transactions_one_charge_per_appointment_idx
  on public.credit_transactions (appointment_id)
  where type in ('session', 'late_cancel');
create index credit_transactions_customer_id_idx
  on public.credit_transactions (customer_id);

create table public.blocked_periods (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.settings (
  id int primary key default 1 check (id = 1),
  late_cancel_hours int not null default 5 check (late_cancel_hours >= 0),
  timezone text not null default 'Europe/Ljubljana'
);

insert into public.settings (id) values (1);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- Balance view -----------------------------------------------------------------------------

create view public.customer_balances
  with (security_invoker = true)
as
  select c.id as customer_id, coalesce(sum(t.amount), 0) as balance
  from public.customers c
  left join public.credit_transactions t on t.customer_id = c.id
  group by c.id;

-- Role helpers -----------------------------------------------------------------------------

-- security definer so RLS policies can call these without recursing into customers' RLS.

create function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.customers c where c.auth_user_id = auth.uid()
$$;

create function public.is_trainer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.customers c
    where c.auth_user_id = auth.uid() and c.role = 'trainer'
  )
$$;

revoke execute on function public.current_customer_id() from public, anon;
revoke execute on function public.is_trainer() from public, anon;
grant execute on function public.current_customer_id() to authenticated, service_role;
grant execute on function public.is_trainer() to authenticated, service_role;

-- Row level security -----------------------------------------------------------------------

alter table public.customers enable row level security;
alter table public.slot_templates enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.appointments enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.blocked_periods enable row level security;
alter table public.settings enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "trainer full access" on public.customers
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "trainer full access" on public.slot_templates
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "trainer full access" on public.recurring_rules
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "trainer full access" on public.appointments
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "trainer full access" on public.credit_transactions
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "trainer full access" on public.blocked_periods
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "trainer full access" on public.settings
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));
create policy "trainer full access" on public.push_subscriptions
  for all to authenticated
  using ((select public.is_trainer())) with check ((select public.is_trainer()));

create policy "customer reads own row" on public.customers
  for select to authenticated
  using (auth_user_id = (select auth.uid()));
create policy "customer reads own recurring rules" on public.recurring_rules
  for select to authenticated
  using (customer_id = (select public.current_customer_id()));
create policy "customer reads own appointments" on public.appointments
  for select to authenticated
  using (customer_id = (select public.current_customer_id()));
create policy "customer reads own transactions" on public.credit_transactions
  for select to authenticated
  using (customer_id = (select public.current_customer_id()));

create policy "customer reads active slot templates" on public.slot_templates
  for select to authenticated
  using (active and (select public.current_customer_id()) is not null);
create policy "customer reads blocked periods" on public.blocked_periods
  for select to authenticated
  using ((select public.current_customer_id()) is not null);
create policy "customer reads settings" on public.settings
  for select to authenticated
  using ((select public.current_customer_id()) is not null);

create policy "user manages own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.current_customer_id()) is not null)
  with check (user_id = (select auth.uid()) and (select public.current_customer_id()) is not null);

-- Grants -----------------------------------------------------------------------------------

-- Supabase's default privileges would grant later objects to anon and authenticated too.
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.customer_balances from authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from authenticated;
