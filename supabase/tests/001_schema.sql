-- Schema shape and table-level invariants: tables, enums, keys, indexes, check constraints,
-- the one-charge-per-appointment index and the customer_balances view.
begin;

select plan(81);

-- Tables, view and enums --------------------------------------------------------------------

select has_table('public', 'customers', 'customers table exists');
select has_table('public', 'slot_templates', 'slot_templates table exists');
select has_table('public', 'recurring_rules', 'recurring_rules table exists');
select has_table('public', 'appointments', 'appointments table exists');
select has_table('public', 'credit_transactions', 'credit_transactions table exists');
select has_table('public', 'blocked_periods', 'blocked_periods table exists');
select has_table('public', 'settings', 'settings table exists');
select has_table('public', 'push_subscriptions', 'push_subscriptions table exists');
select has_view('public', 'customer_balances', 'customer_balances view exists');

select enum_has_labels('public', 'customer_role', array['trainer', 'customer'],
  'customer_role enum labels');
select enum_has_labels('public', 'appointment_status',
  array['booked', 'charged', 'cancelled', 'cancelled_late', 'cancelled_by_trainer'],
  'appointment_status enum labels');
select enum_has_labels('public', 'appointment_source', array['recurring', 'self_booked', 'trainer'],
  'appointment_source enum labels');
select enum_has_labels('public', 'transaction_type',
  array['topup', 'session', 'late_cancel', 'refund', 'adjustment'],
  'transaction_type enum labels');

select is(
  array(select c.relname::text from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and not c.relrowsecurity order by 1),
  array[]::text[],
  'every table in public has row level security enabled');

-- Primary keys -----------------------------------------------------------------------------

select col_is_pk('public', 'customers', 'id', 'customers.id is the primary key');
select col_is_pk('public', 'slot_templates', 'id', 'slot_templates.id is the primary key');
select col_is_pk('public', 'recurring_rules', 'id', 'recurring_rules.id is the primary key');
select col_is_pk('public', 'appointments', 'id', 'appointments.id is the primary key');
select col_is_pk('public', 'credit_transactions', 'id', 'credit_transactions.id is the primary key');
select col_is_pk('public', 'blocked_periods', 'id', 'blocked_periods.id is the primary key');
select col_is_pk('public', 'settings', 'id', 'settings.id is the primary key');
select col_is_pk('public', 'push_subscriptions', 'id', 'push_subscriptions.id is the primary key');

-- Columns, uniques and foreign keys --------------------------------------------------------

select col_type_is('public', 'customers', 'role', 'customer_role', 'customers.role is customer_role');
select col_is_unique('public', 'customers', 'auth_user_id', 'customers.auth_user_id is unique');
select col_is_unique('public', 'customers', 'invite_token', 'customers.invite_token is unique');
select fk_ok('public', 'customers', 'auth_user_id', 'auth', 'users', 'id',
  'customers.auth_user_id references auth.users');

select col_type_is('public', 'slot_templates', 'weekday', 'smallint', 'slot_templates.weekday is smallint');
select col_type_is('public', 'slot_templates', 'start_time', 'time without time zone',
  'slot_templates.start_time is time');

select col_is_unique('public', 'recurring_rules', array['customer_id', 'slot_template_id'],
  'recurring_rules is unique per customer and slot template');
select fk_ok('public', 'recurring_rules', 'customer_id', 'public', 'customers', 'id',
  'recurring_rules.customer_id references customers');
select fk_ok('public', 'recurring_rules', 'slot_template_id', 'public', 'slot_templates', 'id',
  'recurring_rules.slot_template_id references slot_templates');

select col_type_is('public', 'appointments', 'status', 'appointment_status',
  'appointments.status is appointment_status');
select col_type_is('public', 'appointments', 'source', 'appointment_source',
  'appointments.source is appointment_source');
select col_is_null('public', 'appointments', 'slot_template_id',
  'appointments.slot_template_id is nullable (ad-hoc appointments)');
select fk_ok('public', 'appointments', 'customer_id', 'public', 'customers', 'id',
  'appointments.customer_id references customers');
select fk_ok('public', 'appointments', 'slot_template_id', 'public', 'slot_templates', 'id',
  'appointments.slot_template_id references slot_templates');
select fk_ok('public', 'appointments', 'rule_id', 'public', 'recurring_rules', 'id',
  'appointments.rule_id references recurring_rules');
select has_index('public', 'appointments', 'appointments_one_live_booking_idx',
  array['customer_id', 'starts_at'], 'appointments has the one-live-booking index');
select index_is_unique('public', 'appointments', 'appointments_one_live_booking_idx',
  'appointments_one_live_booking_idx is unique');
