-- customer_registered: a registration (register_customer()) notifies the trainer with the new
-- customer's id and name; a record the trainer creates notifies nobody. Every registration gets
-- its own row (appointment_id is null, so the (kind, appointment_id) key never merges them).
-- Nothing is recorded without a trainer device, and a failing notification never fails the
-- registration (a failed dispatch keeps the row undispatched, as for the other kinds).
begin;

select plan(19);

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('regnotify-trainer@test.local')),
  ('user_one', tests.create_user('regnotify-one@test.local')),
  ('user_two', tests.create_user('regnotify-two@test.local')),
  ('user_nosub', tests.create_user('regnotify-nosub@test.local')),
  ('user_broken', tests.create_user('regnotify-broken@test.local')),
  ('user_failing', tests.create_user('regnotify-failing@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Regnotify trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;

insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test.invalid/regnotify-' || key, 'p256dh', 'auth'
  from fx where key = 'trainer_user';

create temp view trainer_recipient as
  select c.id from public.customers c
  where c.role = 'trainer'
    and exists (select 1 from public.push_subscriptions s where s.user_id = c.auth_user_id)
  order by c.created_at, c.id
  limit 1;

update public.registration_settings set code = 'regnotify-code-1' where id = 1;

delete from vault.secrets where name in ('amrap_functions_url', 'amrap_push_secret');
select vault.create_secret('http://regnotify-test.invalid/functions/v1', 'amrap_functions_url');
select vault.create_secret('test-push-secret', 'amrap_push_secret');

create temp table registered (key text primary key, id uuid not null) on commit drop;

grant select on fx to authenticated, service_role;
grant select, insert on registered to authenticated, service_role;

create temp view mine as
  select n.* from public.notifications n
  where n.kind::text = 'customer_registered'
    and (n.data ->> 'customer_id')::uuid in (select id from registered);

create function pg_temp.register(p_key text, p_name text) returns void language plpgsql as $$
begin
  perform tests.authenticate_as((select id from fx where key = 'user_' || p_key));
  insert into registered select p_key, public.register_customer(p_name, '041 000 000', 'regnotify-code-1');
  perform tests.clear_authentication();
end;
$$;

-- Definition, grants, trigger --------------------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'notify_customer_registered'),
  'true:search_path=""',
  'notify_customer_registered is security definer with an empty search_path');
select is_empty(
  $$select r from unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, 'public.notify_customer_registered()', 'EXECUTE')$$,
  'notify_customer_registered is executable by nobody but its owner');
select ok(
  exists (select 1 from pg_enum where enumtypid = 'public.notification_kind'::regtype
                                  and enumlabel = 'customer_registered'),
  'notification_kind has customer_registered');
select is(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.customers'::regclass and t.tgname = 'customers_notify_registered'),
  'CREATE TRIGGER customers_notify_registered AFTER INSERT ON public.customers FOR EACH ROW '
    || 'WHEN ((new.registered_at IS NOT NULL)) EXECUTE FUNCTION notify_customer_registered()',
  'customers_notify_registered fires after an insert with registered_at');

-- Registration -----------------------------------------------------------------------------

select pg_temp.register('one', 'Regnotify One');

select set_eq(
  $$select customer_id, data, appointment_id, transaction_id from mine$$,
  $$select (select id from trainer_recipient),
           jsonb_build_object('customer_id', (select id from registered where key = 'one'),
                              'customer_name', 'Regnotify One'),
           null::uuid as appointment_id, null::uuid as transaction_id$$,
  'a registration notifies the trainer with the customer''s id and name');
select is_empty(
  $$select 1 from public.notifications where customer_id = (select id from registered where key = 'one')$$,
  'the new customer gets no notification');
select set_eq(
  $$select jsonb_array_elements_text(convert_from(body, 'utf8')::jsonb -> 'ids')::uuid
    from net.http_request_queue where url = 'http://regnotify-test.invalid/functions/v1/send-push'$$,
  $$select id from mine$$,
  'the registration queues one request with that notification');

