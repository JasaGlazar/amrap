-- materialize_recurring(): every active rule of an active template becomes booked
-- appointments (source recurring) for each occurrence from today through today + 4 weeks in
-- settings.timezone. Past starts, existing instances of the rule (any status), blocked
-- overlaps, customers already booked at that start and full slots are skipped. A second run
-- inserts nothing. Callable by cron / service role (no auth.uid()) and the trainer only.
--
-- Fixture times are built from today's local date in settings.timezone and the templates are
-- created from them, so weekdays always match. Expected rows are derived from the generated
-- dates, never hardcoded.
begin;

select plan(28);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('mat-trainer@test.local')),
  ('user_a', tests.create_user('mat-a@test.local')),
  ('user_nobody', tests.create_user('mat-nobody@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Mat trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Mat A', id from fx where key = 'user_a'
  returning id
) insert into fx select 'cust_a', id from c;
with c as (
  insert into public.customers (name)
  select 'Mat ' || k from unnest(array['b', 'c', 'd', 'e']) k
  returning id, name
) insert into fx select 'cust_' || right(name, 1), id from c;

-- The gym's timezone and today's local date.
create temp table gym as
  select s.timezone as tz, (now() at time zone s.timezone)::date as today
  from public.settings s where s.id = 1;

-- Templates on the weekdays of today + n, so each has occurrences at n, n + 7, n + 14 ...
create temp table tpl_spec (key text primary key, day_offset int, start_time time,
                            duration_minutes int, capacity int, active boolean) on commit drop;
insert into tpl_spec values
  ('t_main', 1, '10:00', 50, 5, true),        -- occurrences +1, +8, +15, +22
  ('t_small', 2, '11:00', 60, 1, true),       -- capacity 1; +2, +9, +16, +23
  ('t_midnight', 0, '00:00', 60, 5, true),    -- today 00:00 is past; +7 ... +28 (window end)
  ('t_inactive', 3, '12:00', 60, 5, false);

with t as (
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity, active)
  select extract(isodow from g.today + s.day_offset)::smallint - 1, s.start_time,
         s.duration_minutes, s.capacity, s.active
  from tpl_spec s, gym g
  order by s.key
  returning id, weekday, start_time
)
insert into fx
  select s.key, t.id from t
  join tpl_spec s on s.start_time = t.start_time;

-- Occurrence instants: '<template>+<days from today>'.
create temp table times (key text primary key, ts timestamptz not null) on commit drop;
insert into times
  select s.key || '+' || n, ((g.today + n) + s.start_time) at time zone g.tz
  from tpl_spec s, gym g, generate_series(0, 28) n
  where (n - s.day_offset) % 7 = 0 and n >= s.day_offset;

-- Rules. r_inactive_rule is inactive; r_inactive_tpl is active on an inactive template.
create temp table rule_spec (key text primary key, customer text, template text, active boolean)
  on commit drop;
insert into rule_spec values
  ('r_main', 'cust_a', 't_main', true),
  ('r_full', 'cust_b', 't_small', true),
  ('r_busy', 'cust_d', 't_main', true),
  ('r_midnight', 'cust_e', 't_midnight', true),
  ('r_inactive_rule', 'cust_c', 't_main', false),
  ('r_inactive_tpl', 'cust_a', 't_inactive', true);

with r as (
  insert into public.recurring_rules (customer_id, slot_template_id, active)
  select c.id, t.id, s.active
  from rule_spec s join fx c on c.key = s.customer join fx t on t.key = s.template
  returning id, customer_id, slot_template_id
)
insert into fx
  select s.key, r.id from r
  join fx c on c.id = r.customer_id join fx t on t.id = r.slot_template_id
  join rule_spec s on s.customer = c.key and s.template = t.key;

-- Skip reasons:
-- * t_main+8: a blocked period starting 30 minutes after the start (overlap, start is free);
-- * t_main+15: r_main already has a cancelled instance there (must not be recreated);
-- * t_small+2: the slot (capacity 1) is already taken by customer C;
-- * t_main+22: customer D already has a live ad-hoc appointment at that start.
insert into public.blocked_periods (starts_at, ends_at, reason)
  select ts + interval '30 minutes', ts + interval '3 hours', 'Materialize test closure'
  from times where key = 't_main+8';

insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, status, source,
                                 rule_id, cancelled_at)
  select (select id from fx where key = 'cust_a'), (select id from fx where key = 't_main'),
         ts, ts + interval '50 minutes', 'cancelled', 'recurring',
         (select id from fx where key = 'r_main'), now()
  from times where key = 't_main+15';
insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, source)
  select (select id from fx where key = 'cust_c'), (select id from fx where key = 't_small'),
         ts, ts + interval '1 hour', 'self_booked'
  from times where key = 't_small+2';
