-- Event notifications and save_push_subscription(). A customer's own booking notifies the
-- trainer (booking_created), a customer's cancel notifies the trainer (booking_cancelled, with
-- late), a top-up or adjustment notifies the customer (credit_topup / credit_adjustment, with
-- the new balance). Trainer bookings, materialization, trainer cancels, charges and refunds
-- notify nobody; nor does anything for a recipient without a subscription or account, or
-- without push config. A failing notification never fails the action. save_push_subscription
-- moves a device's endpoint to whoever saved it last.
--
-- Fixture starts are built from now() and today's date in settings.timezone; expected data is
-- derived from the fixtures and the ledger.
begin;

select plan(27);

-- Fixtures ---------------------------------------------------------------------------------

update public.settings set late_cancel_hours = 5 where id = 1;

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('event-trainer@test.local')),
  ('user_a', tests.create_user('event-a@test.local')),
  ('user_b', tests.create_user('event-b@test.local')),
  ('user_nobody', tests.create_user('event-nobody@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Event trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Event ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;
with c as (
  insert into public.customers (name) values ('Event C (no account)') returning id
) insert into fx select 'cust_c', id from c;

-- The trainer and customer A have a device; B has none.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test.invalid/event-' || key, 'p256dh', 'auth'
  from fx where key in ('trainer_user', 'user_a');

create temp table gym as
  select s.timezone as tz, (now() at time zone s.timezone)::date as today
  from public.settings s where s.id = 1;

with t as (
  insert into public.slot_templates (weekday, start_time)
  select extract(isodow from today + 1)::smallint - 1, '09:00' from gym
  returning id
) insert into fx select 't', id from t;

create temp table times (key text primary key, ts timestamptz not null) on commit drop;
insert into times
  select 'tomorrow', ((today + 1) + time '09:00') at time zone tz from gym
  union all
  select 'next_week', ((today + 8) + time '09:00') at time zone tz from gym;

-- Appointments the customer and trainer cancel, and one the charge job charges.
create temp table appts (key text primary key, id uuid not null) on commit drop;
with ins as (
  insert into public.appointments (customer_id, starts_at, ends_at, status, source)
  select (select id from fx where key = 'cust_a'), v.starts_at, v.starts_at + interval '1 hour', 'booked', 'trainer'
  from (values (now() + interval '3 days'), (now() + interval '1 hour'), (now() + interval '4 days'),
               (now() - interval '10 minutes')) v(starts_at)
  returning id, starts_at
)
insert into appts
  select case when starts_at = now() + interval '3 days' then 'free'
              when starts_at = now() + interval '1 hour' then 'late'
              when starts_at = now() + interval '4 days' then 'by_trainer'
              else 'due' end, id
  from ins;

delete from vault.secrets where name in ('amrap_functions_url', 'amrap_push_secret');
select vault.create_secret('http://event-test.invalid/functions/v1', 'amrap_functions_url');
select vault.create_secret('test-push-secret', 'amrap_push_secret');

grant select on fx, gym, times to authenticated, service_role;
grant select, insert on appts to authenticated, service_role;

create temp view mine as
  select n.* from public.notifications n
  where n.customer_id in (select id from fx)
     or n.appointment_id in (select a.id from public.appointments a where a.customer_id in (select id from fx));

-- Definitions, grants, triggers ------------------------------------------------------------

select set_eq(
  $$select p.proname::text, p.prosecdef, array_to_string(p.proconfig, ',')
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('enqueue_notification', 'notify_booking_created', 'notify_booking_cancelled',
                        'notify_credit_change', 'save_push_subscription')$$,
  $$select f, true as secdef, 'search_path=""' as config from unnest(array['enqueue_notification', 'notify_booking_created',
    'notify_booking_cancelled', 'notify_credit_change', 'save_push_subscription']) f$$,
  'the event functions are security definer with an empty search_path');
select is_empty(
  $$select r, f from unnest(array['anon', 'authenticated', 'service_role']) r,
                     unnest(array['public.enqueue_notification(uuid, public.notification_kind, jsonb, uuid, uuid)',
                                  'public.notify_booking_created()', 'public.notify_booking_cancelled()',
                                  'public.notify_credit_change()']) f
    where has_function_privilege(r, f, 'EXECUTE')$$,
  'enqueue_notification and the trigger functions are executable by nobody but their owner');
select results_eq(
  $$select r, has_function_privilege(r, 'public.save_push_subscription(text, text, text)', 'EXECUTE')
    from unnest(array['anon', 'authenticated', 'service_role']) r order by r$$,
  $$values ('anon', false), ('authenticated', true), ('service_role', true)$$,
  'save_push_subscription is granted to authenticated and service_role, not anon');
select set_eq(
  $$select tgrelid::regclass::text, tgname::text from pg_trigger
    where not tgisinternal and tgrelid in ('public.appointments'::regclass, 'public.credit_transactions'::regclass)$$,
  $$values ('appointments', 'appointments_notify_booking_created'),
           ('appointments', 'appointments_notify_booking_cancelled'),
           ('credit_transactions', 'credit_transactions_notify_credit_change')$$,
  'the three notification triggers exist');

-- Bookings ---------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
insert into appts select 'self_booked',
  public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'tomorrow'),
              (select id from fx where key = 't'));
