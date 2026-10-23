-- Core RPCs: every credit and capacity mutation (book, cancel, top_up, adjust), the charge
-- job and the invite flow. See docs/rpcs.md for the reference and docs/jobs.md for the job.
--
-- Conventions for every function here:
--   - security definer, set search_path = '' (all names schema-qualified), language plpgsql.
--   - The role is decided by public.is_trainer(); a customer acts only on
--     public.current_customer_id(). Anything else raises AMRAP_FORBIDDEN.
--   - Errors are raised with SQLSTATE P0001 and a message that starts with a stable token
--     ('AMRAP_<CODE>: <english detail>'), which the UI maps to Slovenian copy.
--   - The initial migration revoked default execute, so each user-facing RPC is granted to
--     authenticated (and service_role) explicitly; the charge job is granted to service_role only.

-- Credits ----------------------------------------------------------------------------------

-- Trainer-only top-up: a positive topup transaction.
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

-- Trainer-only correction: a signed, non-zero adjustment transaction. Also how the trainer
-- waives a late-cancel charge (adjust(+1, note)).
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

-- Grants -----------------------------------------------------------------------------------

revoke execute on function public.top_up(uuid, int, text) from public, anon;
revoke execute on function public.adjust(uuid, int, text) from public, anon;
grant execute on function public.top_up(uuid, int, text) to authenticated, service_role;
grant execute on function public.adjust(uuid, int, text) to authenticated, service_role;
