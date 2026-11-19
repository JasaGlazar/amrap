-- cancel(): customer cancels are free before the cutoff and charged (late_cancel) after it,
-- and only while the appointment is booked and not started. Trainer cancels never charge and
-- refund an existing charge. A cancelled appointment cannot be cancelled again by anyone.
-- The trainer may give a reason (trimmed, blank means none, at most 200 characters); a customer
-- may not.
--
-- Appointments are inserted directly as the test superuser (book() would refuse past starts),
-- with start times derived from now() (frozen for the transaction) and the configured cutoff.
begin;

select plan(50);

-- Fixtures ---------------------------------------------------------------------------------

-- Customers call book() here; the booking setting is off by default.
update public.settings set customer_booking_enabled = true where id = 1;

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('cancel-trainer@test.local')),
  ('user_a', tests.create_user('cancel-a@test.local')),
  ('user_b', tests.create_user('cancel-b@test.local')),
  ('user_c', tests.create_user('cancel-c@test.local')),
  ('user_nobody', tests.create_user('cancel-nobody@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Cancel trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Cancel ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b', 'user_c')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;

-- Top-ups. Customer B deliberately has none (balance 0) for the negative-balance case.
create temp table topups (customer text not null, amount int not null) on commit drop;
insert into topups values ('cust_a', 4), ('cust_a', 2), ('cust_c', 3);
insert into public.credit_transactions (customer_id, amount, type, created_by)
  select fx.id, t.amount, 'topup', (select id from fx where key = 'trainer_user')
  from topups t join fx on fx.key = t.customer;

create temp table cutoff as
  select late_cancel_hours * interval '1 hour' as cutoff from public.settings where id = 1;

-- Appointments: (key, customer, start relative to now(), status).
create temp table appts (key text primary key, id uuid) on commit drop;
create temp table appt_spec (key text, customer text, starts_at timestamptz, status public.appointment_status)
  on commit drop;
insert into appt_spec
  select v.key, v.customer, v.starts_at, v.status
  from cutoff,
       lateral (values
         ('free', 'cust_a', now() + cutoff.cutoff + interval '1 minute', 'booked'::public.appointment_status),
         ('late', 'cust_a', now() + cutoff.cutoff - interval '1 minute', 'booked'),
         ('started', 'cust_a', now() - interval '5 minutes', 'booked'),
         ('a_charged', 'cust_a', now() - interval '1 hour', 'charged'),
         ('b_late', 'cust_b', now() + interval '1 hour', 'booked'),
         ('b_future', 'cust_b', now() + interval '3 days', 'booked'),
         ('c_charged', 'cust_c', now() - interval '2 hours', 'charged'),
         ('c_cancelled', 'cust_c', now() + interval '4 days', 'cancelled'),
         ('settings_probe', 'cust_a', now() + interval '2 days', 'booked'),
         ('trainer_blank', 'cust_c', now() + interval '5 days', 'booked'),
         ('trainer_long', 'cust_c', now() + interval '6 days', 'booked'),
         ('trainer_max', 'cust_c', now() + interval '7 days', 'booked')
       ) v(key, customer, starts_at, status);

with ins as (
  insert into public.appointments (customer_id, starts_at, ends_at, status, source)
  select fx.id, s.starts_at, s.starts_at + interval '1 hour', s.status, 'self_booked'
  from appt_spec s join fx on fx.key = s.customer
  order by s.key
  returning id, customer_id, starts_at
)
insert into appts
  select s.key, ins.id from ins
  join fx on fx.id = ins.customer_id
  join appt_spec s on s.customer = fx.key and s.starts_at = ins.starts_at;

-- Charged fixtures carry their session charge, as the charge job would have written it.
insert into public.credit_transactions (customer_id, amount, type, appointment_id)
  select a.customer_id, -1, 'session', a.id from public.appointments a
  where a.id in (select id from appts where key in ('a_charged', 'c_charged'));

grant select on fx, topups, cutoff to authenticated, service_role;
grant select, insert on appts to authenticated, service_role;

-- Transactions per appointment and per customer, as seen without RLS.
create function pg_temp.appt_tx(p_key text) returns table (type text, amount int, created_by uuid)
language sql as $$
  select t.type::text, t.amount, t.created_by from public.credit_transactions t
  where t.appointment_id = (select id from appts where key = p_key) order by t.created_at, t.type
$$;
create function pg_temp.appt(p_key text) returns public.appointments language sql as $$
  select * from public.appointments where id = (select id from appts where key = p_key)
$$;
create temp table tx_before as select count(*) as n from public.credit_transactions;

-- Function definition ----------------------------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel'),
  'true:search_path=""',
  'cancel is security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.cancel(uuid, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.cancel(uuid, text)', 'EXECUTE'),
  'authenticated can execute cancel, anon cannot');
select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel'),
  1, 'there is one cancel function, so a call with only p_appointment_id resolves');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel'),
  'p_appointment_id uuid, p_reason text DEFAULT NULL::text',
  'cancel takes an optional reason that defaults to null');

-- Customer A: the cutoff boundary ----------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));