select tests.clear_authentication();

select set_eq(
  $$select customer_id, kind::text, data from mine where appointment_id = (select id from appts where key = 'self_booked')$$,
  $$select (select id from fx where key = 'trainer'), 'booking_created',
           jsonb_build_object('appointment_id', (select id from appts where key = 'self_booked'),
                              'customer_name', 'Event A', 'starts_at', (select ts from times where key = 'tomorrow'),
                              'timezone', (select tz from gym))$$,
  'a customer''s own booking notifies the trainer with the name, start and timezone');
select set_eq(
  $$select jsonb_array_elements_text(convert_from(body, 'utf8')::jsonb -> 'ids')::uuid
    from net.http_request_queue where url = 'http://event-test.invalid/functions/v1/send-push'$$,
  $$select id from mine where appointment_id = (select id from appts where key = 'self_booked')$$,
  'the booking queues one request with that notification');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
insert into appts select 'trainer_booked',
  public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'next_week'),
              (select id from fx where key = 't'));
select tests.clear_authentication();

select is_empty($$select 1 from mine where appointment_id = (select id from appts where key = 'trainer_booked')$$,
  'a trainer booking notifies nobody');

insert into public.recurring_rules (customer_id, slot_template_id)
  select (select id from fx where key = 'cust_b'), id from fx where key = 't';
select ok(public.materialize_recurring() > 0, 'materialization created instances');
select is_empty(
  $$select 1 from mine n join public.appointments a on a.id = n.appointment_id where a.source = 'recurring'$$,
  'materialized instances notify nobody');

-- Cancels ----------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select public.cancel((select id from appts where key = 'free'));
select public.cancel((select id from appts where key = 'late'));
select tests.clear_authentication();

select set_eq(
  $$select a.key, n.customer_id, n.kind::text, n.data from mine n join appts a on a.id = n.appointment_id
    where a.key in ('free', 'late')$$,
  $$select a.key, (select id from fx where key = 'trainer'), 'booking_cancelled',
           jsonb_build_object('appointment_id', a.id, 'customer_name', 'Event A', 'starts_at', ap.starts_at,
                              'late', a.key = 'late', 'timezone', (select tz from gym))
    from appts a join public.appointments ap on ap.id = a.id where a.key in ('free', 'late')$$,
  'a customer cancel notifies the trainer, late only after the cutoff');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select public.cancel((select id from appts where key = 'by_trainer'));
select tests.clear_authentication();

select is_empty($$select 1 from mine where appointment_id = (select id from appts where key = 'by_trainer')$$,
  'a trainer cancel notifies nobody');

select tests.authenticate_as_service_role();
select public.charge_due_appointments();
select tests.clear_authentication();

select is((select status::text from public.appointments where id = (select id from appts where key = 'due')),
  'charged', 'the due appointment was charged');
select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select public.cancel((select id from appts where key = 'due'));
select tests.clear_authentication();

select is_empty(
  $$select 1 from mine n
    where n.appointment_id = (select id from appts where key = 'due')
       or n.transaction_id in (select id from public.credit_transactions
                               where appointment_id = (select id from appts where key = 'due'))$$,
  'the charge, the trainer cancel and its refund notify nobody');

-- Credits ----------------------------------------------------------------------------------

create temp table balance_before as
  select coalesce(sum(amount), 0)::int as balance from public.credit_transactions
  where customer_id = (select id from fx where key = 'cust_a');
grant select on balance_before to authenticated;

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
insert into appts select 'topup_a', public.top_up((select id from fx where key = 'cust_a'), 5, 'Paket');
insert into appts select 'adjust_a', public.adjust((select id from fx where key = 'cust_a'), -2, 'Popravek');
insert into appts select 'topup_b', public.top_up((select id from fx where key = 'cust_b'), 5);
insert into appts select 'topup_c', public.top_up((select id from fx where key = 'cust_c'), 5);
select tests.clear_authentication();

