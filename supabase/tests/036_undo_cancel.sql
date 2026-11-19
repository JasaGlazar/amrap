-- undo_cancel(): a customer restores their own free cancel (status cancelled) to booked while
-- now() is strictly before the cutoff. The same row returns to booked, no ledger row is written,
-- and the charge job charges it as usual. The occurrence must still take it: rule active, no
-- blocked period, template active, a free place (under book()'s advisory lock) and no other live
-- booking of the customer at that start.
--
-- Appointments are inserted directly as the test superuser with their final status (an update
-- from booked would fire the cancel notification), with starts derived from now() (frozen for
-- the transaction) and the configured cutoff. undo_cancel does not check the weekday or start
-- time, so starts need not match the templates.
begin;

select plan(33);

-- Fixtures ---------------------------------------------------------------------------------

-- Blocked periods in a dev database would block fixture appointments; this is rolled back.
delete from public.blocked_periods;

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('undo-trainer@test.local')),
  ('user_a', tests.create_user('undo-a@test.local')),
  ('user_b', tests.create_user('undo-b@test.local')),
  ('user_nobody', tests.create_user('undo-nobody@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Undo trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Undo ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;

with t as (
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity, active)
  values (0, '10:00', 60, 1, true) returning id
) insert into fx select 'tpl_1', id from t;
with t as (
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity, active)
  values (1, '10:00', 60, 5, true) returning id
) insert into fx select 'tpl_5', id from t;
with t as (
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity, active)
  values (2, '10:00', 60, 5, false) returning id
) insert into fx select 'tpl_off', id from t;
with r as (
  insert into public.recurring_rules (customer_id, slot_template_id, active)
  select (select id from fx where key = 'cust_a'), (select id from fx where key = 'tpl_5'), false
  returning id
) insert into fx select 'rule', id from r;

create temp table cutoff as
  select late_cancel_hours * interval '1 hour' as cutoff from public.settings where id = 1;

-- Appointments: (key, customer, template, start relative to now(), status, rule).
create temp table appts (key text primary key, id uuid) on commit drop;
create temp table appt_spec (key text primary key, customer text, template text, starts_at timestamptz,
                             status public.appointment_status, rule text) on commit drop;
insert into appt_spec
  select v.key, v.customer, v.template, v.starts_at, v.status, v.rule
  from cutoff,
       lateral (values
         ('ok', 'cust_a', 'tpl_5', now() + interval '2 days', 'cancelled'::public.appointment_status, null),
         ('charge', 'cust_a', 'tpl_5', now() + interval '3 days', 'cancelled', null),
         ('a_other', 'cust_a', 'tpl_5', now() + interval '4 days', 'cancelled', null),
         ('st_booked', 'cust_a', 'tpl_5', now() + interval '5 days', 'booked', null),
         ('st_charged', 'cust_a', 'tpl_5', now() - interval '1 hour', 'charged', null),
         ('st_late', 'cust_a', 'tpl_5', now() + interval '6 days', 'cancelled_late', null),
         ('st_trainer', 'cust_a', 'tpl_5', now() + interval '7 days', 'cancelled_by_trainer', null),
         ('at_cutoff', 'cust_a', 'tpl_5', now() + cutoff.cutoff, 'cancelled', null),
         ('after_cutoff', 'cust_a', 'tpl_5', now() + cutoff.cutoff + interval '1 second', 'cancelled', null),
         ('blocked', 'cust_a', 'tpl_5', now() + interval '8 days', 'cancelled', null),
         ('full', 'cust_a', 'tpl_1', now() + interval '9 days', 'cancelled', null),
         ('full_b', 'cust_b', 'tpl_1', now() + interval '9 days', 'booked', null),
         ('inactive', 'cust_a', 'tpl_off', now() + interval '10 days', 'cancelled', null),
         ('dup', 'cust_a', 'tpl_5', now() + interval '11 days', 'cancelled', null),
         ('dup_live', 'cust_a', null, now() + interval '11 days', 'booked', null),
         ('rule', 'cust_a', 'tpl_5', now() + interval '12 days', 'cancelled', 'rule'),
         ('adhoc', 'cust_a', null, now() + interval '13 days', 'cancelled', null),
         ('settings', 'cust_a', 'tpl_5', now() + interval '14 days', 'cancelled', null),
         ('trainer_own', 'trainer', null, now() + interval '15 days', 'cancelled', null)
       ) v(key, customer, template, starts_at, status, rule);

