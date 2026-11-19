-- A customer restores their own free cancel before the cutoff. Reference: docs/rpcs.md
-- (undo_cancel); decisions: docs/adr/0018-customers-do-not-book-in-first-release.md.

create function public.undo_cancel(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_trainer boolean := public.is_trainer();
  v_caller uuid := public.current_customer_id();
  v_appt public.appointments%rowtype;
  v_template public.slot_templates%rowtype;
  v_cutoff interval;
  v_rule_active boolean;
  v_occupied int;
begin
  if p_appointment_id is null then
    raise exception 'AMRAP_INVALID_ARGUMENT: p_appointment_id is required' using errcode = 'P0001';
  end if;
  if v_is_trainer or v_caller is null then
    raise exception 'AMRAP_FORBIDDEN: only a customer can undo a cancel' using errcode = 'P0001';
  end if;

  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'AMRAP_NOT_FOUND: appointment % does not exist', p_appointment_id
      using errcode = 'P0001';
  end if;
  if v_appt.customer_id <> v_caller then
    raise exception 'AMRAP_FORBIDDEN: a customer can only undo their own cancels' using errcode = 'P0001';
  end if;
  if v_appt.status <> 'cancelled' then
    raise exception 'AMRAP_NOT_UNDOABLE: appointment % is %', v_appt.id, v_appt.status
      using errcode = 'P0001';
  end if;

  select s.late_cancel_hours * interval '1 hour' into v_cutoff from public.settings s where s.id = 1;
  if not found then
    raise exception 'AMRAP_SETTINGS_MISSING: the settings row (id = 1) is missing' using errcode = 'P0001';
  end if;
  if not now() < v_appt.starts_at - v_cutoff then
    raise exception 'AMRAP_NOT_UNDOABLE: appointment % starts at %, past the cutoff',
      v_appt.id, v_appt.starts_at using errcode = 'P0001';
  end if;

  -- for share, as materialize_rule(), so a concurrent deactivate_rule() and this undo serialize.
  if v_appt.rule_id is not null then
    select r.active into v_rule_active from public.recurring_rules r where r.id = v_appt.rule_id for share;
    if not found or not v_rule_active then
      raise exception 'AMRAP_NOT_UNDOABLE: the recurring rule of appointment % is not active', v_appt.id
        using errcode = 'P0001';
    end if;
  end if;

  if v_appt.slot_template_id is not null then
    select * into v_template from public.slot_templates t where t.id = v_appt.slot_template_id;
    if not v_template.active then
      raise exception 'AMRAP_SLOT_INACTIVE: slot template % is not active', v_appt.slot_template_id
        using errcode = 'P0001';
    end if;

    -- book()'s key, so book(), cancel_occurrence() and this undo are serialized per occurrence.
    perform pg_advisory_xact_lock(
      hashtext(v_appt.slot_template_id::text || '@' || extract(epoch from v_appt.starts_at)::text));
  end if;

  if exists (
    select 1 from public.blocked_periods b
    where tstzrange(v_appt.starts_at, v_appt.ends_at) && tstzrange(b.starts_at, b.ends_at)
  ) then
    raise exception 'AMRAP_BLOCKED: % to % overlaps a blocked period', v_appt.starts_at, v_appt.ends_at
      using errcode = 'P0001';
  end if;

  if v_appt.slot_template_id is not null then
    select count(*) into v_occupied
    from public.appointments a
    where a.slot_template_id = v_appt.slot_template_id
      and a.starts_at = v_appt.starts_at
      and a.status in ('booked', 'charged');

    if v_occupied >= v_template.capacity then
      raise exception 'AMRAP_CAPACITY_FULL: slot is full (% of %)', v_occupied, v_template.capacity
        using errcode = 'P0001';
    end if;
  end if;

  begin
    update public.appointments
      set status = 'booked', cancelled_at = null
      where id = v_appt.id;
  exception when unique_violation then
    raise exception 'AMRAP_ALREADY_BOOKED: customer % already has a live booking at %',
      v_appt.customer_id, v_appt.starts_at using errcode = 'P0001';
  end;
end;
$$;

revoke execute on function public.undo_cancel(uuid) from public, anon;
grant execute on function public.undo_cancel(uuid) to authenticated, service_role;
