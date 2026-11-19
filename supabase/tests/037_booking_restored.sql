-- booking_restored: a customer's undo (cancelled -> booked) notifies the trainer with the
-- customer's name, the start and the timezone; the customer gets nothing. A repeat cancel or
-- undo on the same appointment replaces the earlier row of its kind, so each change is pushed.
-- Nothing is recorded without a trainer device, and a failing notification never fails the
-- status change.
--
-- Appointments are inserted directly as the test superuser with their final status, with starts
-- derived from now() (frozen for the transaction) and the configured cutoff.
begin;

select plan(24);

-- Fixtures ---------------------------------------------------------------------------------

delete from public.blocked_periods;

create temp table fx (key text primary key, id uuid not null) on commit drop;

insert into fx (key, id) values
  ('trainer_user', tests.create_user('restored-trainer@test.local')),
  ('user_a', tests.create_user('restored-a@test.local'));

with c as (
  insert into public.customers (name, role, auth_user_id)
  select 'Restored trainer', 'trainer', id from fx where key = 'trainer_user'
  returning id
) insert into fx select 'trainer', id from c;
with c as (
  insert into public.customers (name, auth_user_id)
  select 'Restored A', id from fx where key = 'user_a'
  returning id
) insert into fx select 'cust_a', id from c;

-- The trainer and customer A have a device, so A's empty result is not for lack of one.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://push.test.invalid/restored-' || key, 'p256dh', 'auth'
  from fx where key in ('trainer_user', 'user_a');

create temp view trainer_recipient as
  select c.id from public.customers c
  where c.role = 'trainer'
    and exists (select 1 from public.push_subscriptions s where s.user_id = c.auth_user_id)
  order by c.created_at, c.id
  limit 1;

create temp table cutoff as
  select late_cancel_hours * interval '1 hour' as cutoff from public.settings where id = 1;

create temp table appts (key text primary key, id uuid not null) on commit drop;
with spec as (
  select v.key, now() + cutoff.cutoff + v.ahead as starts_at, v.status
  from cutoff,
       lateral (values
         ('restore', interval '2 days', 'cancelled'::public.appointment_status),
         ('nosub', interval '3 days', 'cancelled'),
         ('repeat', interval '4 days', 'booked'),
         ('late', interval '5 days', 'cancelled_late'),
         ('broken_url', interval '6 days', 'cancelled'),
         ('failing', interval '7 days', 'cancelled')
       ) v(key, ahead, status)
), ins as (
  insert into public.appointments (customer_id, starts_at, ends_at, status, source, cancelled_at)
  select (select id from fx where key = 'cust_a'), s.starts_at, s.starts_at + interval '1 hour', s.status,
         'trainer', case when s.status = 'booked' then null else now() - interval '1 day' end
  from spec s
  returning id, starts_at
)
insert into appts select s.key, ins.id from ins join spec s on s.starts_at = ins.starts_at;

delete from vault.secrets where name in ('amrap_functions_url', 'amrap_push_secret');
select vault.create_secret('http://restored-test.invalid/functions/v1', 'amrap_functions_url');
select vault.create_secret('test-push-secret', 'amrap_push_secret');

grant select on fx, appts, cutoff to authenticated, service_role;

create temp view mine as
  select n.* from public.notifications n where n.appointment_id in (select id from appts);

-- Definition, grants, trigger --------------------------------------------------------------

select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'notify_booking_restored'),
  'true:search_path=""',
  'notify_booking_restored is security definer with an empty search_path');
select is_empty(
  $$select r from unnest(array['anon', 'authenticated', 'service_role']) r, pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'notify_booking_restored'
      and has_function_privilege(r, p.oid, 'EXECUTE')$$,
  'notify_booking_restored is executable by nobody but its owner');
select ok(
  exists (select 1 from pg_enum where enumtypid = 'public.notification_kind'::regtype
                                  and enumlabel = 'booking_restored'),
  'notification_kind has booking_restored');

-- Undo -------------------------------------------------------------------------------------

select tests.authenticate_as((select id from fx where key = 'user_a'));
select public.undo_cancel((select id from appts where key = 'restore'));
select tests.clear_authentication();

select set_eq(
  $$select customer_id, kind::text, data from mine where appointment_id = (select id from appts where key = 'restore')$$,
  $$select (select id from trainer_recipient), 'booking_restored',
           jsonb_build_object('appointment_id', a.id, 'customer_name', 'Restored A', 'starts_at', a.starts_at,
                              'timezone', (select s.timezone from public.settings s where s.id = 1))
    from public.appointments a where a.id = (select id from appts where key = 'restore')$$,
  'a customer''s undo notifies the trainer with the name, start and timezone');
select is_empty(
  $$select 1 from public.notifications where customer_id = (select id from fx where key = 'cust_a')$$,
  'the customer gets no notification for their own undo');
select set_eq(
  $$select jsonb_array_elements_text(convert_from(body, 'utf8')::jsonb -> 'ids')::uuid
    from net.http_request_queue where url = 'http://restored-test.invalid/functions/v1/send-push'$$,
  $$select id from mine where appointment_id = (select id from appts where key = 'restore')$$,
  'the undo queues one request with that notification');

-- A status change other than cancelled -> booked does not fire the trigger.
update public.appointments set status = 'booked', cancelled_at = null
  where id = (select id from appts where key = 'late');
select is_empty(
  $$select 1 from mine where appointment_id = (select id from appts where key = 'late')$$,
  'cancelled_late -> booked notifies nobody');

-- No trainer device ------------------------------------------------------------------------

create temp table trainer_subs on commit drop as
  select s.* from public.push_subscriptions s
  join public.customers c on c.auth_user_id = s.user_id where c.role = 'trainer';
