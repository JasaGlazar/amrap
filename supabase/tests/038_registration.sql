-- register_customer() and set_registration_code(): a signed-in user without a customer record
-- creates one with the gym code (ADR 0021). A missing or wrong code gives the same error as
-- closed registration, the code is checked before name and phone, and the code in
-- registration_settings is readable by the trainer only.
begin;

select plan(45);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('reg-trainer@test.local')),
  ('user_a', tests.create_user('reg-a@test.local')),
  ('user_new', tests.create_user('reg-new@test.local')),
  ('user_second', tests.create_user('reg-second@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Reg trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Reg A (linked)', id from fx where key = 'user_a'
  returning id
) insert into fx select 'cust_a', id from c;

create temp table registered (key text primary key, id uuid not null) on commit drop;

grant select on fx to authenticated, service_role;
grant select, insert on registered to authenticated, service_role;

-- Shape, defaults and grants ---------------------------------------------------------------

select results_eq(
  $$select id, code from public.registration_settings$$,
  $$values (1, null::text)$$,
  'registration_settings has one row and registration starts closed');
select col_type_is('public', 'customers', 'registered_at', 'timestamp with time zone',
  'customers.registered_at is a timestamptz');
select is((select registered_at from public.customers where id = (select id from fx where key = 'cust_a')),
  null::timestamptz, 'a record the trainer created has no registered_at');
select throws_ok($$update public.registration_settings set code = 'short' where id = 1$$, '23514', null,
  'a stored code has at least 8 characters');
select is(
  array(select p.proname::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('register_customer', 'set_registration_code')
        order by 1),
  array['register_customer:true:search_path=""', 'set_registration_code:true:search_path=""'],
  'register_customer and set_registration_code are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.register_customer(text, text, text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.set_registration_code(text)', 'EXECUTE'),
  'authenticated can execute register_customer and set_registration_code');
select ok(not has_function_privilege('anon', 'public.register_customer(text, text, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.set_registration_code(text)', 'EXECUTE'),
  'anon can execute neither');
select table_privs_are('public', 'registration_settings', 'anon', array[]::text[],
  'registration_settings grants nothing to anon');
select table_privs_are('public', 'registration_settings', 'authenticated', array['SELECT'],
  'registration_settings grants authenticated only select');

-- Signed out -------------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.register_customer('Anon Person', '040123456', 'whatever')$$, '42501', null,
  'a signed-out user cannot execute register_customer');
select throws_ok($$select code from public.registration_settings$$, '42501', null,
  'a signed-out user cannot read registration_settings');
select tests.clear_authentication();

select tests.authenticate_as_service_role();
select throws_matching($$select public.register_customer('No User', '040123456', 'whatever')$$,
  '^AMRAP_FORBIDDEN:', 'register_customer needs a signed-in user');
select tests.clear_authentication();

-- Closed or wrong code ---------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_new'));
select throws_matching($$select public.register_customer('Nova Stranka', '040123456', 'gym-code-1234')$$,
  '^AMRAP_REGISTRATION_CLOSED:', 'registration is refused while the code is null');
select tests.clear_authentication();

update public.registration_settings set code = 'gym-code-1234' where id = 1;

select tests.authenticate_as((select id from fx where key = 'user_new'));
select throws_matching($$select public.register_customer('Nova Stranka', '040123456', 'gym-code-9999')$$,
  '^AMRAP_REGISTRATION_CLOSED:', 'a wrong code is refused as closed');
select throws_matching($$select public.register_customer('Nova Stranka', '040123456', null)$$,
  '^AMRAP_REGISTRATION_CLOSED:', 'a missing code is refused as closed');
select throws_matching($$select public.register_customer('  ', null, 'gym-code-9999')$$,
  '^AMRAP_REGISTRATION_CLOSED:', 'invalid name and phone with a wrong code are refused as closed');

-- Name and phone ---------------------------------------------------------------------------

