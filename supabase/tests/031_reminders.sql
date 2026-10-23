-- send_cutoff_reminders(): the 15-minute job. A booked appointment whose cutoff
-- (starts_at - late_cancel_hours) is in [now() + 45 min, now() + 75 min) gets one
-- cutoff_reminder when its customer is linked and has a push subscription; the ids are posted
-- to send-push in one pg_net request. Re-runs and overlapping runs add nothing. Without push
-- config or settings it returns 0 without error; it prunes rows older than 30 days. Only the
-- owner, the service role and pg_cron run it.
--
-- Fixture starts are built from now() and the cutoff set below; expectations are derived from
-- the fixtures and the rows this transaction created (created_at = now()).
begin;

select plan(26);

-- Fixtures ---------------------------------------------------------------------------------

update public.settings set late_cancel_hours = 5 where id = 1;

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('remind-trainer@test.local')),
  ('user_a', tests.create_user('remind-a@test.local')),
  ('user_b', tests.create_user('remind-b@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Remind trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Remind ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;
with c as (
  insert into public.customers (name) values ('Remind C (no account)') returning id
) insert into fx select 'cust_c', id from c;

-- Customer A has two devices; B subscribes later; C has no account.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select (select id from fx where key = 'user_a'), 'https://push.test.invalid/remind-a' || n, 'p256dh', 'auth'
  from generate_series(1, 2) n;

-- cutoff_min: minutes from now() to the cutoff with the 5-hour cutoff.
create temp table appt_spec (key text primary key, customer text not null, cutoff_min int not null,
                             status public.appointment_status not null, selected boolean not null)
  on commit drop;
insert into appt_spec values
  ('a44', 'cust_a', 44, 'booked', false),
  ('a45', 'cust_a', 45, 'booked', true),
  ('a60', 'cust_a', 60, 'booked', true),
  ('a74', 'cust_a', 74, 'booked', true),
  ('a75', 'cust_a', 75, 'booked', false),
  ('a61_cancelled', 'cust_a', 61, 'cancelled', false),
  ('a62_late', 'cust_a', 62, 'cancelled_late', false),
  ('a63_charged', 'cust_a', 63, 'charged', false),
  ('b60', 'cust_b', 60, 'booked', false),
  ('c60', 'cust_c', 60, 'booked', false),
  ('z50_no_cutoff', 'cust_a', 50 - 5 * 60, 'booked', false);

create temp table appts (key text primary key, id uuid not null, starts_at timestamptz not null)
  on commit drop;
with ins as (
  insert into public.appointments (customer_id, starts_at, ends_at, status, source)
  select fx.id, now() + make_interval(mins => s.cutoff_min + 5 * 60),
         now() + make_interval(mins => s.cutoff_min + 6 * 60), s.status, 'self_booked'
  from appt_spec s join fx on fx.key = s.customer
  returning id, customer_id, starts_at
)
insert into appts
  select s.key, ins.id, ins.starts_at from ins
  join fx on fx.id = ins.customer_id
  join appt_spec s on s.customer = fx.key and now() + make_interval(mins => s.cutoff_min + 5 * 60) = ins.starts_at;

delete from vault.secrets where name in ('amrap_functions_url', 'amrap_push_secret');
select vault.create_secret('http://remind-test.invalid/functions/v1', 'amrap_functions_url');
select vault.create_secret('test-push-secret', 'amrap_push_secret');

create temp table runs (run int primary key, inserted int not null) on commit drop;
grant select on fx, appt_spec, appts to authenticated, service_role;
grant select, insert on runs to service_role;

create temp view mine as
  select n.* from public.notifications n where n.appointment_id in (select id from appts);

-- Function definition, grants, schedule ----------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'send_cutoff_reminders'),
  'true:search_path=""',
  'send_cutoff_reminders is security definer with an empty search_path');
select is_empty(
  $$select r from unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, 'public.send_cutoff_reminders()', 'EXECUTE')$$,
  'anon and authenticated cannot execute send_cutoff_reminders');
