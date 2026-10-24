-- cancel_occurrence(): the trainer cancels one occurrence of a slot template with every live
-- booking in it (booked and charged → cancelled_by_trainer with the reason, charged ones
-- refunded) and closes it with a blocked period, so book() and materialization skip it. It
-- holds book()'s advisory lock, rejects customers, invalid occurrences and an occurrence that is
-- already closed, allows past and empty occurrences, and each customer is notified once. A
-- live booking of another template that overlaps the closed period is left booked (ADR 0016).
--
-- Occurrence times are local wall-clock times in settings.timezone (the run crosses the
-- 25 Oct 2026 DST change); expected counts and balances come from the fixtures.
begin;

select plan(39);

-- Fixtures ---------------------------------------------------------------------------------

-- Blocked periods in a dev database would close fixture occurrences; this is rolled back.
delete from public.blocked_periods;

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('occurrence-trainer@test.local')),
  ('user_a', tests.create_user('occurrence-a@test.local')),
  ('user_b', tests.create_user('occurrence-b@test.local')),
  ('user_d', tests.create_user('occurrence-d@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Occurrence trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Occurrence ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b', 'user_d')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;
with c as (
  insert into public.customers (name) values ('Occurrence C (no account)') returning id
) insert into fx select 'cust_c', id from c;

-- A and B have a device, so their notifications are recorded.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test.invalid/occurrence-' || key, 'p256dh', 'auth'
  from fx where key in ('user_a', 'user_b');
delete from vault.secrets where name in ('amrap_functions_url', 'amrap_push_secret');
select vault.create_secret('http://occurrence-test.invalid/functions/v1', 'amrap_functions_url');
select vault.create_secret('test-push-secret', 'amrap_push_secret');

create temp table gym as
  select s.timezone as tz, (now() at time zone s.timezone)::date as today
  from public.settings s where s.id = 1;

with t as (
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity)
  select extract(isodow from today + 3)::smallint - 1, '09:00', 75, 5 from gym
  returning id
) insert into fx select 't', id from t;
with t as (
  insert into public.slot_templates (weekday, start_time, active)
  select extract(isodow from today + 3)::smallint - 1, '11:00', false from gym
  returning id
) insert into fx select 't_inactive', id from t;
-- Overlaps the first occurrence ([09:00, 10:15)) from 09:30.
with t as (
  insert into public.slot_templates (weekday, start_time)
  select extract(isodow from today + 3)::smallint - 1, '09:30' from gym
  returning id
) insert into fx select 't_overlap', id from t;

create temp table times (key text primary key, ts timestamptz not null) on commit drop;
insert into times
  select v.key, (g.today + v.days + v.at) at time zone g.tz
  from gym g,
       (values ('occ', 3, time '09:00'), ('past', -4, time '09:00'), ('next', 10, time '09:00'),
               ('empty', 17, time '09:00'), ('wrong_day', 4, time '09:00'),
               ('wrong_time', 3, time '09:30'), ('inactive', 3, time '11:00'), ('overlap', 3, time '09:30'),
               ('later', 38, time '09:00')) v(key, days, at);

-- The occurrence: A booked, B charged, C booked (no account), D already cancelled. Next week's
-- occurrence (A booked) and an ad-hoc appointment at the same start (D) must stay untouched.
create temp table appts (key text primary key, id uuid) on commit drop;
create temp table appt_spec (key text, customer text, at_key text, template text,
                             status public.appointment_status) on commit drop;
insert into appt_spec values
  ('occ_a', 'cust_a', 'occ', 't', 'booked'),
  ('occ_b', 'cust_b', 'occ', 't', 'charged'),
  ('occ_c', 'cust_c', 'occ', 't', 'booked'),
  ('occ_d', 'cust_d', 'occ', 't', 'cancelled'),
  ('next_a', 'cust_a', 'next', 't', 'booked'),
  ('adhoc_d', 'cust_d', 'occ', null, 'booked'),
  ('past_a', 'cust_a', 'past', 't', 'charged'),
  ('overlap_a', 'cust_a', 'overlap', 't_overlap', 'booked');

