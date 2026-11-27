-- A registration (register_customer()) notifies the trainer. Reference: docs/notifications.md,
-- docs/rpcs.md, docs/schema.md.

-- Not usable in this transaction; the function body below only resolves it when it runs.
alter type public.notification_kind add value 'customer_registered';

create function public.notify_customer_registered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trainer uuid;
begin
  -- The earliest trainer with a device, as for the other trainer notifications.
  select c.id into v_trainer from public.customers c
  where c.role = 'trainer'
  order by exists (select 1 from public.push_subscriptions s where s.user_id = c.auth_user_id) desc,
           c.created_at, c.id
  limit 1;
  if v_trainer is not null then
    perform public.enqueue_notification(v_trainer, 'customer_registered',
                                        jsonb_build_object('customer_id', new.id, 'customer_name', new.name));
  end if;
  return null;
exception when others then
  -- Best effort: a notification problem must never fail the registration.
  raise warning 'notify_customer_registered failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

create trigger customers_notify_registered
  after insert on public.customers
  for each row when (new.registered_at is not null)
  execute function public.notify_customer_registered();

revoke execute on function public.notify_customer_registered() from public, anon, authenticated, service_role;