select lives_ok($$select public.cancel((select id from appts where key = 'free'))$$,
  'a customer cancels an appointment that starts one minute after the cutoff');
select lives_ok($$select public.cancel((select id from appts where key = 'late'))$$,
  'a customer cancels an appointment that starts one minute before the cutoff');

select throws_matching($$select public.cancel((select id from appts where key = 'a_charged'))$$,
  '^AMRAP_NOT_CANCELLABLE:', 'a customer cannot cancel a charged appointment');
select throws_matching($$select public.cancel((select id from appts where key = 'started'))$$,
  '^AMRAP_NOT_CANCELLABLE:', 'a customer cannot cancel an appointment that has started but is not charged yet');
select throws_matching($$select public.cancel((select id from appts where key = 'late'))$$,
  '^AMRAP_NOT_CANCELLABLE:', 'a customer cannot cancel a cancelled_late appointment again');
select throws_matching($$select public.cancel((select id from appts where key = 'free'))$$,
  '^AMRAP_NOT_CANCELLABLE:', 'a customer cannot cancel a cancelled appointment again');
select throws_matching($$select public.cancel((select id from appts where key = 'b_future'))$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot cancel another customer''s appointment');
select throws_matching($$select public.cancel(gen_random_uuid())$$,
  '^AMRAP_NOT_FOUND:', 'cancelling an unknown appointment is rejected');
select throws_matching($$select public.cancel((select id from appts where key = 'settings_probe'), 'Bolezen')$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot give a reason');

select tests.clear_authentication();

select results_eq($$select status::text, cancel_reason from pg_temp.appt('settings_probe')$$,
  $$values ('booked', null::text)$$,
  'the rejected cancel with a reason left the appointment booked, without a reason');

select results_eq($$select status::text, cancelled_at, cancel_reason from pg_temp.appt('free')$$,
  $$values ('cancelled', now(), null::text)$$,
  'one minute after the cutoff: status cancelled, cancelled_at set, no reason');
select is_empty($$select * from pg_temp.appt_tx('free')$$,
  'one minute after the cutoff: no transaction');
select results_eq($$select status::text, cancelled_at from pg_temp.appt('late')$$,
  $$values ('cancelled_late', now())$$,
  'one minute before the cutoff: status cancelled_late, cancelled_at set');
select results_eq($$select * from pg_temp.appt_tx('late')$$,
  $$values ('late_cancel', -1, (select id from fx where key = 'user_a'))$$,
  'one minute before the cutoff: exactly one late_cancel -1 row, created by the customer');
select results_eq($$select * from pg_temp.appt_tx('a_charged')$$,
  $$values ('session', -1, null::uuid)$$,
  'the rejected cancel of a charged appointment left only its session charge');
select is((select status::text from pg_temp.appt('a_charged')), 'charged',
  'the rejected cancel left the charged appointment charged');
select is((select status::text from pg_temp.appt('started')), 'booked',
  'the rejected cancel left the started appointment booked (the charge job will charge it)');
select is(
  (select count(*) from public.credit_transactions),
  (select n from tx_before) + 1,
  'the customer''s cancels wrote exactly one transaction in total (the late cancel)');

-- Customer B: a late cancel with balance 0 goes negative -----------------------------------

create temp table expected_balance as
  select fx.key, coalesce((select sum(amount) from topups t where t.customer = fx.key), 0) as topped_up
  from fx where key like 'cust_%';
grant select on expected_balance to authenticated;

select tests.authenticate_as((select id from fx where key = 'user_b'));
select lives_ok($$select public.cancel((select id from appts where key = 'b_late'))$$,
  'a customer with balance 0 can still cancel late');
select is(
  (select balance from public.customer_balances where customer_id = (select id from fx where key = 'cust_b')),
  (select topped_up - 1 from expected_balance where key = 'cust_b'),
  'the late cancel takes the balance below zero, and the view shows it');
select tests.clear_authentication();

-- Auth user without a customer record, and anon --------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_nobody'));
select throws_matching($$select public.cancel((select id from appts where key = 'b_future'))$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot cancel');
select tests.clear_authentication();

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.cancel('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'anon cannot execute cancel');
select tests.clear_authentication();

-- Trainer ----------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'trainer_user'));

select lives_ok($$select public.cancel((select id from appts where key = 'b_future'), '  Bolezen trenerja  ')$$,
  'the trainer cancels a booked appointment with a reason');
select lives_ok($$select public.cancel((select id from appts where key = 'c_charged'))$$,
  'the trainer cancels a charged appointment');
select throws_matching($$select public.cancel((select id from appts where key = 'late'))$$,
  '^AMRAP_NOT_CANCELLABLE:', 'the trainer cannot cancel a cancelled_late appointment (waive with adjust)');
select throws_matching($$select public.cancel((select id from appts where key = 'c_cancelled'))$$,
  '^AMRAP_NOT_CANCELLABLE:', 'the trainer cannot cancel a cancelled appointment');
select throws_matching($$select public.cancel((select id from appts where key = 'b_future'))$$,
  '^AMRAP_NOT_CANCELLABLE:', 'the trainer cannot cancel a cancelled_by_trainer appointment again');
select throws_matching($$select public.cancel(gen_random_uuid())$$,
  '^AMRAP_NOT_FOUND:', 'the trainer cancelling an unknown appointment is rejected');
select lives_ok($$select public.cancel((select id from appts where key = 'trainer_blank'), E' \t ')$$,
  'the trainer cancels with a blank reason');
select throws_matching(
  $$select public.cancel((select id from appts where key = 'trainer_long'), repeat('x', 201))$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a reason over 200 characters is rejected');
select lives_ok(
  $$select public.cancel((select id from appts where key = 'trainer_max'), ' ' || repeat('ž', 200) || ' ')$$,
  'a reason of 200 characters after trimming is accepted');

select tests.clear_authentication();

select results_eq($$select status::text, cancelled_at, cancel_reason from pg_temp.appt('b_future')$$,
  $$values ('cancelled_by_trainer', now(), 'Bolezen trenerja')$$,
  'trainer cancel of a booked appointment: cancelled_by_trainer, cancelled_at set, the reason trimmed');
select is_empty($$select * from pg_temp.appt_tx('b_future')$$,
  'trainer cancel of a booked appointment: no transaction');
select results_eq($$select status::text, cancelled_at, cancel_reason from pg_temp.appt('c_charged')$$,
  $$values ('cancelled_by_trainer', now(), null::text)$$,
  'trainer cancel of a charged appointment: cancelled_by_trainer, cancelled_at set, no reason');
select results_eq($$select status::text, cancel_reason from pg_temp.appt('trainer_blank')$$,
  $$values ('cancelled_by_trainer', null::text)$$,
  'a blank reason is stored as no reason');
select results_eq($$select status::text, cancel_reason from pg_temp.appt('trainer_long')$$,
  $$values ('booked', null::text)$$,
  'the rejected over-long reason left the appointment booked');
select results_eq($$select status::text, cancel_reason from pg_temp.appt('trainer_max')$$,
  $$values ('cancelled_by_trainer', repeat('ž', 200))$$,
  'the 200-character reason is stored without the spaces around it');

select throws_ok(
  $$update public.appointments set cancel_reason = '' where id = (select id from appts where key = 'trainer_long')$$,
  '23514', null, 'the table refuses an empty reason');
select throws_ok(
  $$update public.appointments set cancel_reason = repeat('x', 201)
    where id = (select id from appts where key = 'trainer_long')$$,
  '23514', null, 'the table refuses a reason over 200 characters');
select results_eq($$select * from pg_temp.appt_tx('c_charged') order by 1$$,
  $$values ('refund', 1, (select id from fx where key = 'trainer_user')), ('session', -1, null::uuid)$$,
  'trainer cancel of a charged appointment: one refund +1 by the trainer next to the session -1');

select tests.authenticate_as((select id from fx where key = 'user_c'));
select is(
  (select balance from public.customer_balances where customer_id = (select id from fx where key = 'cust_c')),
  (select topped_up from expected_balance where key = 'cust_c'),
  'after the refund the charge nets to zero: the balance is back to the top-ups');
select tests.clear_authentication();

-- A cancel frees a place in a full slot ----------------------------------------------------

create temp table slot_time as
  with base as (
    select s.timezone as tz,
           date_trunc('day', now() at time zone s.timezone) + interval '9 days' + time '08:00' as local
    from public.settings s where s.id = 1
  )
  select base.local at time zone base.tz as ts from base;
with t as (
  insert into public.slot_templates (weekday, start_time, capacity)
  select extract(isodow from st.ts at time zone s.timezone)::smallint - 1,
         (st.ts at time zone s.timezone)::time, 1
  from slot_time st, public.settings s where s.id = 1
  returning id
) insert into fx select 'slot', id from t;
grant select on slot_time to authenticated;

select tests.authenticate_as((select id from fx where key = 'user_a'));
insert into appts
  select 'slot_a', public.book((select id from fx where key = 'cust_a'), (select ts from slot_time),
                               (select id from fx where key = 'slot'));
select tests.clear_authentication();

select is(
  (select count(*) from public.appointments
   where slot_template_id = (select id from fx where key = 'slot') and status in ('booked', 'charged')),
  (select capacity::bigint from public.slot_templates where id = (select id from fx where key = 'slot')),
  'the slot is filled to its capacity');

select tests.authenticate_as((select id from fx where key = 'user_b'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_b'), (select ts from slot_time),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_CAPACITY_FULL:', 'the next booking of the full slot fails');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_a'));
select lives_ok($$select public.cancel((select id from appts where key = 'slot_a'))$$,
  'the customer cancels their place in the full slot');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_b'));
select lives_ok(
  $$select public.book((select id from fx where key = 'cust_b'), (select ts from slot_time),
                       (select id from fx where key = 'slot'))$$,
  'the freed place can be booked');
select tests.clear_authentication();

-- Without the settings row the cutoff is unknown: fail closed ------------------------------

delete from public.settings where id = 1;
select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.cancel((select id from appts where key = 'settings_probe'))$$,
  '^AMRAP_SETTINGS_MISSING:', 'a customer cancel fails closed when the settings row is missing');
select tests.clear_authentication();

select * from finish();
rollback;