select ok(has_function_privilege('service_role', 'public.send_cutoff_reminders()', 'EXECUTE'),
  'service_role can execute send_cutoff_reminders');
select results_eq(
  $$select schedule::text, command::text, active from cron.job where jobname = 'send_cutoff_reminders'$$,
  $$values ('*/15 * * * *', 'select public.send_cutoff_reminders()', true)$$,
  'the reminder job runs every 15 minutes');

-- First run --------------------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into runs select 1, public.send_cutoff_reminders();
select tests.clear_authentication();

select set_eq($$select appointment_id from mine$$,
  $$select a.id from appts a join appt_spec s using (key) where s.selected$$,
  'only booked appointments of subscribed customers with the cutoff in [45, 75) minutes get a reminder');
select is((select inserted from runs where run = 1),
  (select count(*)::int from public.notifications where kind = 'cutoff_reminder' and created_at = now()),
  'the job returns the number of reminders it created');
select is(
  (select count(*) from mine), (select count(distinct appointment_id) from mine),
  'one reminder per appointment, not one per device');
select set_eq(
  $$select customer_id, kind::text, data, dispatched_at from mine$$,
  $$select (select id from fx where key = 'cust_a'), 'cutoff_reminder',
           jsonb_build_object('appointment_id', a.id, 'starts_at', a.starts_at,
                              'cutoff_at', a.starts_at - interval '5 hours', 'timezone',
                              (select timezone from public.settings where id = 1)),
           null::timestamptz
    from appts a join appt_spec s using (key) where s.selected$$,
  'each reminder targets the customer with the appointment, start, cutoff and timezone, undispatched');
select results_eq(
  $$select url, headers ->> 'x-amrap-push-secret' from net.http_request_queue
    where url like 'http://remind-test.invalid/%'$$,
  $$values ('http://remind-test.invalid/functions/v1/send-push', 'test-push-secret')$$,
  'the run queues one request to send-push');
select set_eq(
  $$select jsonb_array_elements_text(convert_from(body, 'utf8')::jsonb -> 'ids')::uuid
    from net.http_request_queue where url like 'http://remind-test.invalid/%'$$,
  $$select id from public.notifications where kind = 'cutoff_reminder' and created_at = now()$$,
  'the request carries exactly the ids created by the run');

-- Second run and an overlapping run --------------------------------------------------------

select tests.authenticate_as_service_role();
insert into runs select 2, public.send_cutoff_reminders();
select tests.clear_authentication();

select is((select inserted from runs where run = 2), 0, 'a second run creates nothing');
select is((select count(*) from mine), (select count(*) from appt_spec where selected),
  'after two runs there is still one reminder per selected appointment');
select is((select count(*) from net.http_request_queue where url like 'http://remind-test.invalid/%'), 1::bigint,
  'a run that creates nothing queues no request');

-- An overlapping run already recorded this appointment's reminder.
with a as (
  insert into public.appointments (customer_id, starts_at, ends_at, source)
  select id, now() + interval '5 hours 50 minutes', now() + interval '6 hours 50 minutes', 'self_booked'
  from fx where key = 'cust_a'
  returning id, starts_at
) insert into appts select 'a50_overlap', id, starts_at from a;
insert into public.notifications (customer_id, kind, appointment_id)
  select (select id from fx where key = 'cust_a'), 'cutoff_reminder', id from appts where key = 'a50_overlap';

select tests.authenticate_as_service_role();
insert into runs select 3, public.send_cutoff_reminders();
select tests.clear_authentication();

select is((select inserted from runs where run = 3), 0,
  'an appointment already reminded by an overlapping run is not reminded again');
select is((select count(*) from mine where appointment_id = (select id from appts where key = 'a50_overlap')),
  1::bigint, 'the overlapping run left exactly one row');

-- A customer who subscribes inside the window -----------------------------------------------

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test.invalid/remind-b', 'p256dh', 'auth' from fx where key = 'user_b';

select tests.authenticate_as_service_role();
insert into runs select 4, public.send_cutoff_reminders();
select tests.clear_authentication();

