-- Row level security and grants: what a customer, the trainer, a signed-up user without a
-- customer record, anon and the service role can read and write directly. Writes that
-- customers need (booking, cancelling) go through RPCs, so direct writes must fail here.
--
-- Expected row sets are computed from the fixture data as the test superuser (which bypasses
-- RLS) before switching roles, and compared with what each role can see.
begin;

select plan(56);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('rls-trainer@test.local')),
  ('user_a', tests.create_user('rls-a@test.local')),
  ('user_b', tests.create_user('rls-b@test.local')),
  ('user_nobody', tests.create_user('rls-nobody@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'RLS trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id) select 'RLS A', id from fx where key = 'user_a'
  returning id
) insert into fx select 'cust_a', id from c;
with c as (
  insert into public.customers (name, auth_user_id) select 'RLS B', id from fx where key = 'user_b'
  returning id
) insert into fx select 'cust_b', id from c;
with c as (
  insert into public.customers (name, invite_token, invite_expires_at)
  values ('RLS C (invited)', 'rls-test-invite-token', now() + interval '7 days')
  returning id
) insert into fx select 'cust_c', id from c;

with s as (
  insert into public.slot_templates (weekday, start_time) values (1, '18:00') returning id
) insert into fx select 'slot_active', id from s;
with s as (
  insert into public.slot_templates (weekday, start_time, active) values (2, '18:00', false)
  returning id
) insert into fx select 'slot_inactive', id from s;

insert into public.recurring_rules (customer_id, slot_template_id)
  select c.id, s.id from fx c, fx s
  where c.key in ('cust_a', 'cust_b') and s.key = 'slot_active';

insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, source, status)
  select c.id, s.id, v.starts_at, v.starts_at + interval '1 hour', 'self_booked', v.status
  from fx c, fx s,
       (values ('2030-01-08 18:00+01'::timestamptz, 'booked'::public.appointment_status),
               ('2030-01-15 18:00+01'::timestamptz, 'cancelled'::public.appointment_status)) v(starts_at, status)
  where c.key in ('cust_a', 'cust_b') and s.key = 'slot_active';

insert into public.credit_transactions (customer_id, amount, type, created_by)
  select c.id, v.amount, 'topup', t.id
  from fx c, fx t, (values (8), (4)) v(amount)
  where c.key in ('cust_a', 'cust_b') and t.key = 'trainer_user';

insert into public.blocked_periods (starts_at, ends_at, reason)
  values ('2030-12-24 00:00+01', '2030-12-27 00:00+01', 'RLS test holiday');

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test/' || key, 'p256dh-' || key, 'auth-' || key
  from fx where key in ('user_a', 'user_b');

-- What customer A owns, and how many rows exist in total, as seen without RLS.
create temp table expected (tbl text not null, id uuid not null) on commit drop;
insert into expected
  select 'customers', id from public.customers where id = (select id from fx where key = 'cust_a')
  union all
  select 'recurring_rules', id from public.recurring_rules
    where customer_id = (select id from fx where key = 'cust_a')
  union all
  select 'appointments', id from public.appointments
    where customer_id = (select id from fx where key = 'cust_a')
  union all
  select 'credit_transactions', id from public.credit_transactions
    where customer_id = (select id from fx where key = 'cust_a')
  union all
  select 'slot_templates_active', id from public.slot_templates where active
  union all
  select 'push_subscriptions', id from public.push_subscriptions
    where user_id = (select id from fx where key = 'user_a');

create temp table expected_counts as
  select 'customers' as tbl, count(*) as n from public.customers
  union all select 'slot_templates', count(*) from public.slot_templates
  union all select 'recurring_rules', count(*) from public.recurring_rules
  union all select 'appointments', count(*) from public.appointments
  union all select 'credit_transactions', count(*) from public.credit_transactions
  union all select 'blocked_periods', count(*) from public.blocked_periods
  union all select 'settings', count(*) from public.settings
  union all select 'push_subscriptions', count(*) from public.push_subscriptions
  union all select 'customer_balances', count(*) from public.customer_balances;

create temp table expected_balance as
  select sum(amount) as balance from public.credit_transactions
  where customer_id = (select id from fx where key = 'cust_a');

grant select on fx, expected, expected_counts, expected_balance to authenticated, service_role;

-- Customer A -------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));

select set_eq($$select id from public.customers$$,
  $$select id from expected where tbl = 'customers'$$,
  'a customer sees only their own customers row');
