-- Daily pruning of the pg_cron run log. Reference: docs/jobs.md, docs/rpcs.md, docs/schema.md;
-- decision: docs/adr/0013-data-retention.md.

-- Cron log pruning -------------------------------------------------------------------------

create function public.prune_cron_history()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pruned int;
begin
  delete from cron.job_run_details
  where coalesce(end_time, start_time) < now() - interval '14 days';
  get diagnostics v_pruned = row_count;
  return v_pruned;
end;
$$;

revoke execute on function public.prune_cron_history() from public, anon, authenticated;
grant execute on function public.prune_cron_history() to service_role;

-- Schedule (pg_cron) -----------------------------------------------------------------------

-- Off the quarter hour, so it never runs next to the 15-minute jobs.
select cron.schedule('prune_cron_history', '7 3 * * *', $$select public.prune_cron_history()$$);
