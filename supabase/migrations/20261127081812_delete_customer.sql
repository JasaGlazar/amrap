-- The trainer deletes a customer record that has no history. Reference: docs/rpcs.md
-- (delete_customer), docs/runbook.md "A customer registered twice".

create function public.delete_customer(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
begin
  if not public.is_trainer() then
    raise exception 'AMRAP_FORBIDDEN: only the trainer can delete a customer' using errcode = 'P0001';
  end if;
  if p_customer_id is null then
    raise exception 'AMRAP_INVALID_ARGUMENT: p_customer_id is required' using errcode = 'P0001';
  end if;

  -- conflicts with the key share lock of a referencing insert
  select * into v_customer from public.customers c where c.id = p_customer_id for update;
  if not found then
    raise exception 'AMRAP_NOT_FOUND: customer % does not exist', p_customer_id using errcode = 'P0001';
  end if;
  if v_customer.role <> 'customer' then
    raise exception 'AMRAP_NOT_DELETABLE: record % is not a customer record', p_customer_id
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.appointments a where a.customer_id = p_customer_id) then
    raise exception 'AMRAP_NOT_DELETABLE: customer % has appointments', p_customer_id
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.credit_transactions t where t.customer_id = p_customer_id) then
    raise exception 'AMRAP_NOT_DELETABLE: customer % has credit transactions', p_customer_id
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.recurring_rules r where r.customer_id = p_customer_id) then
    raise exception 'AMRAP_NOT_DELETABLE: customer % has recurring rules', p_customer_id
      using errcode = 'P0001';
  end if;

  delete from public.customers c where c.id = p_customer_id;
end;
$$;

revoke execute on function public.delete_customer(uuid) from public, anon;
grant execute on function public.delete_customer(uuid) to authenticated, service_role;
