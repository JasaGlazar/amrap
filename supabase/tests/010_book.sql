-- book(): customers book their own future slot occurrences; the trainer books anyone, any
-- time, from a template or ad hoc. Capacity, blocked periods and the one-live-booking rule
-- hold for both.
--
-- All times are derived from now() (frozen for the transaction) in settings.timezone, and the
-- slot template is created from them, so weekday/start_time always match. Shifts are done on
-- local time so a DST change between the dates cannot move the wall-clock time.
begin;

select plan(34);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('book-trainer@test.local')),
  ('user_a', tests.create_user('book-a@test.local')),
  ('user_b', tests.create_user('book-b@test.local')),
  ('user_c', tests.create_user('book-c@test.local')),
  ('user_nobody', tests.create_user('book-nobody@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Book trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Book ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b', 'user_c')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;
with c as (
  insert into public.customers (name) values ('Book D (no account)') returning id
) insert into fx select 'cust_d', id from c;

-- Local wall-clock times, converted to timestamptz in the gym's timezone.
create temp table times (key text primary key, ts timestamptz not null) on commit drop;
with base as (
  select s.timezone as tz,
         date_trunc('day', now() at time zone s.timezone) + interval '8 days' + time '10:00' as local
  from public.settings s where s.id = 1
)
insert into times
  select v.key, (v.local) at time zone base.tz
  from base,
       lateral (values
         ('slot', base.local),
         ('slot_next_week', base.local + interval '7 days'),
         ('slot_past', base.local - interval '14 days'),
         ('wrong_day', base.local + interval '1 day'),
         ('wrong_time', base.local + interval '30 minutes'),
         ('adhoc', base.local + interval '2 days' + interval '3 hours')
       ) v(key, local);

-- A slot template matching 'slot' with a custom duration and capacity, and an inactive twin.
with t as (
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity)
  select extract(isodow from t.ts at time zone s.timezone)::smallint - 1,
         (t.ts at time zone s.timezone)::time, 45, 2
  from times t, public.settings s where t.key = 'slot' and s.id = 1
  returning id
) insert into fx select 'slot', id from t;
with t as (
  insert into public.slot_templates (weekday, start_time, active)
  select weekday, start_time, false from public.slot_templates
  where id = (select id from fx where key = 'slot')
  returning id
) insert into fx select 'slot_inactive', id from t;

-- A blocked period around next week's occurrence.
insert into public.blocked_periods (starts_at, ends_at, reason)
  select ts - interval '1 hour', ts + interval '2 hours', 'Book test closure'
  from times where key = 'slot_next_week';

create temp table slot as
  select id, capacity, duration_minutes from public.slot_templates
  where id = (select id from fx where key = 'slot');

-- Ids returned by book(), for later assertions.
create temp table booked (key text primary key, id uuid not null) on commit drop;

grant select on fx, times, slot to authenticated, service_role;
grant select, insert on booked to authenticated, service_role;

-- Live (booked or charged) appointments in the slot, as seen without RLS.
create function pg_temp.live_in_slot() returns bigint language sql as $$
  select count(*) from public.appointments
  where slot_template_id = (select id from slot)
    and starts_at = (select ts from times where key = 'slot')
    and status in ('booked', 'charged')
$$;

-- Function definition ----------------------------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'book'),
  'true:search_path=""',
  'book is security definer with an empty search_path');
select ok(has_function_privilege('authenticated',
            'public.book(uuid, timestamptz, uuid, timestamptz)', 'EXECUTE'),
  'authenticated can execute book');
select ok(not has_function_privilege('anon',
            'public.book(uuid, timestamptz, uuid, timestamptz)', 'EXECUTE'),
  'anon cannot execute book');

-- Customer A -------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));

insert into booked
  select 'a', public.book((select id from fx where key = 'cust_a'),
                          (select ts from times where key = 'slot'),
                          (select id from fx where key = 'slot'));

select results_eq(
  $$select customer_id, slot_template_id, starts_at, ends_at, status::text, source::text, rule_id
    from public.appointments where id = (select id from booked where key = 'a')$$,
  $$select (select id from fx where key = 'cust_a'), (select id from slot),
           (select ts from times where key = 'slot'),
           (select ts from times where key = 'slot') + (select duration_minutes from slot) * interval '1 minute',
           'booked', 'self_booked', null::uuid$$,
  'a customer books their own slot: booked, self_booked, ends after the template''s custom duration');

select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_ALREADY_BOOKED:', 'a second live booking of the same slot is rejected');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_b'), (select ts from times where key = 'slot'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot book for another customer');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'adhoc'))$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a customer must name a slot template');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'adhoc'),
                       null, (select ts from times where key = 'adhoc') + interval '1 hour')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a customer cannot book an ad-hoc time');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot_next_week'),
                       (select id from fx where key = 'slot'),
                       (select ts from times where key = 'slot_next_week') + interval '3 hours')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'p_ends_at is rejected together with a slot template');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot'),
                       (select id from fx where key = 'slot_inactive'))$$,
  '^AMRAP_SLOT_INACTIVE:', 'an inactive slot template cannot be booked');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot'),
                       gen_random_uuid())$$,
  '^AMRAP_NOT_FOUND:', 'an unknown slot template is rejected');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot_past'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_IN_PAST:', 'a customer cannot book a past occurrence of the slot');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'wrong_day'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_SLOT_MISMATCH:', 'a start on another weekday than the template is rejected');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'wrong_time'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_SLOT_MISMATCH:', 'a start at another time than the template is rejected');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_a'), (select ts from times where key = 'slot_next_week'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_BLOCKED:', 'a start inside a blocked period is rejected');