select set_eq($$select id from public.recurring_rules$$,
  $$select id from expected where tbl = 'recurring_rules'$$,
  'a customer sees only their own recurring rules');
select set_eq($$select id from public.appointments$$,
  $$select id from expected where tbl = 'appointments'$$,
  'a customer sees only their own appointments');
select set_eq($$select id from public.credit_transactions$$,
  $$select id from expected where tbl = 'credit_transactions'$$,
  'a customer sees only their own transactions');
select set_eq($$select customer_id from public.customer_balances$$,
  $$select id from expected where tbl = 'customers'$$,
  'a customer sees only their own balance row');
select is(
  (select balance from public.customer_balances
   where customer_id = (select id from fx where key = 'cust_a')),
  (select balance from expected_balance),
  'a customer''s balance is the sum of their own transactions');
select set_eq($$select id from public.slot_templates$$,
  $$select id from expected where tbl = 'slot_templates_active'$$,
  'a customer sees only active slot templates');
select is((select count(*) from public.blocked_periods),
  (select n from expected_counts where tbl = 'blocked_periods'),
  'a customer sees all blocked periods');
select is((select count(*) from public.settings),
  (select n from expected_counts where tbl = 'settings'),
  'a customer sees the settings row');
select set_eq($$select id from public.push_subscriptions$$,
  $$select id from expected where tbl = 'push_subscriptions'$$,
  'a customer sees only their own push subscriptions');

select is(public.current_customer_id(), (select id from fx where key = 'cust_a'),
  'current_customer_id() returns the caller''s customer id');
select is(public.is_trainer(), false, 'is_trainer() is false for a customer');

-- Own push subscriptions: full CRUD; other users' subscriptions: none.
select lives_ok(
  $$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (auth.uid(), 'https://push.test/user_a-second', 'k', 'a')$$,
  'a customer can add their own push subscription');
select isnt_empty(
  $$update public.push_subscriptions set p256dh = 'rotated' where user_id = auth.uid() returning id$$,
  'a customer can update their own push subscription');
select isnt_empty(
  $$delete from public.push_subscriptions where endpoint = 'https://push.test/user_a-second' returning id$$,
  'a customer can delete their own push subscription');
select throws_ok(
  $$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    select id, 'https://push.test/forged', 'k', 'a' from fx where key = 'user_b'$$,
  '42501', null, 'a customer cannot add a push subscription for another user');
select is_empty(
  $$delete from public.push_subscriptions where user_id <> auth.uid() returning id$$,
  'a customer cannot delete another user''s push subscription');

-- No direct writes anywhere else.
select throws_ok(
  $$insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, source)
    select c.id, s.id, '2030-02-05 18:00+01', '2030-02-05 19:00+01', 'self_booked'
    from fx c, fx s where c.key = 'cust_a' and s.key = 'slot_active'$$,
  '42501', null, 'a customer cannot insert an appointment directly');
select is_empty(
  $$update public.appointments set status = 'cancelled' returning id$$,
  'a customer cannot update their appointments directly');
select is_empty(
  $$delete from public.appointments returning id$$,
  'a customer cannot delete their appointments directly');
select throws_ok(
  $$insert into public.credit_transactions (customer_id, amount, type)
    select id, 100, 'topup' from fx where key = 'cust_a'$$,
  '42501', null, 'a customer cannot insert a transaction directly');
select is_empty(
  $$update public.credit_transactions set amount = 100 returning id$$,
  'a customer cannot update their transactions');
select is_empty(
  $$delete from public.credit_transactions returning id$$,
  'a customer cannot delete their transactions');
select throws_ok(
  $$insert into public.customers (name) values ('Forged')$$,
  '42501', null, 'a customer cannot insert a customers row');
select is_empty(
  $$update public.customers set role = 'trainer' returning id$$,
  'a customer cannot update their own customers row (no self-promotion to trainer)');
select throws_ok(
  $$insert into public.slot_templates (weekday, start_time) values (3, '06:00')$$,
  '42501', null, 'a customer cannot insert a slot template');
select throws_ok(
  $$insert into public.recurring_rules (customer_id, slot_template_id)
    select c.id, s.id from fx c, fx s where c.key = 'cust_a' and s.key = 'slot_inactive'$$,
  '42501', null, 'a customer cannot insert a recurring rule');
select throws_ok(
  $$insert into public.blocked_periods (starts_at, ends_at) values ('2031-01-01', '2031-01-02')$$,
  '42501', null, 'a customer cannot insert a blocked period');
