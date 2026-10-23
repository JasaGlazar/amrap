-- The notification log and push dispatch: pg_net in the extensions schema, the notifications
-- table (unique per kind and appointment, closed to authenticated and anon), push_config()
-- reading Vault, dispatch_notifications() queueing one pg_net request or doing nothing without
-- config and never raising, claim_notifications() returning each row's subscriptions once.
--
-- Vault rows are replaced inside the transaction; requests go to a test-only host, so queue
-- rows are counted by URL and roll back unsent.
begin;

select plan(26);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('notif-trainer@test.local')),
  ('user_a', tests.create_user('notif-a@test.local')),
  ('user_b', tests.create_user('notif-b@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Notif trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Notif ' || upper(right(key, 1)), id from fx where key in ('user_a', 'user_b')
  returning id, name
) insert into fx select 'cust_' || lower(right(name, 1)), id from c;

-- Customer A has two devices, customer B none.
create temp table subs (endpoint text primary key, p256dh text not null, auth text not null)
  on commit drop;
insert into subs values
  ('https://push.test.invalid/a1', 'p256dh-a1', 'auth-a1'),
  ('https://push.test.invalid/a2', 'p256dh-a2', 'auth-a2');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select (select id from fx where key = 'user_a'), endpoint, p256dh, auth from subs;

with a as (
  insert into public.appointments (customer_id, starts_at, ends_at, source)
  select id, now() + interval '1 day', now() + interval '1 day 1 hour', 'self_booked'
  from fx where key = 'cust_a'
  returning id
) insert into fx select 'appt_a', id from a;

with n as (
  insert into public.notifications (customer_id, kind, appointment_id, data)
  select (select id from fx where key = 'cust_a'), 'cutoff_reminder', (select id from fx where key = 'appt_a'),
         '{"marker": "a"}'::jsonb
  returning id
) insert into fx select 'notif_a', id from n;
with n as (
  insert into public.notifications (customer_id, kind, data)
  select id, 'credit_topup', '{"marker": "b"}'::jsonb from fx where key = 'cust_b'
  returning id
) insert into fx select 'notif_b', id from n;

delete from vault.secrets where name in ('amrap_functions_url', 'amrap_push_secret');

create temp table claims (run int, notification_id uuid, kind text, data jsonb, endpoint text,
                          p256dh text, auth text) on commit drop;
grant select on fx, subs to authenticated, service_role;
grant select, insert on claims to service_role;

-- Extension, table, enum -------------------------------------------------------------------

select is((select extnamespace::regnamespace::text from pg_extension where extname = 'pg_net'),
  'extensions', 'pg_net is installed in the extensions schema');
select has_table('public', 'notifications', 'table notifications exists');
select enum_has_labels('public', 'notification_kind',
  array['cutoff_reminder', 'booking_created', 'booking_cancelled', 'credit_topup', 'credit_adjustment'],
  'notification_kind has the five kinds');
select throws_ok(
  $$insert into public.notifications (customer_id, kind, appointment_id)
    select (select id from fx where key = 'cust_a'), 'cutoff_reminder', (select id from fx where key = 'appt_a')$$,
  '23505', null, 'a second notification of the same kind for the same appointment is refused');
select lives_ok(
  $$insert into public.notifications (customer_id, kind)
    select id, 'credit_topup' from fx where key = 'cust_b'$$,
  'notifications without an appointment never collide');
select ok((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass),
  'notifications has row level security enabled');
select is_empty(
  $$select r, p from unnest(array['anon', 'authenticated']) r,
                     unnest(array['select', 'insert', 'update', 'delete']) p
    where has_table_privilege(r, 'public.notifications', p)$$,
  'anon and authenticated have no privilege on notifications');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_ok($$select * from public.notifications$$, '42501', null,
  'even the trainer cannot read notifications through the API');
select tests.clear_authentication();

-- Function definitions and grants ----------------------------------------------------------

select set_eq(
  $$select p.proname::text, p.prosecdef, array_to_string(p.proconfig, ',')
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('push_config', 'dispatch_notifications', 'claim_notifications')$$,
  $$values ('push_config', true, 'search_path=""'), ('dispatch_notifications', true, 'search_path=""'),
           ('claim_notifications', true, 'search_path=""')$$,
  'the push functions are security definer with an empty search_path');
select is_empty(
  $$select r, f from unnest(array['anon', 'authenticated', 'service_role']) r,
                     unnest(array['public.push_config()', 'public.dispatch_notifications(uuid[])']) f
    where has_function_privilege(r, f, 'EXECUTE')$$,
  'push_config and dispatch_notifications are executable by nobody but their owner');
select ok(has_function_privilege('service_role', 'public.claim_notifications(uuid[])', 'EXECUTE'),
  'service_role can execute claim_notifications');
select is_empty(
  $$select r from unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, 'public.claim_notifications(uuid[])', 'EXECUTE')$$,
  'anon and authenticated cannot execute claim_notifications');

