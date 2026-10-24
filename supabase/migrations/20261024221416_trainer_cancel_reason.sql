-- A trainer cancel takes an optional reason and notifies the customer. Reference: docs/rpcs.md,
-- docs/schema.md, docs/notifications.md; decisions: docs/adr/0015-trainer-cancel-notifies-customer.md.

-- Reason -----------------------------------------------------------------------------------

alter table public.appointments
  add column cancel_reason text,
  add constraint appointments_cancel_reason_check check (
    cancel_reason is null
    or (char_length(cancel_reason) between 1 and 200 and cancel_reason = btrim(cancel_reason, E' \t\r\n'))
  );

-- Not usable in this transaction; the function bodies below only resolve it when they run.
alter type public.notification_kind add value 'appointment_cancelled_by_trainer';

-- Cancelling -------------------------------------------------------------------------------

-- A new parameter is a new signature, so the old function is dropped rather than replaced.
drop function public.cancel(uuid);

create function public.cancel(p_appointment_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_trainer boolean := public.is_trainer();
  v_caller uuid := public.current_customer_id();
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
  v_appt public.appointments%rowtype;
  v_cutoff interval;
begin
  if not v_is_trainer and v_caller is null then
    raise exception 'AMRAP_FORBIDDEN: only a customer or the trainer can cancel' using errcode = 'P0001';
  end if;
  if not v_is_trainer and p_reason is not null then
    raise exception 'AMRAP_FORBIDDEN: only the trainer can give a cancel reason' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'AMRAP_INVALID_ARGUMENT: the reason is longer than 200 characters' using errcode = 'P0001';
  end if;

  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'AMRAP_NOT_FOUND: appointment % does not exist', p_appointment_id
      using errcode = 'P0001';
  end if;

  if v_is_trainer then
    if v_appt.status = 'booked' then
      update public.appointments
        set status = 'cancelled_by_trainer', cancelled_at = now(), cancel_reason = v_reason
        where id = v_appt.id;
    elsif v_appt.status = 'charged' then
      update public.appointments
        set status = 'cancelled_by_trainer', cancelled_at = now(), cancel_reason = v_reason
        where id = v_appt.id;
      insert into public.credit_transactions (customer_id, amount, type, appointment_id, created_by)
      values (v_appt.customer_id, 1, 'refund', v_appt.id, auth.uid());
    else
      raise exception 'AMRAP_NOT_CANCELLABLE: appointment % is already %', v_appt.id, v_appt.status
        using errcode = 'P0001';
    end if;
    return;
  end if;

  if v_appt.customer_id <> v_caller then
    raise exception 'AMRAP_FORBIDDEN: a customer can only cancel their own appointments'
      using errcode = 'P0001';
  end if;
  if v_appt.status <> 'booked' or v_appt.starts_at <= now() then
    raise exception 'AMRAP_NOT_CANCELLABLE: appointment % is % and starts at %',
      v_appt.id, v_appt.status, v_appt.starts_at using errcode = 'P0001';
  end if;

  select s.late_cancel_hours * interval '1 hour' into v_cutoff from public.settings s where s.id = 1;
  if not found then
    raise exception 'AMRAP_SETTINGS_MISSING: the settings row (id = 1) is missing' using errcode = 'P0001';
  end if;

  if now() < v_appt.starts_at - v_cutoff then
    update public.appointments
      set status = 'cancelled', cancelled_at = now()
      where id = v_appt.id;
  else
    update public.appointments
      set status = 'cancelled_late', cancelled_at = now()
      where id = v_appt.id;
    insert into public.credit_transactions (customer_id, amount, type, appointment_id, created_by)
    values (v_appt.customer_id, -1, 'late_cancel', v_appt.id, auth.uid());
  end if;
end;
$$;

-- Notification -----------------------------------------------------------------------------

create function public.notify_cancelled_by_trainer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The refund row is inserted after the status update, so it is derived from the old status.
  perform public.enqueue_notification(
    new.customer_id,
    'appointment_cancelled_by_trainer',
    jsonb_build_object('appointment_id', new.id, 'starts_at', new.starts_at,
                       'timezone', (select s.timezone from public.settings s where s.id = 1),
                       'refunded', old.status = 'charged', 'reason', new.cancel_reason),
    new.id
  );
  return null;
exception when others then
  -- Best effort: a notification problem must never fail the cancel.
  raise warning 'notify_cancelled_by_trainer failed: % (%)', sqlerrm, sqlstate;
  return null;
end;
$$;

create trigger appointments_notify_cancelled_by_trainer
  after update of status on public.appointments
  for each row when (old.status in ('booked', 'charged') and new.status = 'cancelled_by_trainer')
  execute function public.notify_cancelled_by_trainer();

-- Grants -----------------------------------------------------------------------------------

revoke execute on function public.cancel(uuid, text) from public, anon;
grant execute on function public.cancel(uuid, text) to authenticated, service_role;
revoke execute on function public.notify_cancelled_by_trainer() from public, anon, authenticated, service_role;
