-- create_invite() and accept_invite(): the trainer issues a single-use token valid for 7 days
-- for an unlinked customer record; a signed-up auth user redeems it once and is linked
-- (ADR 0006). Reuse, expiry, superseded tokens and already-linked users are rejected.
begin;

select plan(24);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('invite-trainer@test.local')),
  ('user_a', tests.create_user('invite-a@test.local')),
  ('user_new', tests.create_user('invite-new@test.local')),
  ('user_second', tests.create_user('invite-second@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Invite trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Invite A (linked)', id from fx where key = 'user_a'
  returning id
) insert into fx select 'cust_a', id from c;
with c as (
  insert into public.customers (name) values ('Invite N (new)') returning id
) insert into fx select 'cust_new', id from c;
with c as (
  insert into public.customers (name) values ('Invite E (expiring)') returning id
) insert into fx select 'cust_expiring', id from c;
with c as (
  insert into public.customers (name) values ('Invite R (reissued)') returning id
) insert into fx select 'cust_reissued', id from c;
with c as (
  insert into public.customers (name) values ('Invite O (other)') returning id
) insert into fx select 'cust_other', id from c;
-- A linked record that still carries a token (only possible through a direct trainer edit).
with c as (
  insert into public.customers (name, auth_user_id, invite_token, invite_expires_at)
  select 'Invite U (used)', tests.create_user('invite-used@test.local'),
         'invite-test-used-token', now() + interval '1 day'
  returning id
) insert into fx select 'cust_used', id from c;

-- Tokens returned by create_invite, by customer key (a re-issue gets its own key).
create temp table tokens (key text primary key, token text not null) on commit drop;
create temp table accepted (key text primary key, customer_id uuid not null) on commit drop;

grant select on fx to authenticated, service_role;
grant select, insert on tokens, accepted to authenticated, service_role;

-- Function definitions ---------------------------------------------------------------------

select is(
  array(select p.proname::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname in ('create_invite', 'accept_invite')
        order by 1),
  array['accept_invite:true:search_path=""', 'create_invite:true:search_path=""'],
  'create_invite and accept_invite are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.create_invite(uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.accept_invite(text)', 'EXECUTE'),
  'authenticated can execute create_invite and accept_invite');
select ok(not has_function_privilege('anon', 'public.create_invite(uuid)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.accept_invite(text)', 'EXECUTE'),
  'anon can execute neither');

-- Trainer issues invites -------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'trainer_user'));

insert into tokens
  select key, public.create_invite(id) from fx
  where key in ('cust_new', 'cust_expiring', 'cust_reissued', 'cust_other');
insert into tokens
  select 'cust_reissued_again', public.create_invite((select id from fx where key = 'cust_reissued'));

select ok((select bool_and(token ~ '^[0-9a-f]{48}$') from tokens),
  'create_invite returns 48 hex characters (24 random bytes)');
select is((select count(distinct token) from tokens), (select count(*) from tokens),
  'every issued token is different');
select set_eq(
  $$select c.id, c.invite_token, c.invite_expires_at from public.customers c
    where c.id in (select id from fx where key in ('cust_new', 'cust_expiring', 'cust_other'))$$,
  $$select fx.id, t.token, now() + interval '7 days' from tokens t join fx on fx.key = t.key
    where t.key in ('cust_new', 'cust_expiring', 'cust_other')$$,
  'create_invite stores the returned token with a 7-day expiry');
select is(
  (select invite_token from public.customers where id = (select id from fx where key = 'cust_reissued')),
  (select token from tokens where key = 'cust_reissued_again'),
  're-issuing an invite replaces the previous token');
select throws_matching($$select public.create_invite((select id from fx where key = 'cust_a'))$$,
  '^AMRAP_ALREADY_LINKED:', 'an invite cannot be created for an already linked customer');
select throws_matching($$select public.create_invite(gen_random_uuid())$$,
  '^AMRAP_NOT_FOUND:', 'an invite cannot be created for an unknown customer');

select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.create_invite((select id from fx where key = 'cust_new'))$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot create invites');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_second'));
select throws_matching($$select public.create_invite((select id from fx where key = 'cust_new'))$$,
  '^AMRAP_FORBIDDEN:', 'an auth user without a customer record cannot create invites');
select tests.clear_authentication();

-- The token works once ---------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_new'));
insert into accepted
  select 'cust_new', public.accept_invite((select token from tokens where key = 'cust_new'));
select is((select customer_id from accepted where key = 'cust_new'), (select id from fx where key = 'cust_new'),
  'accept_invite returns the invited customer id');
select is(public.current_customer_id(), (select id from fx where key = 'cust_new'),
  'after accepting, the user is linked to the customer record');
select tests.clear_authentication();

select results_eq(
  $$select auth_user_id, invite_token, invite_expires_at from public.customers
    where id = (select id from fx where key = 'cust_new')$$,
  $$select (select id from fx where key = 'user_new'), null::text, null::timestamptz$$,
  'accepting sets auth_user_id and clears the token and its expiry');

select tests.authenticate_as((select id from fx where key = 'user_second'));
select throws_matching($$select public.accept_invite((select token from tokens where key = 'cust_new'))$$,
  '^AMRAP_INVITE_INVALID:', 'a used token cannot be used a second time');

-- Expired, superseded, unknown and empty tokens --------------------------------------------

select tests.clear_authentication();
update public.customers set invite_expires_at = now() - interval '1 minute'
  where id = (select id from fx where key = 'cust_expiring');
select tests.authenticate_as((select id from fx where key = 'user_second'));

select throws_matching($$select public.accept_invite((select token from tokens where key = 'cust_expiring'))$$,
  '^AMRAP_INVITE_INVALID:', 'an expired token is rejected');
select throws_matching($$select public.accept_invite((select token from tokens where key = 'cust_reissued'))$$,
  '^AMRAP_INVITE_INVALID:', 'a token replaced by a re-issued invite is rejected');
select throws_matching($$select public.accept_invite('not-a-real-token')$$,
  '^AMRAP_INVITE_INVALID:', 'an unknown token is rejected');
select throws_matching($$select public.accept_invite(null)$$,
  '^AMRAP_INVITE_INVALID:', 'a null token is rejected');
select throws_matching($$select public.accept_invite('invite-test-used-token')$$,
  '^AMRAP_INVITE_USED:', 'a token of an already linked customer is rejected as used');
select tests.clear_authentication();

-- A user already linked cannot accept another invite --------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_new'));
select throws_matching($$select public.accept_invite((select token from tokens where key = 'cust_other'))$$,
  '^AMRAP_ALREADY_LINKED:', 'a user already linked to a customer cannot accept another invite');
select tests.clear_authentication();

select results_eq(
  $$select auth_user_id, invite_token from public.customers where id = (select id from fx where key = 'cust_other')$$,
  $$select null::uuid, (select token from tokens where key = 'cust_other')$$,
  'the rejected accept left the other invite pending');

-- Callers without a user -------------------------------------------------------------------

select tests.authenticate_as_service_role();
select throws_matching($$select public.accept_invite((select token from tokens where key = 'cust_other'))$$,
  '^AMRAP_FORBIDDEN:', 'accept_invite needs a signed-in user');
select tests.clear_authentication();

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.accept_invite('whatever')$$, '42501', null,
  'anon cannot execute accept_invite');
select tests.clear_authentication();

select * from finish();
rollback;
