-- Event notifications (bookings, cancels, credits) and saving a push subscription. Reference:
-- docs/notifications.md, docs/rpcs.md, docs/schema.md; decisions: docs/adr/0009-web-push-design.md.

-- Enqueue ----------------------------------------------------------------------------------

create function public.enqueue_notification(
  p_customer_id uuid,
  p_kind public.notification_kind,
  p_data jsonb,
  p_appointment_id uuid default null,
  p_transaction_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_id uuid;
begin
  select c.functions_url, c.push_secret into v_url, v_secret from public.push_config() c;
  if v_url is null or v_secret is null then
    raise log 'enqueue_notification: push is not configured, % not recorded', p_kind;
    return;
  end if;

  if not exists (
    select 1 from public.customers c
    join public.push_subscriptions s on s.user_id = c.auth_user_id
    where c.id = p_customer_id
  ) then
    return;
  end if;

  insert into public.notifications (customer_id, kind, appointment_id, transaction_id, data)
  values (p_customer_id, p_kind, p_appointment_id, p_transaction_id, p_data)
  on conflict (kind, appointment_id) do nothing
  returning id into v_id;

  if v_id is not null then
    perform public.dispatch_notifications(array[v_id]);
  end if;
end;
$$;

-- Trigger functions ------------------------------------------------------------------------

create function public.notify_booking_created()
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

  for v_trainer in select c.id from public.customers c where c.role = 'trainer' order by c.created_at loop
    perform public.enqueue_notification(v_trainer, 'booking_created', v_data, new.id);
  end loop;
  return null;
exception when others then
  -- Best effort: a notification problem must never fail the booking.
  raise warning 'notify_booking_created failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

create function public.notify_booking_cancelled()
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

  for v_trainer in select c.id from public.customers c where c.role = 'trainer' order by c.created_at loop
    perform public.enqueue_notification(v_trainer, 'booking_cancelled', v_data, new.id);
  end loop;
  return null;
exception when others then
  -- Best effort: a notification problem must never fail the cancel.
  raise warning 'notify_booking_cancelled failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

create function public.notify_credit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  select coalesce(sum(t.amount), 0) into v_balance
  from public.credit_transactions t where t.customer_id = new.customer_id;

  perform public.enqueue_notification(
    new.customer_id,
    case new.type when 'topup' then 'credit_topup' else 'credit_adjustment' end::public.notification_kind,
    jsonb_build_object('transaction_id', new.id, 'amount', new.amount, 'note', new.note, 'balance', v_balance),
    null,
    new.id
  );
  return null;
exception when others then
  -- Best effort: a notification problem must never fail the top-up or adjustment.
  raise warning 'notify_credit_change failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

create trigger appointments_notify_booking_created
  after insert on public.appointments
  for each row when (new.source = 'self_booked')
  execute function public.notify_booking_created();

create trigger appointments_notify_booking_cancelled
  after update of status on public.appointments
  for each row when (old.status = 'booked' and new.status in ('cancelled', 'cancelled_late'))
  execute function public.notify_booking_cancelled();

create trigger credit_transactions_notify_credit_change
  after insert on public.credit_transactions
  for each row when (new.type in ('topup', 'adjustment'))
  execute function public.notify_credit_change();

-- Push subscriptions -----------------------------------------------------------------------

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.current_customer_id() is null then
    raise exception 'AMRAP_FORBIDDEN: only a linked customer or the trainer can save a push subscription'
      using errcode = 'P0001';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'AMRAP_INVALID_ARGUMENT: endpoint, p256dh and auth are required' using errcode = 'P0001';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end;
$$;

-- Grants -----------------------------------------------------------------------------------

revoke execute on function public.enqueue_notification(uuid, public.notification_kind, jsonb, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.notify_booking_created() from public, anon, authenticated, service_role;
revoke execute on function public.notify_booking_cancelled() from public, anon, authenticated, service_role;
revoke execute on function public.notify_credit_change() from public, anon, authenticated, service_role;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated, service_role;