with ins as (
  insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, status, source)
  select c.id, tpl.id, tm.ts, tm.ts + interval '75 minutes', s.status, 'trainer'
  from appt_spec s
  join fx c on c.key = s.customer
  join times tm on tm.key = s.at_key
  left join fx tpl on tpl.key = s.template
  returning id, customer_id, starts_at, slot_template_id
)
insert into appts
  select s.key, ins.id from ins
  join fx c on c.id = ins.customer_id
  join times tm on tm.ts = ins.starts_at
  join appt_spec s on s.customer = c.key and s.at_key = tm.key
   and (s.template is null) = (ins.slot_template_id is null);

insert into public.credit_transactions (customer_id, amount, type, appointment_id)
  select a.customer_id, -1, 'session', a.id from public.appointments a
  where a.id in (select id from appts where key in ('occ_b', 'past_a'));

create temp table live_before as
  select a.id, a.customer_id, a.status from public.appointments a
  where a.slot_template_id = (select id from fx where key = 't')
    and a.starts_at = (select ts from times where key = 'occ') and a.status in ('booked', 'charged');
create temp table balances_before as
  select c.id as customer_id, coalesce(sum(t.amount), 0)::int as balance
  from public.customers c left join public.credit_transactions t on t.customer_id = c.id
  where c.id in (select id from fx where key like 'cust_%') group by c.id;
create temp table untouched_before as
  select a.id, a.status, a.cancel_reason from public.appointments a
  where a.id in (select id from appts where key in ('occ_d', 'next_a', 'adhoc_d'));
create temp table results (key text primary key, n int) on commit drop;

grant select on fx, times, gym to authenticated, service_role;
grant select, insert on results to authenticated;

-- Definition and grants --------------------------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel_occurrence'),
  'true:search_path=""',
  'cancel_occurrence is security definer with an empty search_path');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'cancel_occurrence'),
  'p_template_id uuid, p_starts_at timestamp with time zone, p_reason text DEFAULT NULL::text',
  'cancel_occurrence takes the template, the start and an optional reason');
select ok(has_function_privilege('authenticated', 'public.cancel_occurrence(uuid, timestamptz, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.cancel_occurrence(uuid, timestamptz, text)', 'EXECUTE'),
  'authenticated can execute cancel_occurrence, anon cannot');

-- Rejections -------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching(
  $$select public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'occ'))$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot cancel an occurrence');
select tests.clear_authentication();

set local role anon;
select throws_ok(
  $$select public.cancel_occurrence('00000000-0000-0000-0000-000000000000', now())$$,
  '42501', null, 'anon cannot execute cancel_occurrence');
reset role;

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching($$select public.cancel_occurrence(gen_random_uuid(), (select ts from times where key = 'occ'))$$,
  '^AMRAP_NOT_FOUND:', 'an unknown template is rejected');
select throws_matching(
  $$select public.cancel_occurrence((select id from fx where key = 't_inactive'), (select ts from times where key = 'inactive'))$$,
  '^AMRAP_SLOT_INACTIVE:', 'an occurrence of an inactive template is rejected');
select throws_matching(
  $$select public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'wrong_day'))$$,
  '^AMRAP_SLOT_MISMATCH:', 'a start on another weekday is not an occurrence');
select throws_matching(
  $$select public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'wrong_time'))$$,
  '^AMRAP_SLOT_MISMATCH:', 'a start at another time is not an occurrence');
select throws_matching($$select public.cancel_occurrence(null, now())$$,
  '^AMRAP_INVALID_ARGUMENT:', 'the template and the start are required');
select throws_matching(
  $$select public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'occ'),
                                    repeat('x', 201))$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a reason over 200 characters is rejected');
select tests.clear_authentication();

select is_empty(
  $$select 1 from public.appointments a join live_before l on l.id = a.id where a.status <> l.status$$,
  'the rejected calls cancelled nothing');
select is_empty($$select 1 from public.blocked_periods$$, 'the rejected calls closed nothing');

-- Cancelling the occurrence ----------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
insert into results select 'occ',
  public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'occ'),
                           '  Bolezen trenerja  ');
select tests.clear_authentication();