select is_empty(
  $$update public.settings set late_cancel_hours = 0 returning id$$,
  'a customer cannot update settings');

select tests.clear_authentication();

-- Signed-up auth user without a customer record (public sign-up without an invite) ----------

select tests.authenticate_as((select id from fx where key = 'user_nobody'));

select is(
  (select count(*) from public.customers) + (select count(*) from public.slot_templates)
  + (select count(*) from public.recurring_rules) + (select count(*) from public.appointments)
  + (select count(*) from public.credit_transactions) + (select count(*) from public.blocked_periods)
  + (select count(*) from public.settings) + (select count(*) from public.push_subscriptions)
  + (select count(*) from public.customer_balances),
  0::bigint,
  'an auth user without a customer record sees no rows at all');
select is(public.current_customer_id(), null, 'current_customer_id() is null without a customer record');

select tests.clear_authentication();

-- Trainer ----------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'trainer_user'));

select is((select count(*) from public.customers),
  (select n from expected_counts where tbl = 'customers'), 'the trainer sees all customers');
select is((select count(*) from public.slot_templates),
  (select n from expected_counts where tbl = 'slot_templates'),
  'the trainer sees all slot templates, including inactive');
select is((select count(*) from public.recurring_rules),
  (select n from expected_counts where tbl = 'recurring_rules'), 'the trainer sees all recurring rules');
select is((select count(*) from public.appointments),
  (select n from expected_counts where tbl = 'appointments'), 'the trainer sees all appointments');
select is((select count(*) from public.credit_transactions),
  (select n from expected_counts where tbl = 'credit_transactions'), 'the trainer sees all transactions');
select is((select count(*) from public.blocked_periods),
  (select n from expected_counts where tbl = 'blocked_periods'), 'the trainer sees all blocked periods');
select is((select count(*) from public.settings),
  (select n from expected_counts where tbl = 'settings'), 'the trainer sees settings');
select is((select count(*) from public.push_subscriptions),
  (select n from expected_counts where tbl = 'push_subscriptions'),
  'the trainer sees all push subscriptions');
select is((select count(*) from public.customer_balances),
  (select n from expected_counts where tbl = 'customer_balances'), 'the trainer sees every balance');

select is(public.is_trainer(), true, 'is_trainer() is true for the trainer');
select lives_ok(
  $$insert into public.slot_templates (weekday, start_time, duration_minutes, capacity)
    values (4, '19:00', 90, 3)$$,
  'the trainer can insert a slot template');
select isnt_empty(
  $$update public.settings set late_cancel_hours = 6 returning id$$,
  'the trainer can update settings');
select isnt_empty(
  $$update public.customers set phone = '+386 40 000 000'
    where id = (select id from fx where key = 'cust_c') returning id$$,
  'the trainer can update a customer');

select tests.clear_authentication();

-- Anon: no privileges at all ---------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok($$select 1 from public.customers$$, '42501', null, 'anon cannot read customers');
select throws_ok($$select 1 from public.slot_templates$$, '42501', null, 'anon cannot read slot_templates');
select throws_ok($$select 1 from public.recurring_rules$$, '42501', null, 'anon cannot read recurring_rules');
select throws_ok($$select 1 from public.appointments$$, '42501', null, 'anon cannot read appointments');
select throws_ok($$select 1 from public.credit_transactions$$, '42501', null,
  'anon cannot read credit_transactions');
select throws_ok($$select 1 from public.blocked_periods$$, '42501', null, 'anon cannot read blocked_periods');
select throws_ok($$select 1 from public.settings$$, '42501', null, 'anon cannot read settings');
select throws_ok($$select 1 from public.push_subscriptions$$, '42501', null,
  'anon cannot read push_subscriptions');
select throws_ok($$select 1 from public.customer_balances$$, '42501', null,
  'anon cannot read customer_balances');
select throws_ok($$select public.is_trainer()$$, '42501', null, 'anon cannot execute is_trainer()');
select throws_ok($$select public.current_customer_id()$$, '42501', null,
  'anon cannot execute current_customer_id()');

select tests.clear_authentication();

-- Service role (server-side jobs) bypasses RLS ---------------------------------------------

select tests.authenticate_as_service_role();

select is((select count(*) from public.appointments),
  (select n from expected_counts where tbl = 'appointments'), 'the service role sees all appointments');

select tests.clear_authentication();

select * from finish();
rollback;