select tests.clear_authentication();

-- Capacity: fill to capacity, the next booking fails, a freed place can be booked ------------

select tests.authenticate_as((select id from fx where key = 'user_b'));
insert into booked
  select 'b', public.book((select id from fx where key = 'cust_b'), (select ts from times where key = 'slot'),
                          (select id from fx where key = 'slot'));
select tests.clear_authentication();

select is(pg_temp.live_in_slot(), (select capacity from slot)::bigint,
  'two bookings fill the slot to its custom capacity');

select tests.authenticate_as((select id from fx where key = 'user_c'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_c'), (select ts from times where key = 'slot'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_CAPACITY_FULL:', 'the booking after the slot is full is rejected');
select tests.clear_authentication();

select is(pg_temp.live_in_slot(), (select capacity from slot)::bigint,
  'the rejected booking did not overfill the slot');

-- A cancelled appointment frees its place (the cancel() RPC is tested in 011_cancel.sql).
update public.appointments set status = 'cancelled', cancelled_at = now()
  where id = (select id from booked where key = 'b');

select tests.authenticate_as((select id from fx where key = 'user_c'));
select lives_ok(
  $$insert into booked
    select 'c', public.book((select id from fx where key = 'cust_c'), (select ts from times where key = 'slot'),
                            (select id from fx where key = 'slot'))$$,
  'after a cancellation the freed place can be booked');
select tests.clear_authentication();

select is(pg_temp.live_in_slot(), (select capacity from slot)::bigint,
  'the slot is full again after the freed place is taken');

-- A charged appointment still occupies its place, also for the trainer.
update public.appointments set status = 'charged' where id = (select id from booked where key = 'a');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_d'), (select ts from times where key = 'slot'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_CAPACITY_FULL:', 'charged appointments count toward capacity, and the trainer cannot overbook');

-- Trainer ----------------------------------------------------------------------------------

insert into booked
  select 'trainer_past', public.book((select id from fx where key = 'cust_d'),
                                     (select ts from times where key = 'slot_past'),
                                     (select id from fx where key = 'slot'));

select results_eq(
  $$select customer_id, starts_at, ends_at, status::text, source::text
    from public.appointments where id = (select id from booked where key = 'trainer_past')$$,
  $$select (select id from fx where key = 'cust_d'), (select ts from times where key = 'slot_past'),
           (select ts from times where key = 'slot_past') + (select duration_minutes from slot) * interval '1 minute',
           'booked', 'trainer'$$,
  'the trainer books any customer into a past occurrence of a template; source trainer');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_d'), (select ts from times where key = 'wrong_day'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_SLOT_MISMATCH:', 'the trainer''s template bookings must still match the weekday and time');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_d'), (select ts from times where key = 'slot'),
                       (select id from fx where key = 'slot_inactive'))$$,
  '^AMRAP_SLOT_INACTIVE:', 'the trainer cannot book an inactive template');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_d'), (select ts from times where key = 'slot_next_week'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_BLOCKED:', 'the trainer cannot book a template slot inside a blocked period');

insert into booked
  select 'adhoc', public.book((select id from fx where key = 'cust_d'), (select ts from times where key = 'adhoc'),
                              null, (select ts from times where key = 'adhoc') + interval '90 minutes');

select results_eq(
  $$select customer_id, slot_template_id, starts_at, ends_at, status::text, source::text
    from public.appointments where id = (select id from booked where key = 'adhoc')$$,
  $$select (select id from fx where key = 'cust_d'), null::uuid, (select ts from times where key = 'adhoc'),
           (select ts from times where key = 'adhoc') + interval '90 minutes', 'booked', 'trainer'$$,
  'the trainer books an ad-hoc appointment with an explicit end');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_c'), (select ts from times where key = 'adhoc'))$$,
  '^AMRAP_INVALID_ARGUMENT:', 'an ad-hoc booking requires p_ends_at');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_c'), (select ts from times where key = 'adhoc'),
                       null, (select ts from times where key = 'adhoc'))$$,
  '^AMRAP_INVALID_ARGUMENT:', 'an ad-hoc booking must end after it starts');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_c'), (select ts from times where key = 'slot_next_week'),
                       null, (select ts from times where key = 'slot_next_week') + interval '1 hour')$$,
  '^AMRAP_BLOCKED:', 'an ad-hoc booking inside a blocked period is rejected');
select throws_matching(
  $$select public.book(gen_random_uuid(), (select ts from times where key = 'adhoc'),
                       null, (select ts from times where key = 'adhoc') + interval '1 hour')$$,
  '^AMRAP_NOT_FOUND:', 'the trainer cannot book for an unknown customer');
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_d'), (select ts from times where key = 'adhoc'),
                       null, (select ts from times where key = 'adhoc') + interval '1 hour')$$,
  '^AMRAP_ALREADY_BOOKED:', 'the trainer cannot double-book a customer at the same start');

select tests.clear_authentication();

-- Auth user without a customer record, and anon --------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_nobody'));
select throws_matching(
  $$select public.book((select id from fx where key = 'cust_c'), (select ts from times where key = 'slot_next_week'),
                       (select id from fx where key = 'slot'))$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot book');
select tests.clear_authentication();

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select public.book('00000000-0000-0000-0000-000000000000', now(), null, now() + interval '1 hour')$$,
  '42501', null, 'anon cannot execute book');
select tests.clear_authentication();

select is(
  (select count(*) from public.appointments where id in (select id from booked)),
  (select count(*) from booked),
  'every successful book() call left exactly one appointment row');

select * from finish();
rollback;
