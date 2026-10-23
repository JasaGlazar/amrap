-- Notification log, push dispatch and the pre-cutoff reminder job. Reference:
-- docs/notifications.md, docs/rpcs.md, docs/schema.md, docs/jobs.md; decisions:
-- docs/adr/0009-web-push-design.md.

-- Supabase's Security Advisor flags pg_net in public.
create extension if not exists pg_net with schema extensions;

-- Notification log -------------------------------------------------------------------------

create type public.notification_kind as enum (
  'cutoff_reminder', 'booking_created', 'booking_cancelled', 'credit_topup', 'credit_adjustment'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind public.notification_kind not null,
  appointment_id uuid references public.appointments (id) on delete cascade,
  transaction_id uuid references public.credit_transactions (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  constraint notifications_kind_appointment_id_key unique (kind, appointment_id)
);

create index notifications_created_at_idx on public.notifications (created_at);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

-- Dispatch ---------------------------------------------------------------------------------

create function public.push_config()
returns table (functions_url text, push_secret text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select nullif(s.decrypted_secret, '') from vault.decrypted_secrets s where s.name = 'amrap_functions_url'),
    (select nullif(s.decrypted_secret, '') from vault.decrypted_secrets s where s.name = 'amrap_push_secret');
$$;

create function public.dispatch_notifications(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if coalesce(cardinality(p_ids), 0) = 0 then
    return;
  end if;

  select c.functions_url, c.push_secret into v_url, v_secret from public.push_config() c;
  if v_url is null or v_secret is null then
    raise log 'dispatch_notifications: push is not configured, % notification(s) not sent', cardinality(p_ids);
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/send-push',
    body := jsonb_build_object('ids', p_ids),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-amrap-push-secret', v_secret),
    timeout_milliseconds := 10000
  );
exception when others then
  -- Best effort: a push problem must never abort the booking, cancel or job that queued it.
  raise warning 'dispatch_notifications failed: % (%)', sqlerrm, sqlstate;
end;
$$;

create function public.claim_notifications(p_ids uuid[])
returns table (notification_id uuid, kind public.notification_kind, data jsonb,
               endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.notifications n
      set dispatched_at = now()
      where n.id = any(p_ids) and n.dispatched_at is null
      returning n.id, n.kind, n.data, n.customer_id
  )
  select c.id, c.kind, c.data, s.endpoint, s.p256dh, s.auth
  from claimed c
  join public.customers cu on cu.id = c.customer_id
  join public.push_subscriptions s on s.user_id = cu.auth_user_id;
$$;

-- Pre-cutoff reminders ---------------------------------------------------------------------

create function public.send_cutoff_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_settings public.settings%rowtype;
  v_cutoff interval;
  v_ids uuid[];
begin
  delete from public.notifications n where n.created_at < now() - interval '30 days';

  select c.functions_url, c.push_secret into v_url, v_secret from public.push_config() c;
  if v_url is null or v_secret is null then
    raise log 'send_cutoff_reminders: push is not configured, no reminders recorded';
    return 0;
  end if;

  select * into v_settings from public.settings s where s.id = 1;
  if not found then
    raise log 'send_cutoff_reminders: settings row missing, no reminders recorded';
    return 0;
  end if;
  v_cutoff := v_settings.late_cancel_hours * interval '1 hour';

  with due as (
    select a.id, a.customer_id, a.starts_at
    from public.appointments a
    join public.customers c on c.id = a.customer_id
    where a.status = 'booked'
      and a.starts_at >= now() + interval '45 minutes' + v_cutoff
      and a.starts_at < now() + interval '75 minutes' + v_cutoff
      and exists (select 1 from public.push_subscriptions s where s.user_id = c.auth_user_id)
  ),
  inserted as (
    insert into public.notifications (customer_id, kind, appointment_id, data)
    select d.customer_id, 'cutoff_reminder', d.id,
           jsonb_build_object('appointment_id', d.id, 'starts_at', d.starts_at,
                              'cutoff_at', d.starts_at - v_cutoff, 'timezone', v_settings.timezone)
    from due d
    on conflict (kind, appointment_id) do nothing
    returning id
  )
  select coalesce(array_agg(i.id), '{}') into v_ids from inserted i;

  perform public.dispatch_notifications(v_ids);
  return cardinality(v_ids);
end;
$$;

-- Grants -----------------------------------------------------------------------------------

revoke execute on function public.push_config() from public, anon, authenticated, service_role;
revoke execute on function public.dispatch_notifications(uuid[]) from public, anon, authenticated, service_role;
revoke execute on function public.claim_notifications(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_notifications(uuid[]) to service_role;
revoke execute on function public.send_cutoff_reminders() from public, anon, authenticated;
grant execute on function public.send_cutoff_reminders() to service_role;

-- Schedule (pg_cron) -----------------------------------------------------------------------

select cron.schedule('send_cutoff_reminders', '*/15 * * * *',
                     $$select public.send_cutoff_reminders()$$);