with ins as (
  insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, status, source,
                                   rule_id, cancelled_at)
  select c.id, t.id, s.starts_at, s.starts_at + interval '1 hour', s.status,
         case when s.rule is null then 'self_booked' else 'recurring' end::public.appointment_source,
         r.id, case when s.status::text like 'cancelled%' then now() - interval '1 day' end
  from appt_spec s
  join fx c on c.key = s.customer
  left join fx t on t.key = s.template
  left join fx r on r.key = s.rule
  returning id, customer_id, slot_template_id, starts_at
)
insert into appts
  select s.key, ins.id from ins
  join fx c on c.id = ins.customer_id
  left join fx t on t.id = ins.slot_template_id
  join appt_spec s on s.customer = c.key and s.template is not distinct from t.key
                  and s.starts_at = ins.starts_at;

grant select on fx, cutoff, appts, appt_spec to authenticated, service_role;

create function pg_temp.appt(p_key text) returns public.appointments language sql as $$
  select * from public.appointments where id = (select id from appts where key = p_key)
$$;
create function pg_temp.appt_tx_count(p_key text) returns int language sql as $$
  select count(*)::int from public.credit_transactions t
  where t.appointment_id = (select id from appts where key = p_key)
$$;
create temp table tx_before as select pg_temp.appt_tx_count('ok') as n;

-- Function definition ----------------------------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'undo_cancel'),
  'true:search_path=""',
  'undo_cancel is security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.undo_cancel(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.undo_cancel(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.undo_cancel(uuid)', 'EXECUTE'),
  'authenticated and service_role can execute undo_cancel, anon cannot');
-- pgTAP has one session, so the race with cancel_occurrence() is pinned by the order inside
-- the function: an undo that waited on the lock checks blocked periods after it committed.
select ok(
  (select strpos(p.prosrc, 'pg_advisory_xact_lock') between 1 and strpos(p.prosrc, 'public.blocked_periods')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'undo_cancel'),
  'undo_cancel takes the lock before it checks blocked periods');
-- The same holds for the race with deactivate_rule(): the rule row is read under a share lock.
select ok(
  (select p.prosrc ~ 'from public\.recurring_rules r where r\.id = v_appt\.rule_id for share;'
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'undo_cancel'),
  'undo_cancel reads the recurring rule for share');

-- Customer A: a free cancel before the cutoff is restored ---------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select lives_ok($$select public.undo_cancel((select id from appts where key = 'ok'))$$,
  'a customer undoes their own free cancel before the cutoff');
select ok(exists (
    select 1 from pg_locks l, appts a,
         lateral (select hashtext((select id from fx where key = 'tpl_5')::text || '@'
                                  || extract(epoch from (select starts_at from appt_spec where key = 'ok'))::text)::bigint as k) h
    where a.key = 'ok' and l.locktype = 'advisory' and l.pid = pg_backend_pid()
      and l.objsubid = 1
      and l.classid::text::bigint = (h.k >> 32) & 4294967295
      and l.objid::text::bigint = h.k & 4294967295),
  'undo_cancel holds book()''s advisory lock for the occurrence');
select tests.clear_authentication();

select results_eq($$select status::text, cancelled_at from pg_temp.appt('ok')$$,
  $$values ('booked', null::timestamptz)$$,
  'the undone appointment is booked again, with cancelled_at cleared');
select is(pg_temp.appt_tx_count('ok'), (select n from tx_before),
  'the undo wrote no credit transaction for the appointment');

-- The charge job charges a restored appointment once ---------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select lives_ok($$select public.undo_cancel((select id from appts where key = 'charge'))$$,
  'a customer undoes a second free cancel');
select tests.clear_authentication();
update public.appointments set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour'
  where id = (select id from appts where key = 'charge');
select public.charge_due_appointments();
select results_eq(
  $$select a.status::text, (select count(*)::int from public.credit_transactions t
                            where t.appointment_id = a.id and t.type = 'session')
    from pg_temp.appt('charge') a$$,
  $$values ('charged', 1)$$,
  'the charge job charges the restored appointment with exactly one session row');

-- Who may call -----------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_b'));
select throws_matching($$select public.undo_cancel((select id from appts where key = 'a_other'))$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot undo another customer''s cancel');
select tests.clear_authentication();

-- The trainer's own row, so the role check is what refuses, not ownership.
select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching($$select public.undo_cancel((select id from appts where key = 'trainer_own'))$$,
  '^AMRAP_FORBIDDEN:', 'the trainer cannot undo a cancel, even of an appointment on their own customer record');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_nobody'));
select throws_matching($$select public.undo_cancel((select id from appts where key = 'a_other'))$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot undo a cancel');
select tests.clear_authentication();

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.undo_cancel('00000000-0000-0000-0000-000000000000')$$,
  '42501', null, 'anon cannot execute undo_cancel');
select tests.clear_authentication();

select is((select status::text from pg_temp.appt('a_other')), 'cancelled',
  'the refused calls left the appointment cancelled');

-- Arguments, statuses and the cutoff -------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.undo_cancel(gen_random_uuid())$$,
  '^AMRAP_NOT_FOUND:', 'undoing an unknown appointment is rejected');