select has_index('public', 'appointments', 'appointments_slot_template_id_starts_at_idx',
  array['slot_template_id', 'starts_at'], 'appointments has the slot occupancy index');
select has_index('public', 'appointments', 'appointments_status_starts_at_idx',
  array['status', 'starts_at'], 'appointments has the status/start index');

select col_type_is('public', 'credit_transactions', 'type', 'transaction_type',
  'credit_transactions.type is transaction_type');
select fk_ok('public', 'credit_transactions', 'customer_id', 'public', 'customers', 'id',
  'credit_transactions.customer_id references customers');
select fk_ok('public', 'credit_transactions', 'appointment_id', 'public', 'appointments', 'id',
  'credit_transactions.appointment_id references appointments');
select fk_ok('public', 'credit_transactions', 'created_by', 'auth', 'users', 'id',
  'credit_transactions.created_by references auth.users');
select has_index('public', 'credit_transactions', 'credit_transactions_one_charge_per_appointment_idx',
  array['appointment_id'], 'credit_transactions has the one-charge index');
select index_is_unique('public', 'credit_transactions',
  'credit_transactions_one_charge_per_appointment_idx',
  'credit_transactions_one_charge_per_appointment_idx is unique');

select col_type_is('public', 'push_subscriptions', 'p256dh', 'text', 'push_subscriptions.p256dh is text');
select col_type_is('public', 'push_subscriptions', 'auth', 'text', 'push_subscriptions.auth is text');
select col_is_unique('public', 'push_subscriptions', 'endpoint', 'push_subscriptions.endpoint is unique');
select fk_ok('public', 'push_subscriptions', 'user_id', 'auth', 'users', 'id',
  'push_subscriptions.user_id references auth.users');

-- Default privileges: tables created by later migrations (as postgres) grant anon nothing and
-- authenticated only row-level DML.
create table public.default_privileges_probe (id int);
select table_privs_are('public', 'default_privileges_probe', 'anon', array[]::text[],
  'a new public table grants nothing to anon');
select table_privs_are('public', 'default_privileges_probe', 'authenticated',
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'a new public table grants authenticated only select/insert/update/delete');
drop table public.default_privileges_probe;

-- Helpers and the balance view -------------------------------------------------------------

select function_returns('public', 'current_customer_id', array[]::text[], 'uuid',
  'current_customer_id() returns uuid');
select function_returns('public', 'is_trainer', array[]::text[], 'boolean',
  'is_trainer() returns boolean');
select is(
  array(select p.proname::text || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':'
               || array_to_string(p.proconfig, ',')
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('current_customer_id', 'is_trainer')
        order by 1),
  array['current_customer_id:true:s:search_path=""', 'is_trainer:true:s:search_path=""'],
  'helpers are security definer, stable, with an empty search_path');
select ok(
  coalesce((select 'security_invoker=true' = any(c.reloptions) from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relname = 'customer_balances'),
           false),
  'customer_balances runs with the caller''s privileges (security_invoker)');

-- Defaults and the settings row ------------------------------------------------------------

select results_eq(
  $$select id, late_cancel_hours, timezone from public.settings$$,
  $$values (1, 5, 'Europe/Ljubljana'::text)$$,
  'settings holds exactly one row with the default cutoff and timezone');
select throws_ok(
  $$insert into public.settings (id) values (2)$$, '23514', null,
  'settings rejects a second row');

-- Fixtures (inserted as the test superuser, which bypasses RLS).
insert into public.customers (id, name) values
  ('00000000-0000-4000-8000-000000000001', 'Schema test customer'),
  ('00000000-0000-4000-8000-000000000002', 'Schema test customer with a balance'),
  ('00000000-0000-4000-8000-000000000003', 'Schema test customer without transactions');
insert into public.slot_templates (id, weekday, start_time)
  values ('00000000-0000-4000-8000-000000000011', 0, '07:00');
insert into public.appointments (id, customer_id, slot_template_id, starts_at, ends_at, source) values
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000011',
   '2030-01-07 07:00+01', '2030-01-07 08:00+01', 'self_booked');

select is(
  (select role::text from public.customers where id = '00000000-0000-4000-8000-000000000001'),
  'customer', 'a new customer defaults to role customer');
select results_eq(
  $$select duration_minutes, capacity, active from public.slot_templates
    where id = '00000000-0000-4000-8000-000000000011'$$,
  $$values (60, 5, true)$$,
  'a slot template defaults to 60 minutes, capacity 5, active');
select is(
  (select status::text from public.appointments where id = '00000000-0000-4000-8000-000000000021'),
  'booked', 'a new appointment defaults to status booked');

