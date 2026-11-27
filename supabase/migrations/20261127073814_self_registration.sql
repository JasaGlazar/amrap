-- Self-registration with the gym code. Reference: docs/rpcs.md, docs/schema.md; decision:
-- docs/adr/0021-customers-register-with-a-gym-code.md.

-- Gym code ---------------------------------------------------------------------------------

-- Not a settings column: customers can read settings.
create table public.registration_settings (
  id int primary key default 1 check (id = 1),
  code text check (code is null or char_length(code) >= 8),
  updated_at timestamptz not null default now()
);

insert into public.registration_settings (id) values (1);

alter table public.registration_settings enable row level security;

create policy "trainer reads registration settings" on public.registration_settings
  for select to authenticated
  using ((select public.is_trainer()));

revoke all on public.registration_settings from anon;
revoke insert, update, delete on public.registration_settings from authenticated;

alter table public.customers add column registered_at timestamptz;

-- RPCs -------------------------------------------------------------------------------------

create function public.register_customer(p_name text, p_phone text, p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_name text := btrim(p_name, E' \t\r\n');
  v_phone text := btrim(p_phone, E' \t\r\n');
  v_email text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AMRAP_FORBIDDEN: registering needs a signed-in user' using errcode = 'P0001';
  end if;
  if public.current_customer_id() is not null then
    raise exception 'AMRAP_ALREADY_LINKED: this user is already linked to a customer' using errcode = 'P0001';
  end if;

  select r.code into v_code from public.registration_settings r where r.id = 1;
  if v_code is null or p_code is distinct from v_code then
    raise exception 'AMRAP_REGISTRATION_CLOSED: registration is closed or the code is wrong'
      using errcode = 'P0001';
  end if;

  if coalesce(char_length(v_name), 0) not between 2 and 80 then
    raise exception 'AMRAP_INVALID_ARGUMENT: the name must be 2 to 80 characters' using errcode = 'P0001';
  end if;
  if coalesce(char_length(v_phone), 0) not between 6 and 30 then
    raise exception 'AMRAP_INVALID_ARGUMENT: the phone must be 6 to 30 characters' using errcode = 'P0001';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  -- Two concurrent calls by the same user both pass the linked check above.
  begin
    insert into public.customers (name, phone, email, role, auth_user_id, registered_at)
    values (v_name, v_phone, v_email, 'customer', auth.uid(), now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'AMRAP_ALREADY_LINKED: this user is already linked to a customer' using errcode = 'P0001';
  end;

  return v_id;
end;
$$;

create function public.set_registration_code(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_trainer() then
    raise exception 'AMRAP_FORBIDDEN: only the trainer can set the registration code' using errcode = 'P0001';
  end if;
  if p_code is not null and char_length(p_code) < 8 then
    raise exception 'AMRAP_INVALID_ARGUMENT: the registration code must be 8 or more characters'
      using errcode = 'P0001';
  end if;

  update public.registration_settings set code = p_code, updated_at = now() where id = 1;
  if not found then
    raise exception 'AMRAP_SETTINGS_MISSING: the registration settings row (id = 1) is missing'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Grants -----------------------------------------------------------------------------------

revoke execute on function public.register_customer(text, text, text) from public, anon;
grant execute on function public.register_customer(text, text, text) to authenticated, service_role;
revoke execute on function public.set_registration_code(text) from public, anon;
grant execute on function public.set_registration_code(text) to authenticated, service_role;