insert into public.appointments (customer_id, starts_at, ends_at, source)
  select (select id from fx where key = 'cust_d'), ts, ts + interval '1 hour', 'trainer'
  from times where key = 't_main+22';

-- Appointments that exist before the run.
create temp table before_run as select id from public.appointments;

-- What the run should insert, derived over every active rule of an active template in the
-- database (not only the fixtures): each occurrence date in the window, minus past starts,
-- existing instances of the rule, blocked overlaps, customers already live at that start and
-- slots already full before the run.
create temp table expected as
  with occ as (
    select r.id as rule_id, r.customer_id, t.id as template_id, t.capacity, t.start_time, g.tz,
           ((g.today + n) + t.start_time) at time zone g.tz as starts_at,
           ((g.today + n) + t.start_time) at time zone g.tz
             + t.duration_minutes * interval '1 minute' as ends_at
    from public.recurring_rules r
    join public.slot_templates t on t.id = r.slot_template_id,
         gym g, generate_series(0, 28) n
    where r.active and t.active and extract(isodow from g.today + n) - 1 = t.weekday
  )
  select o.rule_id, o.customer_id, o.template_id, o.starts_at, o.ends_at from occ o
  where o.starts_at > now()
    -- a start_time inside a spring-forward gap does not exist that day
    and (o.starts_at at time zone o.tz)::time = o.start_time
    and not exists (select 1 from public.appointments a
                    where a.rule_id = o.rule_id and a.starts_at = o.starts_at)
    and not exists (select 1 from public.blocked_periods b
                    where tstzrange(o.starts_at, o.ends_at) && tstzrange(b.starts_at, b.ends_at))
    and not exists (select 1 from public.appointments a
                    where a.customer_id = o.customer_id and a.starts_at = o.starts_at
                      and a.status in ('booked', 'charged'))
    and (select count(*) from public.appointments a
         where a.slot_template_id = o.template_id and a.starts_at = o.starts_at
           and a.status in ('booked', 'charged')) < o.capacity;

create temp table runs (run text primary key, inserted int not null) on commit drop;
grant select, insert on runs to authenticated, service_role;
grant select on fx, times to authenticated, service_role;

-- Instances of one fixture rule with the given status, as times keys.
create function pg_temp.instances(p_rule text, p_status text default 'booked')
returns setof text language sql as $$
  select t.key from public.appointments a join times t on t.ts = a.starts_at
  where a.rule_id = (select id from fx where key = p_rule) and a.status::text = p_status
    and t.key like (select template from rule_spec where key = p_rule) || '+%'
$$;

-- Function definitions and grants ----------------------------------------------------------

select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','),
                     ' ' order by p.proname)
   from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('materialize_recurring', 'materialize_rule')),
  'materialize_recurring:true:search_path="" materialize_rule:true:search_path=""',
  'materialize_recurring and materialize_rule are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.materialize_recurring(int)', 'EXECUTE'),
  'authenticated can execute materialize_recurring (the role check inside admits only the trainer)');
select ok(has_function_privilege('service_role', 'public.materialize_recurring(int)', 'EXECUTE'),
  'service_role can execute materialize_recurring');
select ok(not has_function_privilege('anon', 'public.materialize_recurring(int)', 'EXECUTE'),
  'anon has no execute privilege on materialize_recurring');
select ok(
  not has_function_privilege('authenticated', 'public.materialize_rule(uuid, int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.materialize_rule(uuid, int)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.materialize_rule(uuid, int)', 'EXECUTE'),
  'the materialize_rule helper is executable by nobody but its owner');

-- Callers that may not run it --------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.materialize_recurring()$$,
  '^AMRAP_FORBIDDEN:', 'a linked customer cannot run materialize_recurring');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_nobody'));
