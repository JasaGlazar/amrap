-- delete_customer(): the trainer deletes a customer record with no history (no appointments of
-- any status, no credit transactions, no recurring rules, active or not) and never a trainer
-- record. The record's notifications go with it (on delete cascade); its auth user stays.
begin;

select plan(22);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('del-trainer@test.local')),
  ('user_a', tests.create_user('del-a@test.local')),
  ('user_clean', tests.create_user('del-clean@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Del trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, role) values ('Del second trainer', 'trainer') returning id
) insert into fx select 'trainer_2', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Del A', id from fx where key = 'user_a'
  returning id
) insert into fx select 'cust_a', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Del clean', id from fx where key = 'user_clean'
  returning id
) insert into fx select 'cust_clean', id from c;
with c as (
  insert into public.customers (name) values
    ('Del with appointment'), ('Del with transaction'), ('Del with rule')
  returning id, name
) insert into fx
  select case name
    when 'Del with appointment' then 'cust_appt'
    when 'Del with transaction' then 'cust_tx'
    else 'cust_rule' end, id
  from c;

with t as (
  insert into public.slot_templates (weekday, start_time, duration_minutes, capacity, active)
  values (3, '10:00', 60, 5, false) returning id
) insert into fx select 'tpl', id from t;

-- A cancelled appointment in the future: not booked, not in the past, still history.
insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, status, source,
                                 cancelled_at)
select (select id from fx where key = 'cust_appt'), (select id from fx where key = 'tpl'),
       now() + interval '3 days', now() + interval '3 days 1 hour', 'cancelled', 'self_booked',
       now();
insert into public.credit_transactions (customer_id, amount, type)
select id, 5, 'topup' from fx where key = 'cust_tx';
insert into public.recurring_rules (customer_id, slot_template_id, active)
select (select id from fx where key = 'cust_rule'), (select id from fx where key = 'tpl'), false;

insert into public.notifications (customer_id, kind, data)
select id, 'customer_registered', '{}'::jsonb from fx where key = 'cust_clean';

grant select on fx to authenticated, service_role;

-- Shape and grants -------------------------------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = 'public.delete_customer(uuid)'::regprocedure),
  'true:search_path=""',
  'delete_customer is security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.delete_customer(uuid)', 'EXECUTE'),
  'authenticated can execute delete_customer');
select ok(not has_function_privilege('anon', 'public.delete_customer(uuid)', 'EXECUTE'),
  'anon cannot execute delete_customer');

-- Who may call -----------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching(
  format('select public.delete_customer(%L)', (select id from fx where key = 'cust_clean')),
  '^AMRAP_FORBIDDEN:', 'a customer cannot delete a record');
select throws_matching(
  format('select public.delete_customer(%L)', (select id from fx where key = 'cust_a')),
  '^AMRAP_FORBIDDEN:', 'a customer cannot delete their own record');
select tests.clear_authentication();

-- Arguments --------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching($$select public.delete_customer(null)$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a null id is refused');
select throws_matching(
  format('select public.delete_customer(%L)', gen_random_uuid()),
  '^AMRAP_NOT_FOUND:', 'an unknown id is refused');

-- Records with history, and trainer records ------------------------------------------------

select throws_matching(
  format('select public.delete_customer(%L)', (select id from fx where key = 'cust_appt')),
  '^AMRAP_NOT_DELETABLE:', 'a record with an appointment (here cancelled) is refused');
select throws_matching(
  format('select public.delete_customer(%L)', (select id from fx where key = 'cust_tx')),
  '^AMRAP_NOT_DELETABLE:', 'a record with a credit transaction is refused');
select throws_matching(
  format('select public.delete_customer(%L)', (select id from fx where key = 'cust_rule')),
  '^AMRAP_NOT_DELETABLE:', 'a record with an inactive recurring rule is refused');
select throws_matching(
  format('select public.delete_customer(%L)', (select id from fx where key = 'trainer_2')),
  '^AMRAP_NOT_DELETABLE:', 'a trainer record with no history is refused');
select throws_matching(
  format('select public.delete_customer(%L)', (select id from fx where key = 'trainer')),
  '^AMRAP_NOT_DELETABLE:', 'the trainer cannot delete their own record');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.customers c join fx on fx.id = c.id
   where fx.key in ('cust_appt', 'cust_tx', 'cust_rule', 'trainer_2', 'trainer')),
  (select count(*)::int from fx
   where key in ('cust_appt', 'cust_tx', 'cust_rule', 'trainer_2', 'trainer')),
  'every refused record still exists');
select isnt_empty(
  format('select 1 from public.appointments where customer_id = %L',
         (select id from fx where key = 'cust_appt')),
  'the refused record keeps its appointment');
select isnt_empty(
  format('select 1 from public.credit_transactions where customer_id = %L',
         (select id from fx where key = 'cust_tx')),
  'the refused record keeps its transaction');
select isnt_empty(
  format('select 1 from public.recurring_rules where customer_id = %L',
         (select id from fx where key = 'cust_rule')),
  'the refused record keeps its rule');

-- A record with no history -----------------------------------------------------------------

select isnt_empty(
  format('select 1 from public.notifications where customer_id = %L',
         (select id from fx where key = 'cust_clean')),
  'the record to delete has a notification before the delete');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select lives_ok(
  format('select public.delete_customer(%L)', (select id from fx where key = 'cust_clean')),
  'the trainer deletes a record with no history');
select tests.clear_authentication();

select is_empty(
  format('select 1 from public.customers where id = %L',
         (select id from fx where key = 'cust_clean')),
  'the record is gone');
select is_empty(
  format('select 1 from public.notifications where customer_id = %L',
         (select id from fx where key = 'cust_clean')),
  'its notifications are gone with it');
select isnt_empty(
  format('select 1 from auth.users where id = %L',
         (select id from fx where key = 'user_clean')),
  'its auth user still exists');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching(
  format('select public.delete_customer(%L)', (select id from fx where key = 'cust_clean')),
  '^AMRAP_NOT_FOUND:', 'a second delete of the same record finds nothing');
select tests.clear_authentication();

select * from finish();
rollback;
