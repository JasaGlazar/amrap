-- charge_due_appointments(): the 15-minute job. Every booked appointment that has started is
-- charged once (session -1, created_by null); running it again charges nothing. Only the
-- service role / cron may run it. After the charge a customer late cancel is rejected and the
-- partial unique index still allows only one charge.
--
-- Expected counts are computed from the database before the run (fixtures plus whatever the
-- dev seed holds), never hardcoded.
begin;

select plan(19);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('charge-trainer@test.local')),
  ('user_a', tests.create_user('charge-a@test.local')),
  ('user_b', tests.create_user('charge-b@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Charge trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Charge ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;

create temp table topups (customer text not null, amount int not null) on commit drop;
insert into topups values ('cust_a', 5), ('cust_a', 3);
insert into public.credit_transactions (customer_id, amount, type, created_by)
  select fx.id, t.amount, 'topup', (select id from fx where key = 'trainer_user')
  from topups t join fx on fx.key = t.customer;

-- Two due (one exactly at now()), one a minute in the future, one past but cancelled.
create temp table appt_spec (key text primary key, customer text, starts_at timestamptz,
                             status public.appointment_status) on commit drop;
insert into appt_spec values
  ('due_old', 'cust_a', now() - interval '2 hours', 'booked'),
  ('due_now', 'cust_b', now(), 'booked'),
  ('future', 'cust_a', now() + interval '1 minute', 'booked'),
  ('past_cancelled', 'cust_b', now() - interval '1 day', 'cancelled');

create temp table appts (key text primary key, id uuid not null, customer_id uuid not null)
  on commit drop;
with ins as (
  insert into public.appointments (customer_id, starts_at, ends_at, status, source)
  select fx.id, s.starts_at, s.starts_at + interval '1 hour', s.status, 'self_booked'
  from appt_spec s join fx on fx.key = s.customer
  returning id, customer_id, starts_at
)
insert into appts
  select s.key, ins.id, ins.customer_id from ins
  join fx on fx.id = ins.customer_id
  join appt_spec s on s.customer = fx.key and s.starts_at = ins.starts_at;

-- Everything the job should charge, computed without RLS before it runs.
create temp table expected_due as
  select a.id, a.customer_id from public.appointments a
  where a.status = 'booked' and a.starts_at <= now();

grant select on fx, topups, appts, expected_due to authenticated, service_role;

create temp table runs (run int primary key, charged int not null) on commit drop;
grant select, insert on runs to service_role;

-- Function definition and grants -----------------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'charge_due_appointments'),
  'true:search_path=""',
  'charge_due_appointments is security definer with an empty search_path');
select ok(not has_function_privilege('authenticated', 'public.charge_due_appointments()', 'EXECUTE'),
  'authenticated has no execute privilege on charge_due_appointments');
select ok(not has_function_privilege('anon', 'public.charge_due_appointments()', 'EXECUTE'),
  'anon has no execute privilege on charge_due_appointments');
select ok(has_function_privilege('service_role', 'public.charge_due_appointments()', 'EXECUTE'),
  'service_role can execute charge_due_appointments');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_ok($$select public.charge_due_appointments()$$, '42501', null,
  'the trainer (authenticated) cannot run the charge job');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_ok($$select public.charge_due_appointments()$$, '42501', null,
  'a customer (authenticated) cannot run the charge job');
select tests.clear_authentication();

-- First run --------------------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into runs select 1, public.charge_due_appointments();
select tests.clear_authentication();

select is((select charged from runs where run = 1), (select count(*)::int from expected_due),
  'the first run returns the number of due booked appointments');
select set_eq(
  $$select id from public.appointments where status = 'charged' and id in (select id from expected_due)$$,
  $$select id from expected_due$$,
  'every due booked appointment is now charged');
select set_eq(
  $$select appointment_id, customer_id, amount, type::text, created_by
    from public.credit_transactions where appointment_id in (select id from expected_due)$$,
  $$select id as appointment_id, customer_id, -1 as amount, 'session' as type, null::uuid as created_by
    from expected_due$$,
  'each charged appointment has exactly one session -1 transaction with created_by null');
select results_eq(
  $$select a.key, ap.status::text from appts a join public.appointments ap on ap.id = a.id
    where a.key in ('future', 'past_cancelled') order by a.key$$,
  $$values ('future', 'booked'), ('past_cancelled', 'cancelled')$$,
  'a future appointment and a cancelled past one are left alone');
select is_empty(
  $$select 1 from public.credit_transactions
    where appointment_id in (select id from appts where key in ('future', 'past_cancelled'))$$,
  'no transaction for the future or cancelled appointment');

-- Second run: idempotent -------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into runs select 2, public.charge_due_appointments();
select tests.clear_authentication();

select is((select charged from runs where run = 2), 0, 'running the job again charges nothing');
select is(
  (select count(*) from public.credit_transactions
   where type = 'session' and appointment_id in (select id from expected_due)),
  (select count(*) from expected_due),
  'after two runs there is still exactly one session row per due appointment');

-- Balances ---------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select is(
  (select balance from public.customer_balances where customer_id = (select id from fx where key = 'cust_a')),
  (select sum(amount) from topups where customer = 'cust_a')
    - (select count(*) from expected_due where customer_id = (select id from fx where key = 'cust_a')),
  'the customer''s balance is the top-ups minus one credit per charged appointment');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_b'));
select is(
  (select balance from public.customer_balances where customer_id = (select id from fx where key = 'cust_b')),
  -(select count(*) from expected_due where customer_id = (select id from fx where key = 'cust_b')),
  'a customer without credits is charged anyway and goes negative');

-- Charge vs late cancel --------------------------------------------------------------------

select throws_matching($$select public.cancel((select id from appts where key = 'due_now'))$$,
  '^AMRAP_NOT_CANCELLABLE:', 'after the charge, the customer''s late cancel is rejected');
select tests.clear_authentication();

select is(
  (select count(*) from public.credit_transactions
   where type in ('session', 'late_cancel') and appointment_id = (select id from appts where key = 'due_now')),
  1::bigint,
  'the rejected late cancel added no charge: one charge for the appointment');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type, appointment_id)
    select customer_id, -1, 'late_cancel', id from appts where key = 'due_now'$$,
  '23505', null, 'the partial unique index refuses a second charge for the charged appointment');
select is((select status::text from public.appointments where id = (select id from appts where key = 'due_now')),
  'charged', 'the appointment stays charged');

select * from finish();
rollback;