-- A record the trainer creates -------------------------------------------------------------

with c as (
  insert into public.customers (name, phone) values ('Regnotify by trainer', '041 111 111') returning id
) insert into registered select 'by_trainer', id from c;
select is_empty(
  $$select 1 from mine where (data ->> 'customer_id')::uuid = (select id from registered where key = 'by_trainer')$$,
  'a record the trainer creates notifies nobody');

-- A second registration --------------------------------------------------------------------

select pg_temp.register('two', 'Regnotify Two');

select is(
  (select count(*)::int from mine),
  (select count(*)::int from registered where key in ('one', 'two')),
  'two registrations write two notifications');
select set_eq(
  $$select data ->> 'customer_name' from mine$$,
  $$values ('Regnotify One'), ('Regnotify Two')$$,
  'each registration has its own notification');

-- No trainer device ------------------------------------------------------------------------

create temp table trainer_subs on commit drop as
  select s.* from public.push_subscriptions s
  join public.customers c on c.auth_user_id = s.user_id where c.role = 'trainer';
delete from public.push_subscriptions where id in (select id from trainer_subs);

select tests.authenticate_as((select id from fx where key = 'user_nosub'));
select lives_ok(
  $$insert into registered select 'nosub', public.register_customer('Regnotify Nosub', '041 000 000', 'regnotify-code-1')$$,
  'a registration succeeds when no trainer has a device');
select tests.clear_authentication();
select isnt((select registered_at from public.customers where id = (select id from registered where key = 'nosub')),
  null::timestamptz, 'that registration created the record');
select is_empty(
  $$select 1 from mine where (data ->> 'customer_id')::uuid = (select id from registered where key = 'nosub')$$,
  'without a trainer device nothing is recorded');

insert into public.push_subscriptions select * from trainer_subs;

-- Best effort ------------------------------------------------------------------------------

-- A malformed functions URL makes the pg_net call fail inside dispatch_notifications.
select vault.update_secret(id, 'not a url') from vault.secrets where name = 'amrap_functions_url';
select tests.authenticate_as((select id from fx where key = 'user_broken'));
set local client_min_messages = error;
select lives_ok(
  $$insert into registered select 'broken', public.register_customer('Regnotify Broken', '041 000 000', 'regnotify-code-1')$$,
  'a registration succeeds when its push request cannot be queued');
reset client_min_messages;
select tests.clear_authentication();
select isnt((select registered_at from public.customers where id = (select id from registered where key = 'broken')),
  null::timestamptz, 'that registration created the record');
select is(
  (select dispatched_at from mine where (data ->> 'customer_id')::uuid = (select id from registered where key = 'broken')),
  null::timestamptz, 'its customer_registered row is kept, undispatched');
select vault.update_secret(id, 'http://regnotify-test.invalid/functions/v1') from vault.secrets
  where name = 'amrap_functions_url';

create or replace function public.enqueue_notification(p_customer_id uuid, p_kind public.notification_kind,
  p_data jsonb, p_appointment_id uuid default null, p_transaction_id uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$ begin raise exception 'enqueue failed on purpose'; end; $$;

select tests.authenticate_as((select id from fx where key = 'user_failing'));
set local client_min_messages = error;
select lives_ok(
  $$insert into registered select 'failing', public.register_customer('Regnotify Failing', '041 000 000', 'regnotify-code-1')$$,
  'a registration succeeds when its notification fails');
reset client_min_messages;
select tests.clear_authentication();
select isnt((select registered_at from public.customers where id = (select id from registered where key = 'failing')),
  null::timestamptz, 'that registration created the record');

select is_empty(
  $$select 1 from mine where (data ->> 'customer_id')::uuid = (select id from registered where key = 'failing')$$,
  'the failed notification recorded nothing');

select * from finish();
rollback;
