-- Recurring rules and jobs: book() checks blocked periods by interval overlap; recurring rules
-- are materialized into appointments by materialize_recurring() (nightly, pg_cron) and by
-- activate_rule(); deactivate_rule() cancels a rule's future instances; slot_occupancy exposes
-- per-slot counts to customers; pg_cron schedules both jobs. See docs/rpcs.md, docs/jobs.md
-- and docs/schema.md.
--
-- Same conventions as 20261023175948_core_rpcs.sql: security definer, search_path = '',
-- explicit role checks, 'AMRAP_<CODE>: detail' errors with SQLSTATE P0001, explicit grants.

-- Booking: blocked periods by overlap ------------------------------------------------------

-- Unchanged from 20261023175948_core_rpcs.sql except the blocked-period check, which now
-- compares the whole appointment [starts_at, ends_at) with each blocked period instead of
-- only the start. create or replace keeps the existing grants.
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

    -- weekday 0 = Monday (isodow - 1), both compared in the gym's timezone.
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

  -- Interval overlap, both ranges half-open [starts_at, ends_at): an appointment that starts
  -- before a blocked period but runs into it is rejected; one that ends exactly when the
  -- period starts is not.
  if exists (
    select 1 from public.blocked_periods b
    where tstzrange(p_starts_at, v_ends_at) && tstzrange(b.starts_at, b.ends_at)
  ) then
    raise exception 'AMRAP_BLOCKED: % to % overlaps a blocked period', p_starts_at, v_ends_at
      using errcode = 'P0001';
  end if;

  if p_slot_template_id is not null then
    -- Key on the epoch, not p_starts_at::text, so the key does not depend on the session's
    -- TimeZone setting.
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
