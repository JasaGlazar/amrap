-- activate_rule() / deactivate_rule(): trainer only. Deactivating cancels the rule's future
-- booked instances as cancelled_by_trainer (no charge) and leaves past, charged and already
-- cancelled ones alone; activating materializes the rule at once (an instance cancelled
-- earlier is not recreated). slot_occupancy: counts of live appointments per slot occurrence
-- for linked users, without customer identities. pg_cron: both jobs are scheduled.
--
-- Fixture times are built from today's local date in settings.timezone; expectations are
-- derived from the inserted rows.
begin;

select plan(33);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('rules-trainer@test.local')),
  ('user_a', tests.create_user('rules-a@test.local')),
  ('user_b', tests.create_user('rules-b@test.local')),
  ('user_nobody', tests.create_user('rules-nobody@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Rules trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Rules ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;
with c as (
  insert into public.customers (name) values ('Rules C (no account)') returning id
) insert into fx select 'cust_c', id from c;

create temp table gym as
  select s.timezone as tz, (now() at time zone s.timezone)::date as today
  from public.settings s where s.id = 1;

-- A template on the weekday of tomorrow (occurrences at -13, -6, +1, +8, +15, +22 days) and
-- an inactive one.
with t as (
  insert into public.slot_templates (weekday, start_time)
  select extract(isodow from today + 1)::smallint - 1, '09:00' from gym
  returning id
) insert into fx select 't', id from t;
with t as (
  insert into public.slot_templates (weekday, start_time, active)
  select extract(isodow from today + 1)::smallint - 1, '13:00', false from gym
  returning id
) insert into fx select 't_inactive', id from t;

create temp table times (key text primary key, ts timestamptz not null) on commit drop;
insert into times
  select 't' || case when n < 0 then '' else '+' end || n, ((g.today + n) + time '09:00') at time zone g.tz
  from gym g, generate_series(-13, 22, 7) n;

-- r_a: customer A, active, with instances in every state. r_c: customer C, active, one
-- future instance. r_b: customer B, inactive, no instances. r_inactive_tpl: on the inactive
-- template.
with r as (
  insert into public.recurring_rules (customer_id, slot_template_id, active)
  values ((select id from fx where key = 'cust_a'), (select id from fx where key = 't'), true),
         ((select id from fx where key = 'cust_c'), (select id from fx where key = 't'), true),
         ((select id from fx where key = 'cust_b'), (select id from fx where key = 't'), false),
         ((select id from fx where key = 'cust_b'), (select id from fx where key = 't_inactive'), false)
  returning id, customer_id, slot_template_id
)
insert into fx
  select case
           when r.slot_template_id = (select id from fx where key = 't_inactive') then 'r_inactive_tpl'
           when r.customer_id = (select id from fx where key = 'cust_a') then 'r_a'
           when r.customer_id = (select id from fx where key = 'cust_c') then 'r_c'
           else 'r_b'
         end, r.id
  from r;

create temp table appt_spec (key text primary key, rule text, at text,
                             status public.appointment_status) on commit drop;
insert into appt_spec values
  ('a_past_charged', 'r_a', 't-6', 'charged'),
  ('a_past_booked', 'r_a', 't-13', 'booked'),     -- started, not yet charged
  ('a_future_1', 'r_a', 't+1', 'booked'),
  ('a_future_8', 'r_a', 't+8', 'booked'),
  ('a_future_cancelled', 'r_a', 't+15', 'cancelled'),
  ('c_future_1', 'r_c', 't+1', 'booked');

create temp table appts (key text primary key, id uuid not null) on commit drop;
with ins as (
  insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, status,
                                   source, rule_id, cancelled_at)
  select r.customer_id, r.slot_template_id, t.ts, t.ts + interval '1 hour', s.status,
         'recurring', r.id, case when s.status = 'cancelled' then now() - interval '1 day' end
  from appt_spec s
  join fx on fx.key = s.rule
  join public.recurring_rules r on r.id = fx.id
  join times t on t.key = s.at
  returning id, rule_id, starts_at
)
insert into appts
  select s.key, ins.id from ins
  join fx on fx.id = ins.rule_id
  join times t on t.ts = ins.starts_at
  join appt_spec s on s.rule = fx.key and s.at = t.key;

-- Statuses before deactivating, and what deactivate_rule(r_a) should cancel.
create temp table before_deactivate as
  select a.key, ap.status, ap.starts_at, ap.cancelled_at from appts a
  join public.appointments ap on ap.id = a.id;
create temp table expected_cancel as
  select a.id from public.appointments a
  where a.rule_id = (select id from fx where key = 'r_a') and a.status = 'booked' and a.starts_at > now();

-- Occurrences of the template in the materialization window (today through today + 28).
create temp table window_dates as
  select ((g.today + n) + time '09:00') at time zone g.tz as ts
  from gym g, generate_series(0, 28) n
  where extract(isodow from g.today + n) - 1
          = (select weekday from public.slot_templates where id = (select id from fx where key = 't'))
    and ((g.today + n) + time '09:00') at time zone g.tz > now();

create temp table results (key text primary key, n int not null) on commit drop;
grant select, insert on results to authenticated;
grant select on fx, appts to authenticated;

-- Function definitions and grants ----------------------------------------------------------

select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','),
                     ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('activate_rule', 'deactivate_rule')),
  'activate_rule:true:search_path="" deactivate_rule:true:search_path=""',
  'activate_rule and deactivate_rule are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.activate_rule(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.deactivate_rule(uuid)', 'EXECUTE'),
  'authenticated can execute activate_rule and deactivate_rule');
