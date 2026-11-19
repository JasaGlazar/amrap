-- A customer's undo notifies the trainer, and a repeat cancel or undo on the same appointment is
-- pushed again. Reference: docs/notifications.md, docs/rpcs.md, docs/schema.md.

-- Not usable in this transaction; the function bodies below only resolve it when they run.
alter type public.notification_kind add value 'booking_restored';

-- Copied from 20261023215339_event_notifications.sql; only the delete before the enqueue is new:
-- without it the (kind, appointment_id) key would skip a cancel that follows an undo.
create or replace function public.notify_booking_cancelled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb;
  v_trainer uuid;
begin
  select jsonb_build_object('appointment_id', new.id, 'customer_name', c.name, 'starts_at', new.starts_at,
                            'late', new.status = 'cancelled_late',
                            'timezone', (select s.timezone from public.settings s where s.id = 1))
    into v_data
  from public.customers c where c.id = new.customer_id;

  -- One recipient, matching the (kind, appointment_id) key: the earliest trainer with a device.
  select c.id into v_trainer from public.customers c
  where c.role = 'trainer'
  order by exists (select 1 from public.push_subscriptions s where s.user_id = c.auth_user_id) desc,
           c.created_at, c.id
  limit 1;
  if v_trainer is not null then
    delete from public.notifications n where n.kind = 'booking_cancelled' and n.appointment_id = new.id;
    perform public.enqueue_notification(v_trainer, 'booking_cancelled', v_data, new.id);
  end if;
  return null;
exception when others then
  -- Best effort: a notification problem must never fail the cancel.
  raise warning 'notify_booking_cancelled failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

create function public.notify_booking_restored()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data jsonb;
  v_trainer uuid;
begin
  select jsonb_build_object('appointment_id', new.id, 'customer_name', c.name, 'starts_at', new.starts_at,
                            'timezone', (select s.timezone from public.settings s where s.id = 1))
    into v_data
  from public.customers c where c.id = new.customer_id;

  -- One recipient, matching the (kind, appointment_id) key: the earliest trainer with a device.
  select c.id into v_trainer from public.customers c
  where c.role = 'trainer'
  order by exists (select 1 from public.push_subscriptions s where s.user_id = c.auth_user_id) desc,
           c.created_at, c.id
  limit 1;
  if v_trainer is not null then
    delete from public.notifications n where n.kind = 'booking_restored' and n.appointment_id = new.id;
    perform public.enqueue_notification(v_trainer, 'booking_restored', v_data, new.id);
  end if;
  return null;
exception when others then
  -- Best effort: a notification problem must never fail the undo.
  raise warning 'notify_booking_restored failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

create trigger appointments_notify_booking_restored
  after update of status on public.appointments
  for each row when (old.status = 'cancelled' and new.status = 'booked')
  execute function public.notify_booking_restored();

revoke execute on function public.notify_booking_cancelled() from public, anon, authenticated, service_role;
revoke execute on function public.notify_booking_restored() from public, anon, authenticated, service_role;
