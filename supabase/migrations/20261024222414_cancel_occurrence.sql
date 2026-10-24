-- Cancel a whole slot occurrence and close it. Reference: docs/rpcs.md, docs/schema.md;
-- decisions: docs/adr/0016-cancel-occurrence-closes-it.md.

-- Booking and materialization: the blocked check after the advisory lock ---------------------

-- create or replace keeps the existing grants; only the order of the lock and the check changed.
create or replace function public.book(
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

  if p_slot_template_id is not null then
    -- Epoch, not p_starts_at::text, so the key does not depend on the session TimeZone.
    -- Taken before the blocked check, so a concurrent cancel_occurrence() is seen once it commits.
    perform pg_advisory_xact_lock(
      hashtext(p_slot_template_id::text || '@' || extract(epoch from p_starts_at)::text));
  end if;

  if exists (
    select 1 from public.blocked_periods b
    where tstzrange(p_starts_at, v_ends_at) && tstzrange(b.starts_at, b.ends_at)
  ) then
    raise exception 'AMRAP_BLOCKED: % to % overlaps a blocked period', p_starts_at, v_ends_at
      using errcode = 'P0001';
  end if;

  if p_slot_template_id is not null then
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

create or replace function public.materialize_rule(p_rule_id uuid, p_weeks int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.recurring_rules%rowtype;
  v_template public.slot_templates%rowtype;
  v_tz text;
  v_today date;
  v_day date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_occupied int;
  v_inserted int := 0;
begin
  select s.timezone into v_tz from public.settings s where s.id = 1;
  if not found then
    raise exception 'AMRAP_SETTINGS_MISSING: the settings row (id = 1) is missing' using errcode = 'P0001';
  end if;

  select * into v_rule from public.recurring_rules r where r.id = p_rule_id for share;
  if not found or not v_rule.active then
    return 0;
  end if;
  select * into v_template from public.slot_templates t where t.id = v_rule.slot_template_id;
  if not v_template.active then
    return 0;
  end if;

  v_today := (now() at time zone v_tz)::date;

  for v_day in
    select v_today + n from generate_series(0, p_weeks * 7) n
    where extract(isodow from v_today + n) - 1 = v_template.weekday
    order by n
  loop
    v_starts_at := (v_day + v_template.start_time) at time zone v_tz;
    v_ends_at := v_starts_at + v_template.duration_minutes * interval '1 minute';

    continue when v_starts_at <= now();
    continue when (v_starts_at at time zone v_tz)::time <> v_template.start_time;
    -- The same key as book(), so a run and a booking of one occurrence are serialized; the
    -- blocked check follows it, so a concurrent cancel_occurrence() is seen once it commits.
    perform pg_advisory_xact_lock(
      hashtext(v_template.id::text || '@' || extract(epoch from v_starts_at)::text));

    continue when exists (
      select 1 from public.blocked_periods b
      where tstzrange(v_starts_at, v_ends_at) && tstzrange(b.starts_at, b.ends_at)
    );

    continue when exists (
      select 1 from public.appointments a
      where a.rule_id = p_rule_id and a.starts_at = v_starts_at
    );
    continue when exists (
      select 1 from public.appointments a
      where a.customer_id = v_rule.customer_id and a.starts_at = v_starts_at
        and a.status in ('booked', 'charged')
    );

    select count(*) into v_occupied
    from public.appointments a
    where a.slot_template_id = v_template.id
      and a.starts_at = v_starts_at
      and a.status in ('booked', 'charged');
    continue when v_occupied >= v_template.capacity;

    insert into public.appointments
      (customer_id, slot_template_id, starts_at, ends_at, status, source, rule_id)
    values
      (v_rule.customer_id, v_template.id, v_starts_at, v_ends_at, 'booked', 'recurring', p_rule_id)
    on conflict do nothing;
    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return v_inserted;
end;
$$;

-- Cancelling an occurrence -----------------------------------------------------------------

create function public.cancel_occurrence(
  p_template_id uuid,
  p_starts_at timestamptz,
  p_reason text default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(p_reason, E' \t\r\n'), '');
  v_template public.slot_templates%rowtype;
  v_local timestamp;
  v_ends_at timestamptz;
  v_booked int;
  v_charged int;
begin
  if not public.is_trainer() then
    raise exception 'AMRAP_FORBIDDEN: only the trainer can cancel an occurrence' using errcode = 'P0001';
  end if;
  if p_template_id is null or p_starts_at is null then
    raise exception 'AMRAP_INVALID_ARGUMENT: p_template_id and p_starts_at are required' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'AMRAP_INVALID_ARGUMENT: the reason is longer than 200 characters' using errcode = 'P0001';
  end if;

  select * into v_template from public.slot_templates t where t.id = p_template_id;
  if not found then
    raise exception 'AMRAP_NOT_FOUND: slot template % does not exist', p_template_id using errcode = 'P0001';
  end if;
  if not v_template.active then
    raise exception 'AMRAP_SLOT_INACTIVE: slot template % is not active', p_template_id using errcode = 'P0001';
  end if;

  select p_starts_at at time zone s.timezone into v_local from public.settings s where s.id = 1;
  if not found then
    raise exception 'AMRAP_SETTINGS_MISSING: the settings row (id = 1) is missing' using errcode = 'P0001';
  end if;
  if extract(isodow from v_local) - 1 <> v_template.weekday or v_local::time <> v_template.start_time then
    raise exception 'AMRAP_SLOT_MISMATCH: % is not an occurrence of slot template %',
      p_starts_at, p_template_id using errcode = 'P0001';
  end if;
  v_ends_at := p_starts_at + v_template.duration_minutes * interval '1 minute';

  perform pg_advisory_xact_lock(
    hashtext(p_template_id::text || '@' || extract(epoch from p_starts_at)::text));

  if exists (
    select 1 from public.blocked_periods b
    where tstzrange(p_starts_at, v_ends_at) && tstzrange(b.starts_at, b.ends_at)
  ) then
    raise exception 'AMRAP_BLOCKED: % to % already overlaps a blocked period', p_starts_at, v_ends_at
      using errcode = 'P0001';
  end if;

  -- Booked first: a row the charge job charges meanwhile is then caught by the charged update.
  update public.appointments
    set status = 'cancelled_by_trainer', cancelled_at = now(), cancel_reason = v_reason
    where slot_template_id = p_template_id and starts_at = p_starts_at and status = 'booked';
  get diagnostics v_booked = row_count;

  with charged as (
    update public.appointments
      set status = 'cancelled_by_trainer', cancelled_at = now(), cancel_reason = v_reason
      where slot_template_id = p_template_id and starts_at = p_starts_at and status = 'charged'
      returning id, customer_id
  )
  insert into public.credit_transactions (customer_id, amount, type, appointment_id, created_by)
  select charged.customer_id, 1, 'refund', charged.id, auth.uid() from charged;
  get diagnostics v_charged = row_count;

  insert into public.blocked_periods (starts_at, ends_at, reason)
  values (p_starts_at, v_ends_at, v_reason);

  return v_booked + v_charged;
end;
$$;

revoke execute on function public.cancel_occurrence(uuid, timestamptz, text) from public, anon;
grant execute on function public.cancel_occurrence(uuid, timestamptz, text) to authenticated, service_role;