select throws_matching($$select public.undo_cancel(null)$$,
  '^AMRAP_INVALID_ARGUMENT:', 'undoing with a null id is rejected');
select throws_matching($$select public.undo_cancel((select id from appts where key = 'st_booked'))$$,
  '^AMRAP_NOT_UNDOABLE:', 'a booked appointment cannot be undone');
select throws_matching($$select public.undo_cancel((select id from appts where key = 'st_charged'))$$,
  '^AMRAP_NOT_UNDOABLE:', 'a charged appointment cannot be undone');
select throws_matching($$select public.undo_cancel((select id from appts where key = 'st_late'))$$,
  '^AMRAP_NOT_UNDOABLE:', 'a cancelled_late appointment cannot be undone');
select throws_matching($$select public.undo_cancel((select id from appts where key = 'st_trainer'))$$,
  '^AMRAP_NOT_UNDOABLE:', 'a cancelled_by_trainer appointment cannot be undone');
select throws_matching($$select public.undo_cancel((select id from appts where key = 'at_cutoff'))$$,
  '^AMRAP_NOT_UNDOABLE:', 'a cancel cannot be undone exactly at the cutoff');
select lives_ok($$select public.undo_cancel((select id from appts where key = 'after_cutoff'))$$,
  'a cancel can be undone one second before the cutoff');
select tests.clear_authentication();

-- The occurrence must still take the booking -----------------------------------------------

insert into public.blocked_periods (starts_at, ends_at, reason)
  select starts_at + interval '30 minutes', starts_at + interval '2 hours', 'Undo test'
  from appt_spec where key = 'blocked';
select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.undo_cancel((select id from appts where key = 'blocked'))$$,
  '^AMRAP_BLOCKED:', 'a cancel cannot be undone into a blocked period');
select tests.clear_authentication();
delete from public.blocked_periods;

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.undo_cancel((select id from appts where key = 'full'))$$,
  '^AMRAP_CAPACITY_FULL:', 'a cancel cannot be undone when the slot is full');
select tests.clear_authentication();
select is(
  (select count(*)::int from public.appointments a, appt_spec s
   where s.key = 'full' and a.slot_template_id = (select id from fx where key = 'tpl_1')
     and a.starts_at = s.starts_at and a.status in ('booked', 'charged')),
  (select capacity from public.slot_templates where id = (select id from fx where key = 'tpl_1')),
  'the full slot still holds exactly its capacity');

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.undo_cancel((select id from appts where key = 'inactive'))$$,
  '^AMRAP_SLOT_INACTIVE:', 'a cancel cannot be undone on a deactivated slot template');
select throws_matching($$select public.undo_cancel((select id from appts where key = 'dup'))$$,
  '^AMRAP_ALREADY_BOOKED:', 'a cancel cannot be undone when the customer has another live booking at that start');
select throws_matching($$select public.undo_cancel((select id from appts where key = 'rule'))$$,
  '^AMRAP_NOT_UNDOABLE:', 'a cancelled instance of an inactive recurring rule cannot be undone');
select tests.clear_authentication();

update public.recurring_rules set active = true where id = (select id from fx where key = 'rule');
select tests.authenticate_as((select id from fx where key = 'user_a'));
select lives_ok($$select public.undo_cancel((select id from appts where key = 'rule'))$$,
  'a cancelled instance of an active recurring rule can be undone');
select lives_ok($$select public.undo_cancel((select id from appts where key = 'adhoc'))$$,
  'an ad-hoc appointment can be undone without a capacity check');
select tests.clear_authentication();

select results_eq(
  $$select key, a.status::text from appts, lateral pg_temp.appt(key) a
    where key in ('after_cutoff', 'rule', 'adhoc', 'at_cutoff', 'blocked', 'full', 'inactive', 'dup')
    order by key$$,
  $$values ('adhoc', 'booked'), ('after_cutoff', 'booked'), ('at_cutoff', 'cancelled'),
           ('blocked', 'cancelled'), ('dup', 'cancelled'), ('full', 'cancelled'),
           ('inactive', 'cancelled'), ('rule', 'booked')$$,
  'successful undos are booked and refused ones stay cancelled');

-- Missing settings (last: the row is deleted) ----------------------------------------------

delete from public.settings where id = 1;
select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.undo_cancel((select id from appts where key = 'settings'))$$,
  '^AMRAP_SETTINGS_MISSING:', 'without the settings row an undo fails closed');
select tests.clear_authentication();

select * from finish();
rollback;