select set_eq(
  $$select n.kind::text, n.customer_id, n.appointment_id, n.data from mine n join appts a on a.id = n.transaction_id
    where a.key in ('topup_a', 'adjust_a')$$,
  $$select 'credit_topup', (select id from fx where key = 'cust_a'), null::uuid,
           jsonb_build_object('transaction_id', (select id from appts where key = 'topup_a'), 'amount', 5,
                              'note', 'Paket', 'balance', (select balance from balance_before) + 5)
    union all
    select 'credit_adjustment', (select id from fx where key = 'cust_a'), null::uuid,
           jsonb_build_object('transaction_id', (select id from appts where key = 'adjust_a'), 'amount', -2,
                              'note', 'Popravek', 'balance', (select balance from balance_before) + 5 - 2)$$,
  'a top-up and an adjustment notify the customer with the amount, note and balance after it');
select is(
  ((select data ->> 'balance' from mine where transaction_id = (select id from appts where key = 'adjust_a'))::int),
  (select balance::int from public.customer_balances where customer_id = (select id from fx where key = 'cust_a')),
  'the adjustment, the latest ledger row, carries the current balance');
select is_empty($$select 1 from mine where transaction_id in (select id from appts where key in ('topup_b', 'topup_c'))$$,
  'a customer without a device or without an account gets no notification');

-- No config, best effort -------------------------------------------------------------------

delete from vault.secrets where name = 'amrap_push_secret';
select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select lives_ok($$insert into appts select 'topup_unconfigured', public.top_up((select id from fx where key = 'cust_a'), 1)$$,
  'without push config a top-up still succeeds');
select tests.clear_authentication();
select is_empty($$select 1 from mine where transaction_id = (select id from appts where key = 'topup_unconfigured')$$,
  'without push config nothing is recorded');
select vault.create_secret('test-push-secret', 'amrap_push_secret');

create or replace function public.enqueue_notification(p_customer_id uuid, p_kind public.notification_kind,
  p_data jsonb, p_appointment_id uuid default null, p_transaction_id uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$ begin raise exception 'enqueue failed on purpose'; end; $$;

set local client_min_messages = error;
select tests.authenticate_as((select id from fx where key = 'user_a'));
select lives_ok(
  $$insert into appts select 'booked_while_failing',
    public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'next_week') + interval '7 days',
                (select id from fx where key = 't'))$$,
  'a booking succeeds when its notification fails');
select lives_ok($$select public.cancel((select id from appts where key = 'booked_while_failing'))$$,
  'a cancel succeeds when its notification fails');
select tests.clear_authentication();
select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select lives_ok($$select public.top_up((select id from fx where key = 'cust_a'), 1)$$,
  'a top-up succeeds when its notification fails');
select tests.clear_authentication();
reset client_min_messages;

-- save_push_subscription -------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_b'));
select public.save_push_subscription('https://push.test.invalid/shared', 'p256dh-b', 'auth-b');
select tests.clear_authentication();
select results_eq(
  $$select user_id, p256dh, auth from public.push_subscriptions where endpoint = 'https://push.test.invalid/shared'$$,
  $$select id, 'p256dh-b', 'auth-b' from fx where key = 'user_b'$$,
  'a linked customer saves a subscription for themselves');

select tests.authenticate_as((select id from fx where key = 'user_a'));
select public.save_push_subscription('https://push.test.invalid/shared', 'p256dh-a', 'auth-a');
select tests.clear_authentication();
select results_eq(
  $$select user_id, p256dh, auth from public.push_subscriptions where endpoint = 'https://push.test.invalid/shared'$$,
  $$select id, 'p256dh-a', 'auth-a' from fx where key = 'user_a'$$,
  'saving the same endpoint from another account moves the device to that account');

select tests.authenticate_as((select id from fx where key = 'user_nobody'));
select throws_matching($$select public.save_push_subscription('https://push.test.invalid/nobody', 'k', 'a')$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot save a subscription');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.save_push_subscription('', 'k', 'a')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'an empty endpoint is rejected');
select throws_matching($$select public.save_push_subscription('https://push.test.invalid/x', null, 'a')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'missing keys are rejected');
select tests.clear_authentication();

set local role anon;
select throws_ok($$select public.save_push_subscription('https://push.test.invalid/anon', 'k', 'a')$$,
  '42501', null, 'anon cannot save a subscription');
reset role;

select * from finish();
rollback;