delete from public.push_subscriptions where id in (select id from trainer_subs);

select tests.authenticate_as((select id from fx where key = 'user_a'));
select lives_ok($$select public.undo_cancel((select id from appts where key = 'nosub'))$$,
  'an undo succeeds when no trainer has a device');
select tests.clear_authentication();
select is((select status::text from public.appointments where id = (select id from appts where key = 'nosub')),
  'booked', 'that undo took effect');
select is_empty(
  $$select 1 from mine where appointment_id = (select id from appts where key = 'nosub')$$,
  'without a trainer device nothing is recorded');

insert into public.push_subscriptions select * from trainer_subs;

-- Cancel, undo, cancel, undo: each change is pushed --------------------------------------

create temp table steps (n int primary key, action text not null, kind text not null) on commit drop;
insert into steps values (1, 'cancel', 'booking_cancelled'), (2, 'undo', 'booking_restored'),
                         (3, 'cancel', 'booking_cancelled'), (4, 'undo', 'booking_restored');
create temp table seen (n int not null, kind text not null, id uuid not null) on commit drop;

create function pg_temp.run_step(p_n int) returns void language plpgsql as $$
declare
  v_action text := (select action from steps where n = p_n);
  v_appt uuid := (select id from appts where key = 'repeat');
begin
  perform tests.authenticate_as((select id from fx where key = 'user_a'));
  if v_action = 'cancel' then
    perform public.cancel(v_appt);
  else
    perform public.undo_cancel(v_appt);
  end if;
  perform tests.clear_authentication();
end;
$$;

-- The undispatched row of the step's kind for the repeat appointment.
create temp view pending as
  select n.id, n.kind::text as kind from public.notifications n
  where n.appointment_id = (select id from appts where key = 'repeat') and n.dispatched_at is null;

select pg_temp.run_step(1);
select is((select count(*)::int from pending where kind = (select kind from steps where n = 1)), 1,
  'step 1 (cancel) leaves one undispatched booking_cancelled row');
select ok((select id from pending where kind = (select kind from steps where n = 1)) not in (select id from seen),
  'step 1 wrote a new row');
insert into seen select 1, kind, id from pending where kind = (select kind from steps where n = 1);
update public.notifications set dispatched_at = now() where id in (select id from seen where n = 1);

select pg_temp.run_step(2);
select is((select count(*)::int from pending where kind = (select kind from steps where n = 2)), 1,
  'step 2 (undo) leaves one undispatched booking_restored row');
select ok((select id from pending where kind = (select kind from steps where n = 2)) not in (select id from seen),
  'step 2 wrote a new row');
insert into seen select 2, kind, id from pending where kind = (select kind from steps where n = 2);
update public.notifications set dispatched_at = now() where id in (select id from seen where n = 2);

select pg_temp.run_step(3);
select is((select count(*)::int from pending where kind = (select kind from steps where n = 3)), 1,
  'step 3 (second cancel) leaves one undispatched booking_cancelled row');
select ok((select id from pending where kind = (select kind from steps where n = 3)) not in (select id from seen),
  'step 3 wrote a new row, not the dispatched one from step 1');
insert into seen select 3, kind, id from pending where kind = (select kind from steps where n = 3);
update public.notifications set dispatched_at = now() where id in (select id from seen where n = 3);

select pg_temp.run_step(4);
select is((select count(*)::int from pending where kind = (select kind from steps where n = 4)), 1,
  'step 4 (second undo) leaves one undispatched booking_restored row');
select ok((select id from pending where kind = (select kind from steps where n = 4)) not in (select id from seen),
  'step 4 wrote a new row, not the dispatched one from step 2');
insert into seen select 4, kind, id from pending where kind = (select kind from steps where n = 4);

select set_eq(
  $$select kind, count(distinct id)::int from seen group by kind$$,
  $$select kind, count(*)::int from steps group by kind$$,
  'one distinct notification per change, of the change''s kind');
select set_eq(
  $$select jsonb_array_elements_text(convert_from(body, 'utf8')::jsonb -> 'ids')::uuid
    from net.http_request_queue where url = 'http://restored-test.invalid/functions/v1/send-push'
    intersect select id from seen$$,
  $$select id from seen$$,
  'every change queued a push request for its own notification');

-- Best effort ------------------------------------------------------------------------------

-- A malformed functions URL makes the pg_net call fail inside dispatch_notifications.
select vault.update_secret(id, 'not a url') from vault.secrets where name = 'amrap_functions_url';
set local client_min_messages = error;
select lives_ok(
  $$update public.appointments set status = 'booked', cancelled_at = null
    where id = (select id from appts where key = 'broken_url')$$,
  'cancelled -> booked succeeds when its push request cannot be queued');
reset client_min_messages;
select is((select status::text from public.appointments where id = (select id from appts where key = 'broken_url')),
  'booked', 'that status change took effect');
select vault.update_secret(id, 'http://restored-test.invalid/functions/v1') from vault.secrets
  where name = 'amrap_functions_url';

create or replace function public.enqueue_notification(p_customer_id uuid, p_kind public.notification_kind,
  p_data jsonb, p_appointment_id uuid default null, p_transaction_id uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$ begin raise exception 'enqueue failed on purpose'; end; $$;

set local client_min_messages = error;
select lives_ok(
  $$update public.appointments set status = 'booked', cancelled_at = null
    where id = (select id from appts where key = 'failing')$$,
  'cancelled -> booked succeeds when its notification fails');
reset client_min_messages;
select is((select status::text from public.appointments where id = (select id from appts where key = 'failing')),
  'booked', 'that status change took effect');

select * from finish();
rollback;
