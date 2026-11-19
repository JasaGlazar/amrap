-- Booking setting and cutoff: the cutoff is 8 hours, and settings.customer_booking_enabled
-- (default false) turns customer book() on or off. The trainer and materialize_recurring()
-- book whatever the setting says. A missing settings row fails closed.
--
-- Times are derived from now() in settings.timezone and the slot template is created from
-- them, so weekday and start_time always match.
begin;

select plan(14);

-- Defaults (checked before any fixture changes settings) -----------------------------------

select is((select late_cancel_hours from public.settings where id = 1), 8,
  'the settings row has a cutoff of 8 hours');
select col_default_is('public', 'settings', 'late_cancel_hours', 8,
  'the cutoff column defaults to 8 hours');
select is((select customer_booking_enabled from public.settings where id = 1), false,
  'customer booking is off in the settings row');
select col_default_is('public', 'settings', 'customer_booking_enabled', false,
  'customer_booking_enabled defaults to false');
select col_not_null('public', 'settings', 'customer_booking_enabled',
  'customer_booking_enabled is not null');

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('switch-trainer@test.local')),
  ('user_a', tests.create_user('switch-a@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Switch trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Switch A', id from fx where key = 'user_a'
  returning id
) insert into fx select 'cust_a', id from c;
with c as (
  insert into public.customers (name) values ('Switch B (no account)') returning id
) insert into fx select 'cust_b', id from c;

create temp table times (key text primary key, ts timestamptz not null) on commit drop;
with base as (
  select s.timezone as tz,
         date_trunc('day', now() at time zone s.timezone) + interval '8 days' + time '10:00' as local
  from public.settings s where s.id = 1
)
insert into times
  select v.key, v.local at time zone base.tz
  from base,
       lateral (values
         ('slot', base.local),
         ('slot_next_week', base.local + interval '7 days'),
         ('slot_later', base.local + interval '14 days')
       ) v(key, local);

with t as (
  insert into public.slot_templates (weekday, start_time, capacity)
  select extract(isodow from t.ts at time zone s.timezone)::smallint - 1,
         (t.ts at time zone s.timezone)::time, 3
  from times t, public.settings s where t.key = 'slot' and s.id = 1
  returning id
) insert into fx select 'slot', id from t;

with r as (
  insert into public.recurring_rules (customer_id, slot_template_id)
  select (select id from fx where key = 'cust_b'), (select id from fx where key = 'slot')
  returning id
) insert into fx select 'rule_b', id from r;

create temp table booked (key text primary key, id uuid not null) on commit drop;

grant select on fx, times to authenticated, service_role;
grant select, insert on booked to authenticated, service_role;

-- Setting false ----------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_BOOKING_DISABLED:', 'a customer cannot book while customer booking is off');
select is_empty(
  $$update public.settings set customer_booking_enabled = true returning id$$,
  'a customer cannot turn customer booking on');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
insert into booked
  select 'trainer', public.book((select id from fx where key = 'cust_a'),
                                (select ts from times where key = 'slot'), (select id from fx where key = 'slot'));
select tests.clear_authentication();
select ok(
  exists (select 1 from public.appointments a
          where a.id = (select id from booked where key = 'trainer')
            and a.customer_id = (select id from fx where key = 'cust_a') and a.source = 'trainer'),
  'the trainer books for a customer while customer booking is off');

select tests.authenticate_as_service_role();
select cmp_ok(public.materialize_recurring(), '>', 0,
  'materialize_recurring inserts instances while customer booking is off');
select tests.clear_authentication();
select ok(
  exists (select 1 from public.appointments a
          where a.rule_id = (select id from fx where key = 'rule_b')
            and a.starts_at = (select ts from times where key = 'slot') and a.status = 'booked'),
  'the active rule has its instance at the slot occurrence');

-- Setting true -----------------------------------------------------------------------------

update public.settings set customer_booking_enabled = true where id = 1;

select tests.authenticate_as((select id from fx where key = 'user_a'));
insert into booked
  select 'customer', public.book((select id from fx where key = 'cust_a'),
                                 (select ts from times where key = 'slot_next_week'),
                                 (select id from fx where key = 'slot'));
select tests.clear_authentication();
select ok(
  exists (select 1 from public.appointments a
          where a.id = (select id from booked where key = 'customer')
            and a.customer_id = (select id from fx where key = 'cust_a') and a.source = 'self_booked'),
  'a customer books while customer booking is on');

-- Without the settings row: fail closed ----------------------------------------------------

delete from public.settings where id = 1;
select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot_later'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_SETTINGS_MISSING:', 'customer book fails closed when the settings row is missing');
-- Without a template only the booking setting read raises this; otherwise the call gets AMRAP_INVALID_ARGUMENT.
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot_later'),
                       null, (select ts + interval '1 hour' from times where key = 'slot_later'))$$,
  '^AMRAP_SETTINGS_MISSING:', 'customer book without a template fails closed when the settings row is missing');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot_later'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_SETTINGS_MISSING:', 'trainer book with a template fails closed when the settings row is missing');
select tests.clear_authentication();

select * from finish();
rollback;