select is((select n from results where key = 'occ'), (select count(*)::int from live_before),
  'it returns the number of live appointments it cancelled');
select is_empty(
  $$select 1 from public.appointments a join live_before l on l.id = a.id
    where a.status <> 'cancelled_by_trainer' or a.cancelled_at is distinct from now()
       or a.cancel_reason is distinct from 'Bolezen trenerja'$$,
  'every live appointment is cancelled_by_trainer now, with the trimmed reason');
select set_eq(
  $$select a.id, a.status, a.cancel_reason from public.appointments a
    where a.id in (select id from untouched_before)$$,
  $$select id, status, cancel_reason from untouched_before$$,
  'an already cancelled booking, another occurrence and an ad-hoc appointment at that start are untouched');
select set_eq(
  $$select t.appointment_id, t.customer_id, t.amount, t.created_by from public.credit_transactions t
    where t.type = 'refund' and t.appointment_id in (select id from live_before)$$,
  $$select l.id, l.customer_id, 1, (select f.id from fx f where f.key = 'trainer_user') as created_by from live_before l
    where l.status = 'charged'$$,
  'each charged appointment gets one refund of +1 by the trainer, booked ones none');
select set_eq(
  $$select b.customer_id, b.balance::int from public.customer_balances b
    where b.customer_id in (select customer_id from balances_before)$$,
  $$select bb.customer_id, bb.balance + (select count(*)::int from live_before l
                                         where l.customer_id = bb.customer_id and l.status = 'charged') as balance
    from balances_before bb$$,
  'balances change only by the refunds');
select results_eq(
  $$select starts_at, ends_at, reason from public.blocked_periods$$,
  $$select ts, ts + interval '75 minutes', 'Bolezen trenerja' from times where key = 'occ'$$,
  'the occurrence is closed by a blocked period of its duration, with the reason');
select ok(exists (
    select 1 from pg_locks l, times t,
         lateral (select hashtext((select id from fx where key = 't')::text || '@'
                                  || extract(epoch from t.ts)::text)::bigint as k) h
    where t.key = 'occ' and l.locktype = 'advisory' and l.pid = pg_backend_pid()
      and l.objsubid = 1
      and l.classid::text::bigint = (h.k >> 32) & 4294967295
      and l.objid::text::bigint = h.k & 4294967295),
  'cancel_occurrence holds book()''s advisory lock for the occurrence');
-- pgTAP has one session, so the race is pinned by the order inside the functions: a booking or
-- run that waited on the lock checks blocked periods only after cancel_occurrence committed.
select is_empty(
  $$select p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('book', 'materialize_rule', 'cancel_occurrence')
      and not strpos(p.prosrc, 'pg_advisory_xact_lock') between 1 and strpos(p.prosrc, 'public.blocked_periods')$$,
  'book(), materialize_rule() and cancel_occurrence() take the lock before they check blocked periods');
select set_eq(
  $$select n.customer_id, n.kind::text, n.data -> 'refunded' as refunded, n.data ->> 'reason' as reason
    from public.notifications n where n.appointment_id in (select id from live_before)$$,
  $$select l.customer_id, 'appointment_cancelled_by_trainer' as kind, to_jsonb(l.status = 'charged') as refunded,
           'Bolezen trenerja' as reason
    from live_before l where l.customer_id in (select id from fx where key in ('cust_a', 'cust_b'))$$,
  'each customer with a device is notified once, with refunded for the charged one and the reason');

-- Another template overlapping the closed period ------------------------------------------

select results_eq(
  $$select status::text, cancel_reason from public.appointments where id = (select id from appts where key = 'overlap_a')$$,
  $$values ('booked', null::text)$$,
  'a live booking of an overlapping template stays booked, without a reason');
select is_empty(
  $$select 1 from public.credit_transactions where appointment_id = (select id from appts where key = 'overlap_a')
    union all
    select 1 from public.notifications where appointment_id = (select id from appts where key = 'overlap_a')$$,
  'the overlapping booking gets no refund and no notification');