select throws_matching($$select public.register_customer('  ', '040123456', 'gym-code-1234')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a name of spaces is refused');
select throws_matching($$select public.register_customer(' A ', '040123456', 'gym-code-1234')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a name of 1 character is refused');
select throws_matching($$select public.register_customer(repeat('a', 81), '040123456', 'gym-code-1234')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a name of 81 characters is refused');
select throws_matching($$select public.register_customer(null, '040123456', 'gym-code-1234')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a null name is refused');
select throws_matching($$select public.register_customer('Nova Stranka', '   ', 'gym-code-1234')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a phone of spaces is refused');
select throws_matching($$select public.register_customer('Nova Stranka', '12345', 'gym-code-1234')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a phone of 5 characters is refused');
select throws_matching($$select public.register_customer('Nova Stranka', repeat('1', 31), 'gym-code-1234')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a phone of 31 characters is refused');
select throws_matching($$select public.register_customer('Nova Stranka', null, 'gym-code-1234')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a null phone is refused');

-- Registration -----------------------------------------------------------------------------

insert into registered
  select 'user_new', public.register_customer('  Nova Stranka  ', ' 040 123 456 ', 'gym-code-1234');
select is((select id from registered where key = 'user_new'), public.current_customer_id(),
  'register_customer returns the id of the record now linked to the caller');
select tests.clear_authentication();

select results_eq(
  $$select role::text, name, phone, email, auth_user_id, registered_at is not null
    from public.customers where id = (select id from registered where key = 'user_new')$$,
  $$select 'customer', 'Nova Stranka', '040 123 456',
           (select email::text from auth.users where id = (select id from fx where key = 'user_new')),
           (select id from fx where key = 'user_new'), true$$,
  'the new record is a customer with the trimmed name and phone, the auth email and registered_at');

select tests.authenticate_as((select id from fx where key = 'user_new'));
select throws_matching($$select public.register_customer('Nova Stranka', '040123456', 'gym-code-1234')$$,
  '^AMRAP_ALREADY_LINKED:', 'a second call by the same user is refused');
select tests.clear_authentication();

select is(
  (select count(*)::int from public.customers where auth_user_id = (select id from fx where key = 'user_new')),
  1, 'the user still has exactly one customer record');

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.register_customer('Reg A again', '040123456', 'gym-code-1234')$$,
  '^AMRAP_ALREADY_LINKED:', 'an already linked customer cannot register');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching($$select public.register_customer('Reg trainer', '040123456', 'gym-code-1234')$$,
  '^AMRAP_ALREADY_LINKED:', 'the trainer cannot register');
select tests.clear_authentication();

-- Who can read and write registration_settings ---------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select is_empty($$select code from public.registration_settings$$,
  'a customer sees no rows in registration_settings');
select throws_ok($$update public.registration_settings set code = 'customer-code-1' where id = 1$$, '42501', null,
  'a customer cannot update registration_settings directly');
select tests.clear_authentication();

select is((select code from public.registration_settings where id = 1), 'gym-code-1234',
  'the refused update left the code unchanged');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select results_eq($$select code from public.registration_settings$$, $$values ('gym-code-1234'::text)$$,
  'the trainer sees the one row with the code');
select throws_ok($$update public.registration_settings set code = 'trainer-code-1' where id = 1$$, '42501', null,
  'the trainer changes the code only through set_registration_code');
select tests.clear_authentication();

-- set_registration_code --------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select throws_matching($$select public.set_registration_code('customer-code-1')$$,
  '^AMRAP_FORBIDDEN:', 'a customer cannot set the code');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_second'));
select throws_matching($$select public.set_registration_code('stranger-code-1')$$,
  '^AMRAP_FORBIDDEN:', 'a user without a record cannot set the code');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching($$select public.set_registration_code('1234567')$$,
  '^AMRAP_INVALID_ARGUMENT:', 'a code of 7 characters is refused');
select public.set_registration_code('12345678');
select is((select code from public.registration_settings where id = 1), '12345678',
  'a code of 8 characters is stored');
select public.set_registration_code('87654321');
select is((select code from public.registration_settings where id = 1), '87654321',
  'a new code replaces the old code');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_second'));
select throws_matching($$select public.register_customer('Druga Stranka', '040123456', '12345678')$$,
  '^AMRAP_REGISTRATION_CLOSED:', 'after the code is replaced, the old code is refused');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select public.set_registration_code(null);
select is((select code from public.registration_settings where id = 1), null::text,
  'a null code clears the code');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'user_second'));
select throws_matching($$select public.register_customer('Druga Stranka', '040123456', '87654321')$$,
  '^AMRAP_REGISTRATION_CLOSED:', 'after the code is cleared, the old code is refused');
select tests.clear_authentication();

-- A missing settings row fails closed ------------------------------------------------------

delete from public.registration_settings;

select tests.authenticate_as((select id from fx where key = 'user_second'));
select throws_matching($$select public.register_customer('Druga Stranka', '040123456', '12345678')$$,
  '^AMRAP_REGISTRATION_CLOSED:', 'without the settings row, registration is closed');
select tests.clear_authentication();

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_matching($$select public.set_registration_code('12345678')$$,
  '^AMRAP_SETTINGS_MISSING:', 'without the settings row, set_registration_code fails');
select tests.clear_authentication();

select * from finish();
rollback;