select ok(not has_function_privilege('anon', 'public.activate_rule(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.deactivate_rule(uuid)', 'EXECUTE'),
  'anon cannot execute activate_rule or deactivate_rule');

-- Not the trainer --------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.deactivate_rule((select id from fx where key = 'r_a'))$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot deactivate a rule, not even their own');
select throws_matching($$select public.activate_rule((select id from fx where key = 'r_b'))$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot activate a rule');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_nobody'));
select throws_matching($$select public.deactivate_rule((select id from fx where key = 'r_a'))$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot deactivate a rule');
select tests.clear_authentication();

select is(
  (select count(*) from appts a join public.appointments ap on ap.id = a.id
   join before_deactivate b on b.key = a.key where ap.status <> b.status),
  0::bigint, 'the rejected calls changed nothing');

-- deactivate_rule --------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching($$select public.deactivate_rule(gen_random_uuid())$$,
  '^AMRAP_NOT_FOUND:', 'deactivating an unknown rule is rejected');
select throws_matching($$select public.activate_rule(gen_random_uuid())$$,
  '^AMRAP_NOT_FOUND:', 'activating an unknown rule is rejected');
insert into results select 'deactivate', public.deactivate_rule((select id from fx where key = 'r_a'));
select tests.clear_authentication();

select is((select n from results where key = 'deactivate'), (select count(*)::int from expected_cancel),
  'deactivate_rule returns the number of future booked instances it cancelled');
select is_empty(
  $$select 1 from public.appointments where id in (select id from expected_cancel)
    and (status <> 'cancelled_by_trainer' or cancelled_at is distinct from now())$$,
  'the rule''s future booked instances are cancelled_by_trainer with cancelled_at = now()');
select results_eq(
  $$select a.key, ap.status::text, ap.cancelled_at from appts a join public.appointments ap on ap.id = a.id
    where a.key in ('a_past_charged', 'a_past_booked', 'a_future_cancelled', 'c_future_1') order by a.key$$,
  $$select key, status::text, cancelled_at from before_deactivate
    where key in ('a_past_charged', 'a_past_booked', 'a_future_cancelled', 'c_future_1') order by key$$,
  'charged, started, already cancelled and other rules'' instances are left alone');
select is((select active from public.recurring_rules where id = (select id from fx where key = 'r_a')),
  false, 'the rule is inactive');
select is_empty(
  $$select 1 from public.credit_transactions
    where appointment_id in (select id from appts where key like 'a\_%')$$,
  'deactivating writes no credit transaction');

-- activate_rule ----------------------------------------------------------------------------

-- Occurrences in the window where r_a has no instance yet (the others stay cancelled).
create temp table expected_reactivate as
  select w.ts from window_dates w
  where not exists (select 1 from public.appointments a
                    where a.rule_id = (select id from fx where key = 'r_a') and a.starts_at = w.ts);

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
insert into results select 'activate_b', public.activate_rule((select id from fx where key = 'r_b'));
insert into results select 'reactivate_a', public.activate_rule((select id from fx where key = 'r_a'));
insert into results select 'activate_inactive_tpl',
  public.activate_rule((select id from fx where key = 'r_inactive_tpl'));
select tests.clear_authentication();

select is((select n from results where key = 'activate_b'), (select count(*)::int from window_dates),
  'activate_rule materializes the rule at once: one instance per future occurrence in the window');
select set_eq(
  $$select starts_at from public.appointments
    where rule_id = (select id from fx where key = 'r_b') and status = 'booked' and source = 'recurring'$$,
  $$select ts from window_dates$$,
  'the activated rule''s instances are its future occurrences');
select is((select active from public.recurring_rules where id = (select id from fx where key = 'r_b')),
  true, 'the rule is active');
select is((select n from results where key = 'reactivate_a'), (select count(*)::int from expected_reactivate),
  'reactivating only fills occurrences without an instance: cancelled ones are not recreated');
select is(
  (select count(*) from public.appointments where id in (select id from expected_cancel)
     and status = 'cancelled_by_trainer'),
  (select count(*) from expected_cancel),
  'the instances cancelled by deactivate_rule stay cancelled after reactivating');
select results_eq(
  $$select n, (select active from public.recurring_rules where id = (select id from fx where key = 'r_inactive_tpl'))
    from results where key = 'activate_inactive_tpl'$$,
  $$values (0, true)$$,
  'a rule of an inactive template is activated but materializes nothing');

select throws_ok(
  $$insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, status, source, rule_id)
    select customer_id, slot_template_id, starts_at, ends_at, 'cancelled', source, rule_id
    from public.appointments where id = (select id from appts where key = 'a_past_charged')$$,
  '23505', null, 'a second instance of a rule at the same start is refused, whatever its status');

