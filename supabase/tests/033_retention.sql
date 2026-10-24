-- prune_cron_history(): the daily job that keeps cron.job_run_details to 14 days (ADR 0013).
-- A run is old when its end (or its start, if it never ended) is more than 14 days ago; a run
-- exactly 14 days old stays. Only the service role / cron may run it.
--
-- Expected counts are computed from the table before the run (fixtures plus the local stack's
-- own cron history), never hardcoded.
begin;

select plan(9);

-- Schedule and grants ----------------------------------------------------------------------

select results_eq(
  $$select schedule::text, command::text, active from cron.job where jobname = 'prune_cron_history'$$,
  $$values ('7 3 * * *', 'select public.prune_cron_history()', true)$$,
  'the cron log is pruned daily at 03:07 UTC');
select is_empty(
  $$select r from unnest(array['anon', 'authenticated']) r
    where has_function_privilege(r, 'public.prune_cron_history()', 'EXECUTE')$$,
  'anon and authenticated cannot execute prune_cron_history');
select ok(has_function_privilege('service_role', 'public.prune_cron_history()', 'EXECUTE'),
  'service_role can execute prune_cron_history');

-- Fixtures ---------------------------------------------------------------------------------

create temp table fx (key text primary key, runid bigint not null, old boolean not null)
  on commit drop;

-- Negative run ids: postgres may not use cron.runid_seq, and they never collide with a real run.
with runs (runid, key, started, ended) as (
  values (-1, 'ended_15_days_ago', now() - interval '15 days 1 minute', now() - interval '15 days'),
         (-2, 'ended_13_days_ago', now() - interval '13 days 1 minute', now() - interval '13 days'),
         (-3, 'ended_exactly_14_days_ago', now() - interval '14 days 1 minute', now() - interval '14 days'),
         (-4, 'started_15_days_ago_never_ended', now() - interval '15 days', null),
         (-5, 'started_13_days_ago_never_ended', now() - interval '13 days', null)
),
inserted as (
  insert into cron.job_run_details
    (jobid, runid, database, username, command, status, return_message, start_time, end_time)
  select (select jobid from cron.job where jobname = 'prune_cron_history'), runid, 'postgres',
         'postgres', 'select 1 -- ' || key, 'succeeded', '1 row', started, ended
  from runs
  returning runid, command, coalesce(end_time, start_time) as finished
)
insert into fx
select replace(command, 'select 1 -- ', ''), runid, finished < now() - interval '14 days'
from inserted;

create temp table expected on commit drop as
select count(*)::int as pruned from cron.job_run_details
where coalesce(end_time, start_time) < now() - interval '14 days';

-- First run --------------------------------------------------------------------------------

create temp table runs (n int primary key, pruned int) on commit drop;
grant select, insert on runs to service_role;

select tests.authenticate_as_service_role();
insert into runs select 1, public.prune_cron_history();
select tests.clear_authentication();

select ok((select pruned from expected) >= (select count(*) from fx where old),
  'the fixtures include old runs to prune');
select is((select pruned from runs where n = 1), (select pruned from expected),
  'the first run returns the number of runs older than 14 days');
select is_empty(
  $$select d.runid from cron.job_run_details d join fx using (runid) where fx.old$$,
  'the runs that ended (or started, if they never ended) more than 14 days ago are deleted');
select set_eq(
  $$select d.runid from cron.job_run_details d join fx using (runid)$$,
  $$select runid from fx where not old$$,
  'runs from the last 14 days, including one exactly 14 days old, are kept');
select is_empty(
  $$select runid from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '14 days'$$,
  'no run older than 14 days is left');

-- Second run -------------------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into runs select 2, public.prune_cron_history();
select tests.clear_authentication();

select is((select pruned from runs where n = 2), 0, 'a second run prunes nothing');

select * from finish();
rollback;