select tests.authenticate_as((select id from fx where key = 'user_d'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_d'), (select ts from times where key = 'overlap'),
                       (select id from fx where key = 't_overlap'))$$,
  '^AMRAP_BLOCKED:', 'the overlapping template''s occurrence is closed for new bookings too');
select tests.clear_authentication();

-- Closed afterwards ------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_d'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_d'), (select ts from times where key = 'occ'),
                       (select id from fx where key = 't'))$$,
  '^AMRAP_BLOCKED:', 'book() rejects the closed occurrence');
select tests.clear_authentication();

create temp table blocked_before as select count(*)::int as n from public.blocked_periods;
select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching(
  $$select public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'occ'))$$,
  '^AMRAP_BLOCKED:', 'a second cancel of the closed occurrence is rejected');
select tests.clear_authentication();
select is((select count(*)::int from public.blocked_periods), (select n from blocked_before),
  'the second call added no blocked period');

-- Past and empty occurrences ---------------------------------------------------------------

create temp table past_balance as
  select balance::int from public.customer_balances where customer_id = (select id from fx where key = 'cust_a');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
insert into results select 'past',
  public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'past'));
insert into results select 'empty',
  public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'empty'), E' \t ');
select tests.clear_authentication();

select is((select n from results where key = 'past'),
  (select count(*)::int from appt_spec where at_key = 'past' and status in ('booked', 'charged')),
  'a past occurrence with a charged booking can be cancelled');
select results_eq(
  $$select status::text, cancel_reason from public.appointments where id = (select id from appts where key = 'past_a')$$,
  $$values ('cancelled_by_trainer', null::text)$$, 'the past charged booking is cancelled without a reason');
select is(
  (select balance::int from public.customer_balances where customer_id = (select id from fx where key = 'cust_a')),
  (select balance + 1 from past_balance), 'the past charged booking is refunded');
select is((select n from results where key = 'empty'), 0, 'an empty occurrence can be closed, cancelling nothing');
select results_eq(
  $$select ends_at - starts_at, reason from public.blocked_periods
    where starts_at in (select ts from times where key in ('past', 'empty')) order by starts_at$$,
  $$values (interval '75 minutes', null::text), (interval '75 minutes', null::text)$$,
  'both are closed for the template''s duration, a blank reason stored as none');

-- Materialization skips a closed occurrence ------------------------------------------------

with r as (
  insert into public.recurring_rules (customer_id, slot_template_id)
  select (select id from fx where key = 'cust_d'), id from fx where key = 't'
  returning id
) insert into fx select 'rule_d', id from r;
select ok(public.materialize_recurring() >= 0, 'materialization ran');
select is_empty(
  $$select 1 from public.appointments a
    where a.rule_id = (select id from fx where key = 'rule_d')
      and a.starts_at in (select ts from times where key in ('occ', 'empty'))$$,
  'materialization creates no instance in a closed occurrence');
select ok(exists (select 1 from public.appointments a
                  where a.rule_id = (select id from fx where key = 'rule_d')
                    and a.starts_at = (select ts from times where key = 'next')),
  'materialization still fills an open occurrence of the same template');

-- A failing notification never fails the cancel --------------------------------------------

create or replace function public.enqueue_notification(p_customer_id uuid, p_kind public.notification_kind,
  p_data jsonb, p_appointment_id uuid default null, p_transaction_id uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$ begin raise exception 'enqueue failed on purpose'; end; $$;

set local client_min_messages = error;
select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select lives_ok(
  $$insert into results select 'failing',
    public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'next'))$$,
  'cancel_occurrence succeeds when the notifications fail');
select tests.clear_authentication();
reset client_min_messages;
select is((select status::text from public.appointments where id = (select id from appts where key = 'next_a')),
  'cancelled_by_trainer', 'and its cancels took effect');

-- Without the settings row the weekday and time cannot be checked: fail closed -------------

delete from public.settings where id = 1;
select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching(
  $$select public.cancel_occurrence((select id from fx where key = 't'), (select ts from times where key = 'later'))$$,
  '^AMRAP_SETTINGS_MISSING:', 'cancel_occurrence fails closed when the settings row is missing');
select tests.clear_authentication();

select * from finish();
rollback;