-- slot_occupancy ---------------------------------------------------------------------------

-- Live appointments per slot occurrence, as seen without RLS.
create temp table expected_occupancy as
  select slot_template_id, starts_at, count(*) as booked_count from public.appointments
  where slot_template_id is not null and status in ('booked', 'charged')
  group by slot_template_id, starts_at;
grant select on expected_occupancy, times to authenticated;

select columns_are('public', 'slot_occupancy', array['slot_template_id', 'starts_at', 'booked_count'],
  'slot_occupancy exposes only the slot, the start and the count');
select is(
  (select coalesce(c.reloptions, '{}') from pg_class c where c.oid = 'public.slot_occupancy'::regclass),
  '{}'::text[], 'slot_occupancy is not security_invoker: it runs as its owner and sees every row');
select ok(has_table_privilege('authenticated', 'public.slot_occupancy', 'SELECT')
          and not has_table_privilege('authenticated', 'public.slot_occupancy', 'INSERT')
          and not has_table_privilege('authenticated', 'public.slot_occupancy', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.slot_occupancy', 'DELETE'),
  'authenticated can only select from slot_occupancy');
select ok(not has_table_privilege('anon', 'public.slot_occupancy', 'SELECT'),
  'anon has no privilege on slot_occupancy');

select tests.authenticate_as((select id from fx where key = 'user_a'));
select set_eq($$select slot_template_id, starts_at, booked_count from public.slot_occupancy$$,
  $$select slot_template_id, starts_at, booked_count from expected_occupancy$$,
  'a customer sees the live count of every slot occurrence');
select ok(
  (select booked_count from public.slot_occupancy
   where slot_template_id = (select id from fx where key = 't')
     and starts_at = (select ts from times where key = 't+1')) > 0
  and not exists (select 1 from public.appointments
                  where slot_template_id = (select id from fx where key = 't')
                    and starts_at = (select ts from times where key = 't+1')
                    and status in ('booked', 'charged')),
  'the count includes other customers'' bookings the customer cannot read');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select set_eq($$select slot_template_id, starts_at, booked_count from public.slot_occupancy$$,
  $$select slot_template_id, starts_at, booked_count from expected_occupancy$$,
  'the trainer sees the same counts');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_nobody'));
select is_empty($$select 1 from public.slot_occupancy$$,
  'an auth user without a customer record sees nothing');
select tests.clear_authentication();

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select 1 from public.slot_occupancy$$, '42501', null,
  'anon cannot read slot_occupancy');
select tests.clear_authentication();

-- pg_cron ----------------------------------------------------------------------------------

select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');
select results_eq(
  $$select jobname::text, schedule::text, command::text, active from cron.job
    where jobname in ('charge_due_appointments', 'materialize_recurring') order by jobname$$,
  $$values ('charge_due_appointments', '*/15 * * * *', 'select public.charge_due_appointments()', true),
           ('materialize_recurring', '0 2 * * *', 'select public.materialize_recurring()', true)$$,
  'both jobs are scheduled: the charge every 15 minutes, materialization nightly');
-- pg_cron runs the command as the scheduling role (postgres) without a JWT.
select lives_ok($$select public.materialize_recurring()$$,
  'materialize_recurring runs without a signed-in user, as the cron job does');

select * from finish();
rollback;