select is((select inserted from runs where run = 4),
  (select count(*)::int from appt_spec
   where customer = 'cust_b' and status = 'booked' and cutoff_min between 45 and 74),
  'a customer who subscribes later still gets the reminder');
select ok(exists (select 1 from mine where appointment_id = (select id from appts where key = 'b60')),
  'the late subscriber''s appointment is reminded');

-- Cutoff 0 hours ---------------------------------------------------------------------------

update public.settings set late_cancel_hours = 0 where id = 1;
create temp table before_5 as select id from public.notifications;

select tests.authenticate_as_service_role();
insert into runs select 5, public.send_cutoff_reminders();
select tests.clear_authentication();

select set_eq(
  $$select appointment_id from public.notifications where id not in (select id from before_5)$$,
  $$select a.id from public.appointments a
    join public.customers c on c.id = a.customer_id
    where a.status = 'booked'
      and a.starts_at >= now() + interval '45 minutes' and a.starts_at < now() + interval '75 minutes'
      and exists (select 1 from public.push_subscriptions s where s.user_id = c.auth_user_id)
      and not exists (select 1 from public.notifications n
                      where n.id in (select id from before_5) and n.kind = 'cutoff_reminder'
                        and n.appointment_id = a.id)$$,
  'with a 0-hour cutoff the run reminds exactly the subscribed booked starts 45 to 75 minutes away');
select is((select inserted from runs where run = 5),
  (select count(*)::int from public.notifications where id not in (select id from before_5)),
  'the 0-hour run returns the number it inserted');

select results_eq(
  $$select appointment_id, data ->> 'cutoff_at' = data ->> 'starts_at' from mine
    where created_at = now() and appointment_id = (select id from appts where key = 'z50_no_cutoff')$$,
  $$select id, true from appts where key = 'z50_no_cutoff'$$,
  'with a 0-hour cutoff the window is measured from the start itself');

-- Pruning, missing config, missing settings ------------------------------------------------

with n as (
  insert into public.notifications (customer_id, kind, created_at)
  select id, 'credit_topup', now() - make_interval(days => d) from fx, unnest(array[31, 29]) d
  where key = 'cust_a'
  returning id, created_at
) insert into fx select 'old_' || extract(day from now() - created_at)::int, id from n;

delete from vault.secrets where name = 'amrap_push_secret';
update public.settings set late_cancel_hours = 5 where id = 1;
with a as (
  insert into public.appointments (customer_id, starts_at, ends_at, source)
  select id, now() + interval '5 hours 55 minutes', now() + interval '6 hours 55 minutes', 'self_booked'
  from fx where key = 'cust_a'
  returning id, starts_at
) insert into appts select 'a55_unconfigured', id, starts_at from a;

create temp table queued_before_6 as
  select count(*) as n from net.http_request_queue where url like 'http://remind-test.invalid/%';

select tests.authenticate_as_service_role();
insert into runs select 6, public.send_cutoff_reminders();
select tests.clear_authentication();

select is((select inserted from runs where run = 6), 0, 'without push config the job returns 0');
select is_empty($$select 1 from mine where appointment_id = (select id from appts where key = 'a55_unconfigured')$$,
  'without push config no reminder is recorded, so it can still be sent once configured');
select is((select count(*) from net.http_request_queue where url like 'http://remind-test.invalid/%'),
  (select n from queued_before_6), 'without push config no request is queued');
select results_eq(
  $$select key from fx where key like 'old_%' and id in (select id from public.notifications) order by key$$,
  $$values ('old_29')$$,
  'rows older than 30 days are pruned, younger ones kept');

select vault.create_secret('test-push-secret', 'amrap_push_secret');
delete from public.settings where id = 1;

select tests.authenticate_as_service_role();
select lives_ok($$select public.send_cutoff_reminders()$$, 'without settings the job does not raise');
insert into runs select 7, public.send_cutoff_reminders();
select tests.clear_authentication();

select is((select inserted from runs where run = 7), 0, 'without settings the job returns 0');

select * from finish();
rollback;
