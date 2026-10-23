-- Core RPCs and the charge job. Reference and conventions: docs/rpcs.md, docs/jobs.md.

-- Credits ----------------------------------------------------------------------------------

create function public.top_up(p_customer_id uuid, p_amount int, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_trainer() then
    raise exception 'AMRAP_FORBIDDEN: only the trainer can top up credits' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'AMRAP_INVALID_ARGUMENT: top-up amount must be positive' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    raise exception 'AMRAP_NOT_FOUND: customer % does not exist', p_customer_id using errcode = 'P0001';
  end if;

  insert into public.credit_transactions (customer_id, amount, type, created_by, note)
  values (p_customer_id, p_amount, 'topup', auth.uid(), p_note)
  returning id into v_id;

  return v_id;
end;
$$;

create function public.adjust(p_customer_id uuid, p_amount int, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_trainer() then
    raise exception 'AMRAP_FORBIDDEN: only the trainer can adjust credits' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'AMRAP_INVALID_ARGUMENT: adjustment amount must be non-zero' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    raise exception 'AMRAP_NOT_FOUND: customer % does not exist', p_customer_id using errcode = 'P0001';
  end if;

  insert into public.credit_transactions (customer_id, amount, type, created_by, note)
  values (p_customer_id, p_amount, 'adjustment', auth.uid(), p_note)
  returning id into v_id;

  return v_id;
end;
$$;

-- Booking ----------------------------------------------------------------------------------

create function public.book(
  p_customer_id uuid,
  p_starts_at timestamptz,
  p_slot_template_id uuid default null,
  p_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_trainer boolean := public.is_trainer();
  v_caller uuid := public.current_customer_id();
  v_template public.slot_templates%rowtype;
  v_local timestamp;
  v_ends_at timestamptz;
  v_occupied int;
  v_id uuid;
begin
  if not v_is_trainer and (v_caller is null or p_customer_id is distinct from v_caller) then
    raise exception 'AMRAP_FORBIDDEN: a customer can only book for themselves' using errcode = 'P0001';
  end if;

  if p_customer_id is null or p_starts_at is null then
    raise exception 'AMRAP_INVALID_ARGUMENT: p_customer_id and p_starts_at are required'
      using errcode = 'P0001';
  end if;
  if p_slot_template_id is null and not v_is_trainer then
    raise exception 'AMRAP_INVALID_ARGUMENT: a customer must book a slot template' using errcode = 'P0001';
  end if;
  if p_slot_template_id is not null and p_ends_at is not null then
    raise exception 'AMRAP_INVALID_ARGUMENT: p_ends_at is only for ad-hoc bookings; a slot template sets the duration'
      using errcode = 'P0001';
  end if;
  if p_slot_template_id is null and (p_ends_at is null or p_ends_at <= p_starts_at) then
    raise exception 'AMRAP_INVALID_ARGUMENT: an ad-hoc booking needs p_ends_at after p_starts_at'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    raise exception 'AMRAP_NOT_FOUND: customer % does not exist', p_customer_id using errcode = 'P0001';
  end if;

  if p_slot_template_id is not null then
    select * into v_template from public.slot_templates t where t.id = p_slot_template_id;
    if not found then
      raise exception 'AMRAP_NOT_FOUND: slot template % does not exist', p_slot_template_id
        using errcode = 'P0001';
    end if;
    if not v_template.active then
      raise exception 'AMRAP_SLOT_INACTIVE: slot template % is not active', p_slot_template_id
        using errcode = 'P0001';
    end if;
    if not v_is_trainer and p_starts_at <= now() then
      raise exception 'AMRAP_IN_PAST: % is not in the future', p_starts_at using errcode = 'P0001';
    end if;

    select p_starts_at at time zone s.timezone into v_local from public.settings s where s.id = 1;
    if not found then
      raise exception 'AMRAP_SETTINGS_MISSING: the settings row (id = 1) is missing' using errcode = 'P0001';
    end if;
    if extract(isodow from v_local) - 1 <> v_template.weekday or v_local::time <> v_template.start_time then
      raise exception 'AMRAP_SLOT_MISMATCH: % is not an occurrence of slot template %',
        p_starts_at, p_slot_template_id using errcode = 'P0001';
    end if;

    v_ends_at := p_starts_at + v_template.duration_minutes * interval '1 minute';
  else
    v_ends_at := p_ends_at;
  end if;

  if exists (
    select 1 from public.blocked_periods b
    where p_starts_at >= b.starts_at and p_starts_at < b.ends_at
  ) then
    raise exception 'AMRAP_BLOCKED: % falls inside a blocked period', p_starts_at using errcode = 'P0001';
  end if;

  if p_slot_template_id is not null then
    -- Epoch, not p_starts_at::text, so the key does not depend on the session TimeZone.
    perform pg_advisory_xact_lock(
      hashtext(p_slot_template_id::text || '@' || extract(epoch from p_starts_at)::text));

    select count(*) into v_occupied
    from public.appointments a
    where a.slot_template_id = p_slot_template_id
      and a.starts_at = p_starts_at
      and a.status in ('booked', 'charged');

    if v_occupied >= v_template.capacity then
      raise exception 'AMRAP_CAPACITY_FULL: slot is full (% of %)', v_occupied, v_template.capacity
        using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.appointments (customer_id, slot_template_id, starts_at, ends_at, source)
    values (p_customer_id, p_slot_template_id, p_starts_at, v_ends_at,
            case when v_is_trainer then 'trainer' else 'self_booked' end::public.appointment_source)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'AMRAP_ALREADY_BOOKED: customer % already has a live booking at %',
      p_customer_id, p_starts_at using errcode = 'P0001';
  end;

  return v_id;
end;
$$;

-- Cancelling -------------------------------------------------------------------------------

create function public.cancel(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_trainer boolean := public.is_trainer();
  v_caller uuid := public.current_customer_id();
  v_appt public.appointments%rowtype;
  v_cutoff interval;
begin
  if not v_is_trainer and v_caller is null then
    raise exception 'AMRAP_FORBIDDEN: only a customer or the trainer can cancel' using errcode = 'P0001';
  end if;

  select * into v_appt from public.appointments a where a.id = p_appointment_id for update;
  if not found then
    raise exception 'AMRAP_NOT_FOUND: appointment % does not exist', p_appointment_id
      using errcode = 'P0001';
  end if;

  if v_is_trainer then
    if v_appt.status = 'booked' then
      update public.appointments
        set status = 'cancelled_by_trainer', cancelled_at = now()
        where id = v_appt.id;
    elsif v_appt.status = 'charged' then
      update public.appointments
        set status = 'cancelled_by_trainer', cancelled_at = now()
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

-- Charge job -------------------------------------------------------------------------------

create function public.charge_due_appointments()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charged int;
begin
  with due as (
    select a.id
    from public.appointments a
    where a.status = 'booked' and a.starts_at <= now()
    for update skip locked
  ),
  charged as (
    update public.appointments a
      set status = 'charged'
      from due
      where a.id = due.id
      returning a.id, a.customer_id
  )
  insert into public.credit_transactions (customer_id, amount, type, appointment_id, created_by)
  select charged.customer_id, -1, 'session', charged.id, null
  from charged;

  get diagnostics v_charged = row_count;
  return v_charged;
end;
$$;

-- Invites ----------------------------------------------------------------------------------

create function public.create_invite(p_customer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.is_trainer() then
    raise exception 'AMRAP_FORBIDDEN: only the trainer can create invites' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers c where c.id = p_customer_id for update;
  if not found then
    raise exception 'AMRAP_NOT_FOUND: customer % does not exist', p_customer_id using errcode = 'P0001';
  end if;
  if v_customer.auth_user_id is not null then
    raise exception 'AMRAP_ALREADY_LINKED: customer % already has an account', p_customer_id
      using errcode = 'P0001';
  end if;
  -- Redeeming an invite for an unlinked trainer record would hand out trainer access.
  if v_customer.role <> 'customer' then
    raise exception 'AMRAP_INVALID_ARGUMENT: record % is not a customer record', p_customer_id
      using errcode = 'P0001';
  end if;

  update public.customers
    set invite_token = v_token, invite_expires_at = now() + interval '7 days'
    where id = p_customer_id;

  return v_token;
end;
$$;

create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AMRAP_FORBIDDEN: accepting an invite needs a signed-in user' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers c where c.invite_token = p_token for update;
  if not found or v_customer.invite_expires_at is null or v_customer.invite_expires_at <= now() then
    raise exception 'AMRAP_INVITE_INVALID: the invite token is unknown or expired' using errcode = 'P0001';
  end if;
  if v_customer.auth_user_id is not null then
    raise exception 'AMRAP_INVITE_USED: the invite has already been accepted' using errcode = 'P0001';
  end if;
  if public.current_customer_id() is not null then
    raise exception 'AMRAP_ALREADY_LINKED: this user is already linked to a customer' using errcode = 'P0001';
  end if;

  -- The same user redeeming another token concurrently can link first and pass the check above.
  begin
    update public.customers
      set auth_user_id = auth.uid(), invite_token = null, invite_expires_at = null
      where id = v_customer.id;
  exception when unique_violation then
    raise exception 'AMRAP_ALREADY_LINKED: this user is already linked to a customer' using errcode = 'P0001';
  end;

  return v_customer.id;
end;
$$;

-- Grants -----------------------------------------------------------------------------------

revoke execute on function public.top_up(uuid, int, text) from public, anon;
revoke execute on function public.adjust(uuid, int, text) from public, anon;
grant execute on function public.top_up(uuid, int, text) to authenticated, service_role;
grant execute on function public.adjust(uuid, int, text) to authenticated, service_role;
revoke execute on function public.book(uuid, timestamptz, uuid, timestamptz) from public, anon;
grant execute on function public.book(uuid, timestamptz, uuid, timestamptz) to authenticated, service_role;
revoke execute on function public.cancel(uuid) from public, anon;
grant execute on function public.cancel(uuid) to authenticated, service_role;
revoke execute on function public.create_invite(uuid) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.create_invite(uuid) to authenticated, service_role;
grant execute on function public.accept_invite(text) to authenticated, service_role;
revoke execute on function public.charge_due_appointments() from public, anon, authenticated;
grant execute on function public.charge_due_appointments() to service_role;