-- Check constraints ------------------------------------------------------------------------

select throws_ok(
  $$insert into public.slot_templates (weekday, start_time) values (7, '07:00')$$, '23514', null,
  'slot_templates.weekday must be 0..6');
select throws_ok(
  $$insert into public.slot_templates (weekday, start_time, capacity) values (1, '07:00', 0)$$,
  '23514', null, 'slot_templates.capacity must be positive');
select throws_ok(
  $$insert into public.slot_templates (weekday, start_time, duration_minutes) values (1, '07:00', 0)$$,
  '23514', null, 'slot_templates.duration_minutes must be positive');
select throws_ok(
  $$insert into public.appointments (customer_id, starts_at, ends_at, source)
    values ('00000000-0000-4000-8000-000000000001', '2030-01-08 07:00+01', '2030-01-08 07:00+01', 'trainer')$$,
  '23514', null, 'appointments.ends_at must be after starts_at');
select throws_ok(
  $$insert into public.blocked_periods (starts_at, ends_at)
    values ('2030-01-08 00:00+01', '2030-01-07 00:00+01')$$,
  '23514', null, 'blocked_periods.ends_at must be after starts_at');

-- One live booking per customer per start time.
select throws_ok(
  $$insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, source)
    values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011',
            '2030-01-07 07:00+01', '2030-01-07 08:00+01', 'trainer')$$,
  '23505', null, 'a second live booking for the same customer and start is rejected');
select lives_ok(
  $$insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, source, status, cancelled_at)
    values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011',
            '2030-01-07 07:00+01', '2030-01-07 08:00+01', 'self_booked', 'cancelled', now())$$,
  'a cancelled appointment does not block the live booking at the same start');

-- Amount rules per transaction type.
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type)
    values ('00000000-0000-4000-8000-000000000001', 0, 'adjustment')$$,
  '23514', null, 'a zero amount is rejected');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type, appointment_id)
    values ('00000000-0000-4000-8000-000000000001', -2, 'session', '00000000-0000-4000-8000-000000000021')$$,
  '23514', null, 'a session charge must be -1');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type)
    values ('00000000-0000-4000-8000-000000000001', -1, 'late_cancel')$$,
  '23514', null, 'a late_cancel charge must reference an appointment');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type, appointment_id)
    values ('00000000-0000-4000-8000-000000000001', 2, 'refund', '00000000-0000-4000-8000-000000000021')$$,
  '23514', null, 'a refund must be +1');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type)
    values ('00000000-0000-4000-8000-000000000001', 1, 'refund')$$,
  '23514', null, 'a refund must reference an appointment');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type)
    values ('00000000-0000-4000-8000-000000000001', -1, 'topup')$$,
  '23514', null, 'a top-up must be positive');

-- One charge per appointment; refunds are outside the rule.
select lives_ok(
  $$insert into public.credit_transactions (customer_id, amount, type, appointment_id)
    values ('00000000-0000-4000-8000-000000000001', -1, 'session', '00000000-0000-4000-8000-000000000021')$$,
  'the first session charge for an appointment is accepted');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type, appointment_id)
    values ('00000000-0000-4000-8000-000000000001', -1, 'session', '00000000-0000-4000-8000-000000000021')$$,
  '23505', null, 'a second session charge for the same appointment is rejected');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type, appointment_id)
    values ('00000000-0000-4000-8000-000000000001', -1, 'late_cancel', '00000000-0000-4000-8000-000000000021')$$,
  '23505', null, 'a late_cancel charge on an already charged appointment is rejected');
select lives_ok(
  $$insert into public.credit_transactions (customer_id, amount, type, appointment_id)
    values ('00000000-0000-4000-8000-000000000001', 1, 'refund', '00000000-0000-4000-8000-000000000021')$$,
  'a refund of a charged appointment is accepted');

-- Balance view -----------------------------------------------------------------------------

create temp table balance_fixture (amount int not null, type public.transaction_type not null)
  on commit drop;
insert into balance_fixture values (8, 'topup'), (3, 'topup'), (-2, 'adjustment'), (1, 'adjustment');
insert into public.credit_transactions (customer_id, amount, type)
  select '00000000-0000-4000-8000-000000000002', amount, type from balance_fixture;

select is(
  (select balance from public.customer_balances
   where customer_id = '00000000-0000-4000-8000-000000000002'),
  (select sum(amount) from balance_fixture),
  'customer_balances sums every transaction of the customer');
select is(
  (select balance from public.customer_balances
   where customer_id = '00000000-0000-4000-8000-000000000003'),
  0::bigint,
  'a customer without transactions has balance 0');

select * from finish();
rollback;
