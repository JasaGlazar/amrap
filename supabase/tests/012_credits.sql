-- top_up() and adjust(): trainer-only ledger writes. Customers (even for themselves), auth
-- users without a customer record and anon are rejected. Balances are compared with the sum
-- of the amounts this test inserts.
begin;

select plan(22);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('credits-trainer@test.local')),
  ('user_a', tests.create_user('credits-a@test.local')),
  ('user_nobody', tests.create_user('credits-nobody@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Credits trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Credits A', id from fx where key = 'user_a'
  returning id
) insert into fx select 'cust_a', id from c;

-- The amounts the trainer will write, so expectations derive from them.
create temp table amounts (step text primary key, amount int not null) on commit drop;
insert into amounts values ('top_up', 10), ('adjust', -3);

grant select on fx, amounts to authenticated, service_role;

-- Function definitions ---------------------------------------------------------------------

select is(
  array(select p.proname::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname in ('top_up', 'adjust')
        order by 1),
  array['adjust:true:search_path=""', 'top_up:true:search_path=""'],
  'top_up and adjust are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.top_up(uuid, integer, text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.adjust(uuid, integer, text)', 'EXECUTE'),
  'authenticated can execute top_up and adjust');
select ok(not has_function_privilege('anon', 'public.top_up(uuid, integer, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.adjust(uuid, integer, text)', 'EXECUTE'),
  'anon cannot execute top_up or adjust');

-- Trainer ----------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'trainer_user'));

create temp table written (step text primary key, id uuid not null) on commit drop;
insert into written
  select 'top_up', public.top_up((select id from fx where key = 'cust_a'),
                                 (select amount from amounts where step = 'top_up'), 'Paket 10');

select results_eq(
  $$select customer_id, amount, type::text, appointment_id, created_by, note
    from public.credit_transactions where id = (select id from written where step = 'top_up')$$,
  $$select (select id from fx where key = 'cust_a'), (select amount from amounts where step = 'top_up'),
           'topup', null::uuid, (select id from fx where key = 'trainer_user'), 'Paket 10'$$,
  'top_up writes one topup row for the customer, created by the trainer, with the note');
select is(
  (select balance from public.customer_balances where customer_id = (select id from fx where key = 'cust_a')),
  (select sum(amount) from amounts where step = 'top_up'),
  'the balance after top_up is the topped-up amount');

insert into written
  select 'adjust', public.adjust((select id from fx where key = 'cust_a'),
                                 (select amount from amounts where step = 'adjust'), 'Popravek');

select results_eq(
  $$select customer_id, amount, type::text, created_by, note
    from public.credit_transactions where id = (select id from written where step = 'adjust')$$,
  $$select (select id from fx where key = 'cust_a'), (select amount from amounts where step = 'adjust'),
           'adjustment', (select id from fx where key = 'trainer_user'), 'Popravek'$$,
  'adjust writes one adjustment row with the signed amount and the note');
select is(
  (select balance from public.customer_balances where customer_id = (select id from fx where key = 'cust_a')),
  (select sum(amount) from amounts),
  'the balance after adjust is the sum of both amounts');
select lives_ok(
  $$select public.adjust((select id from fx where key = 'cust_a'), 1)$$,
  'adjust accepts a positive amount (waiving a late-cancel charge) without a note');

select throws_matching(
  $$select public.top_up((select id from fx where key = 'cust_a'), 0)$$,
  '^AMRAP_INVALID_ARGUMENT:', 'top_up rejects a zero amount');
select throws_matching(
  $$select public.top_up((select id from fx where key = 'cust_a'), -5)$$,
  '^AMRAP_INVALID_ARGUMENT:', 'top_up rejects a negative amount');
select throws_matching(
  $$select public.top_up((select id from fx where key = 'cust_a'), null)$$,
  '^AMRAP_INVALID_ARGUMENT:', 'top_up rejects a null amount');
select throws_matching(
  $$select public.adjust((select id from fx where key = 'cust_a'), 0)$$,
  '^AMRAP_INVALID_ARGUMENT:', 'adjust rejects a zero amount');
select throws_matching(
  $$select public.top_up(gen_random_uuid(), 5)$$,
  '^AMRAP_NOT_FOUND:', 'top_up rejects an unknown customer');
select throws_matching(
  $$select public.adjust(gen_random_uuid(), 5)$$,
  '^AMRAP_NOT_FOUND:', 'adjust rejects an unknown customer');
select throws_ok(
  $$select public.top_up((select id from fx where key = 'cust_a'), 0)$$,
  'P0001', null, 'RPC errors use SQLSTATE P0001');

select tests.clear_authentication();

-- Customer ---------------------------------------------------------------------------------

create temp table tx_count as
  select count(*) as n from public.credit_transactions
  where customer_id = (select id from fx where key = 'cust_a');
grant select on tx_count to authenticated;

select tests.authenticate_as((select id from fx where key = 'user_a'));

select throws_matching(
  $$select public.top_up((select id from fx where key = 'cust_a'), 5)$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot top up their own balance');
select throws_matching(
  $$select public.adjust((select id from fx where key = 'cust_a'), 5)$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot adjust their own balance');
select throws_matching(
  $$select public.top_up((select id from fx where key = 'trainer'), 5)$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot top up another customer');
select is(
  (select count(*) from public.credit_transactions),
  (select n from tx_count),
  'rejected customer calls wrote no transactions');

select tests.clear_authentication();

-- Auth user without a customer record, and anon --------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_nobody'));

select throws_matching(
  $$select public.top_up((select id from fx where key = 'cust_a'), 5)$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot top up');
select throws_matching(
  $$select public.adjust((select id from fx where key = 'cust_a'), 5)$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot adjust');

select tests.clear_authentication();

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$select public.top_up('00000000-0000-0000-0000-000000000000', 5)$$,
  '42501', null, 'anon cannot execute top_up');

select tests.clear_authentication();

select * from finish();
rollback;