select throws_matching($$select public.materialize_recurring()$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot run materialize_recurring');
select tests.clear_authentication();

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.materialize_recurring()$$, '42501', null,
  'anon cannot execute materialize_recurring');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching($$select public.materialize_recurring(-1)$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a negative number of weeks is rejected');
select tests.clear_authentication();

select is((select count(*) from public.appointments where id not in (select id from before_run)),
  0::bigint, 'the rejected calls inserted nothing');

-- First run, as the service role (no auth.uid(), like cron) -------------------------------

select tests.authenticate_as_service_role();
insert into runs select 'first', public.materialize_recurring();
select tests.clear_authentication();

create temp table created as
  select * from public.appointments where id not in (select id from before_run);

select is((select inserted from runs where run = 'first'), (select count(*)::int from expected),
  'the first run returns the number of occurrences derived from the generated dates');
select set_eq(
  $$select rule_id, customer_id, slot_template_id, starts_at, ends_at from created$$,
  $$select rule_id, customer_id, template_id, starts_at, ends_at from expected$$,
  'exactly the expected instances are inserted, with the rule''s customer, template and duration');
select is_empty(
  $$select 1 from created where status <> 'booked' or source <> 'recurring'$$,
  'every inserted instance is booked with source recurring');

select set_eq($$select pg_temp.instances('r_main')$$,
  $$values ('t_main+1'), ('t_main+22')$$,
  'r_main is materialized except at the blocked and the cancelled occurrence');
select is_empty(
  $$select 1 from created where starts_at = (select ts from times where key = 't_main+8')$$,
  'an occurrence that starts before a blocked period but runs into it is skipped');
select set_eq($$select pg_temp.instances('r_main', 'cancelled')$$, $$values ('t_main+15')$$,
  'the cancelled instance of r_main is not recreated (it stays the only row at that start)');
select set_eq($$select pg_temp.instances('r_full')$$,
  $$values ('t_small+9'), ('t_small+16'), ('t_small+23')$$,
  'r_full is skipped at the occurrence that is already full');
select set_eq($$select pg_temp.instances('r_busy')$$,
  $$values ('t_main+1'), ('t_main+15')$$,
  'r_busy is skipped where its customer already has a live appointment, and at the blocked one');
select set_eq($$select pg_temp.instances('r_midnight')$$,
  $$select key from times where key like 't_midnight+%' and ts > now()$$,
  'a rule gets one instance per future occurrence date through today + 4 weeks (past today skipped)');
select is_empty(
  $$select 1 from created where rule_id in (select id from fx where key in ('r_inactive_rule', 'r_inactive_tpl'))$$,
  'an inactive rule and a rule of an inactive template are not materialized');

-- The capacity check takes the same advisory lock as book(): template || '@' || epoch.
select ok(exists (
    select 1 from pg_locks l, times t,
         lateral (select hashtext((select id from fx where key = 't_main')::text || '@'
                                  || extract(epoch from t.ts)::text)::bigint as k) h
    where t.key = 't_main+1' and l.locktype = 'advisory' and l.pid = pg_backend_pid()
      and l.objsubid = 1
      and l.classid::text::bigint = (h.k >> 32) & 4294967295
      and l.objid::text::bigint = h.k & 4294967295),
  'materialization holds book()''s advisory lock for the slot occurrence');

-- DST: every instance keeps the template's wall-clock time in the gym's timezone, also when
-- the window crosses a DST change (2026-10-25 for a run in late October 2026).
select is_empty(
  $$select 1 from created a join public.slot_templates t on t.id = a.slot_template_id, gym g
    where (a.starts_at at time zone g.tz)::time <> t.start_time
       or extract(isodow from a.starts_at at time zone g.tz) - 1 <> t.weekday$$,
  'every instance starts on the template''s weekday at its start_time in settings.timezone');
select case
  when (select count(distinct (a.starts_at at time zone g.tz) - (a.starts_at at time zone 'UTC'))
        from created a, gym g where a.rule_id = (select id from fx where key = 'r_main')) > 1
  then ok((select count(distinct (a.starts_at at time zone g.tz)::time)
           from created a, gym g where a.rule_id = (select id from fx where key = 'r_main')) = 1,
          'instances of a rule on both sides of a DST change keep the same wall-clock time')
  else skip('the materialization window does not cross a DST change today', 1)
end;

-- Second run: idempotent -------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into runs select 'second', public.materialize_recurring();
select tests.clear_authentication();

select is((select inserted from runs where run = 'second'), 0, 'running it again inserts nothing');
select is((select count(*) from public.appointments where id not in (select id from before_run)),
  (select count(*) from created), 'the second run left the appointments unchanged');

-- Trainer path: a new rule is materialized right away -------------------------------------

insert into public.recurring_rules (customer_id, slot_template_id)
  values ((select id from fx where key = 'cust_c'), (select id from fx where key = 't_midnight'));

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
insert into runs select 'trainer', public.materialize_recurring();
select tests.clear_authentication();

select is((select inserted from runs where run = 'trainer'),
  (select count(*)::int from times where key like 't_midnight+%' and ts > now()),
  'the trainer can run it; only the new rule''s occurrences are inserted');
select is(
  (select count(*) from public.appointments a
   where a.customer_id = (select id from fx where key = 'cust_c') and a.source = 'recurring'),
  (select count(*) from times where key like 't_midnight+%' and ts > now()),
  'the new rule''s instances belong to its customer');

-- Without the settings row the timezone is unknown: fail closed ----------------------------

delete from public.settings where id = 1;
select throws_matching($$select public.materialize_recurring()$$,
  '^AMRAP_SETTINGS_MISSING:', 'materialize_recurring fails closed when the settings row is missing');

select * from finish();
rollback;