-- push_config ------------------------------------------------------------------------------

select is_empty($$select 1 from public.push_config() where functions_url is not null or push_secret is not null$$,
  'without Vault rows push_config returns nulls');

select vault.create_secret('http://push-test.invalid/functions/v1', 'amrap_functions_url');
select vault.create_secret('test-push-secret', 'amrap_push_secret');

select results_eq($$select functions_url, push_secret from public.push_config()$$,
  $$values ('http://push-test.invalid/functions/v1', 'test-push-secret')$$,
  'push_config returns the two Vault values');

-- dispatch_notifications -------------------------------------------------------------------

select lives_ok(
  $$select public.dispatch_notifications(array[(select id from fx where key = 'notif_a'),
                                                (select id from fx where key = 'notif_b')])$$,
  'dispatch with config succeeds');
select results_eq(
  $$select method::text, url, timeout_milliseconds from net.http_request_queue
    where url like 'http://push-test.invalid/%'$$,
  $$values ('POST', 'http://push-test.invalid/functions/v1/send-push', 10000)$$,
  'one POST to send-push is queued with a 10 s timeout');
select is(
  (select headers from net.http_request_queue where url like 'http://push-test.invalid/%'),
  '{"Content-Type": "application/json", "x-amrap-push-secret": "test-push-secret"}'::jsonb,
  'the request carries the JSON content type and the shared secret');
select set_eq(
  $$select jsonb_array_elements_text(convert_from(body, 'utf8')::jsonb -> 'ids')::uuid
    from net.http_request_queue where url like 'http://push-test.invalid/%'$$,
  $$select id from fx where key in ('notif_a', 'notif_b')$$,
  'the request body holds the dispatched ids');

select public.dispatch_notifications(array[]::uuid[]);
select public.dispatch_notifications(null);
select is((select count(*) from net.http_request_queue where url like 'http://push-test.invalid/%'), 1::bigint,
  'an empty or null id list queues nothing');

select vault.update_secret(id, 'not a url') from vault.secrets where name = 'amrap_functions_url';
set local client_min_messages = error;
select lives_ok($$select public.dispatch_notifications(array[(select id from fx where key = 'notif_a')])$$,
  'a failing pg_net call is caught: dispatch never raises');
reset client_min_messages;

delete from vault.secrets where name = 'amrap_functions_url';
select lives_ok($$select public.dispatch_notifications(array[(select id from fx where key = 'notif_a')])$$,
  'dispatch without config succeeds');
select is(
  (select count(*) from net.http_request_queue
   where url like 'http://push-test.invalid/%' or url like 'not a url%'),
  1::bigint,
  'neither the failing call nor the unconfigured one queued a request');

-- claim_notifications ----------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into claims
  select 1, * from public.claim_notifications(array[(select id from fx where key = 'notif_a'),
                                                    (select id from fx where key = 'notif_b')]);
select tests.clear_authentication();

select set_eq(
  $$select notification_id, kind, data, endpoint, p256dh, auth from claims where run = 1$$,
  $$select (select id from fx where key = 'notif_a'), 'cutoff_reminder', '{"marker": "a"}'::jsonb,
           endpoint, p256dh, auth from subs$$,
  'the claim returns the notification once per subscription of its recipient');
select is(
  (select count(*) from public.notifications
   where id in (select id from fx where key in ('notif_a', 'notif_b')) and dispatched_at = now()),
  (select count(*) from fx where key in ('notif_a', 'notif_b')),
  'both claimed notifications are marked dispatched, also the one whose recipient has no device');

select tests.authenticate_as_service_role();
insert into claims
  select 2, * from public.claim_notifications(array[(select id from fx where key = 'notif_a'),
                                                    (select id from fx where key = 'notif_b')]);
select tests.clear_authentication();

select is_empty($$select 1 from claims where run = 2$$, 'a second claim of the same ids returns nothing');

select tests.authenticate_as((select id from fx where key = 'trainer_user'));
select throws_ok($$select * from public.claim_notifications(array[]::uuid[])$$, '42501', null,
  'the trainer (authenticated) cannot claim notifications');
select tests.clear_authentication();

select * from finish();
rollback;
