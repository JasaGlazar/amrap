-- pgTAP test helpers. Loaded by `supabase db reset` before dev.sql (see config.toml
-- [db.seed] sql_paths). Local only: seeds are never pushed to the remote project.
--
-- Usage inside a test (each test file runs in one transaction that is rolled back):
--   select tests.create_user('a@test.local')                -- new auth user, returns its id
--   select tests.authenticate_as(<user id>)                 -- act as that user under RLS
--   select tests.authenticate_as_service_role()             -- act as service_role (bypasses RLS)
--   select tests.clear_authentication()                     -- back to the test superuser

create schema if not exists tests;

grant usage on schema tests to anon, authenticated, service_role;

-- Creates a confirmed email/password auth user the way Supabase CLI seeds do, so the user can
-- also sign in through GoTrue. The token columns must be '' (not null) or GoTrue fails to scan
-- the row on sign-in.
create or replace function tests.create_user(email text, password text default 'password')
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated',
    create_user.email, extensions.crypt(create_user.password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (
    user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    v_user_id, v_user_id::text, 'email',
    jsonb_build_object('sub', v_user_id::text, 'email', create_user.email,
                       'email_verified', true),
    now(), now(), now()
  );

  return v_user_id;
end;
$$;

-- Acts as the given auth user until the end of the transaction: role `authenticated` and JWT
-- claims with `sub`, so auth.uid() and RLS behave as for a real request.
create or replace function tests.authenticate_as(user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', authenticate_as.user_id::text, 'role', 'authenticated')::text,
    true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Acts as the service role (bypasses RLS) until the end of the transaction.
create or replace function tests.authenticate_as_service_role()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- Drops the JWT claims and returns to the session role (the test superuser `postgres`).
create or replace function tests.clear_authentication()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'none', true);
end;
$$;

-- The role-switching helpers must stay callable after switching roles; create_user is only
-- for the test superuser.
revoke execute on all functions in schema tests from public;
grant execute on function tests.authenticate_as(uuid), tests.authenticate_as_service_role(),
  tests.clear_authentication() to anon, authenticated, service_role;
