# Jobs

Scheduled work that runs without a user. The functions are Postgres functions; pg_cron
schedules them, set up in `20261023192556_recurring_and_jobs.sql` and
`20261023214654_notifications_and_reminders.sql`. Push delivery (the `send-push` edge function
that pg_net calls) is described in [notifications.md](notifications.md).

## Schedules

| Job name (`cron.job.jobname`) | Schedule | Command |
|---|---|---|
| `charge_due_appointments` | `*/15 * * * *` (every 15 minutes) | `select public.charge_due_appointments()` |
| `materialize_recurring` | `0 2 * * *` (daily 02:00) | `select public.materialize_recurring()` |
| `send_cutoff_reminders` | `*/15 * * * *` (every 15 minutes) | `select public.send_cutoff_reminders()` |

- **Extension:** the migration runs `create extension if not exists pg_cron with schema
  pg_catalog` and grants `postgres` usage on schema `cron` (the steps Supabase documents), so
  it works on the local stack and the hosted Free Plan project alike; no dashboard step is
  needed. `cron.schedule(name, …)` replaces a job of the same name, so re-applying is harmless.
- **Timezone:** pg_cron reads schedules in the server's timezone, UTC on the hosted project:
  02:00 UTC is 03:00 (winter) or 04:00 (summer) in Ljubljana. Materialization uses
  `settings.timezone` for the dates themselves, so the run time does not change which
  occurrences it creates.
- **How cron authenticates:** it does not go through PostgREST or a JWT. pg_cron runs each
  command in a new database session as the role that scheduled it, `postgres` (the owner of
  both functions), so `request.jwt.claims` is empty and `auth.uid()` is null.
  `charge_due_appointments` and `send_cutoff_reminders` have no role check and are executable
  only by their owner and `service_role`; `materialize_recurring` admits callers with `auth.uid() is null` or the
  trainer. Neither is executable by `anon`.
- **Inspect:** `select jobid, jobname, schedule, command, active from cron.job;` and the last
  runs `select jobid, status, return_message, start_time from cron.job_run_details order by
  start_time desc limit 20;`.
- **Run by hand, local:** `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c
  'select public.charge_due_appointments()'` (or `public.materialize_recurring()`,
  `public.send_cutoff_reminders()`).
- **Run by hand, hosted:** in the dashboard SQL editor (which runs as `postgres`):
  `select public.charge_due_appointments();`, `select public.materialize_recurring();` or
  `select public.send_cutoff_reminders();`. All three are idempotent, so a manual run next to the scheduled one is safe. The trainer can also call
  `materialize_recurring` from the app (`supabase.rpc('materialize_recurring')`).

## charge_due_appointments (every 15 minutes)

```sql
public.charge_due_appointments() returns int
```

Charges sessions at their start (ADR 0002). Defined in `20261023175948_core_rpcs.sql`.

- **Schedule:** every 15 minutes via pg_cron (job `charge_due_appointments`), so a session is
  charged up to 15 minutes after it starts.
- **Selects:** every appointment with `status = 'booked'` and `starts_at <= now()`, locked with
  `select ... for update skip locked`.
- **Writes, per selected appointment, in one statement:** `status = 'charged'` and one
  `credit_transactions` row `type = 'session'`, `amount = -1`, `appointment_id` set,
  `created_by = null` (no acting user). Negative balances are allowed; nothing is skipped for
  lack of credits.
- **Returns:** the number of appointments charged.
- **Idempotent:** only `booked` rows are selected and each becomes `charged` together with
  its charge, so a second run returns 0 and there is still exactly one `session` row per
  appointment. The partial unique index `credit_transactions_one_charge_per_appointment_idx`
  (ADR 0003) is the database-level guard.
- **Concurrency with `cancel()`:** `cancel()` locks the appointment row with `for update`. A
  row a cancel holds is skipped by the job (`skip locked`) and, if still `booked` after the
  cancel commits, charged on the next run. If the job holds the row first, the cancel waits and
  then sees `charged`: a customer is rejected (`AMRAP_NOT_CANCELLABLE`), the trainer's cancel
  refunds. Either way one charge at most. See
  [architecture/charging-sequence.md](architecture/charging-sequence.md).
- **Who may run it:** no role check inside. `execute` is revoked from `public`, `anon` and
  `authenticated` and granted to `service_role` only; pg_cron runs it as `postgres`, the owner.
- **Tests:** `supabase/tests/013_charge_job.sql` (two due + one future → returns the due count,
  second run → 0, one session row each, a late cancel after the charge rejected, not executable
  by `authenticated`).
- **Manual run:** see [Schedules](#schedules).

## materialize_recurring (nightly)

```sql
public.materialize_recurring(p_weeks int default 4) returns int
```

Turns recurring rules into appointments about four weeks ahead. Defined in
`20261023192556_recurring_and_jobs.sql`; the full rules are in
[rpcs.md](rpcs.md#materialize_recurring).

- **Schedule:** daily at 02:00 UTC via pg_cron (job `materialize_recurring`), with the default
  `p_weeks = 4`, so instances always reach about four weeks ahead.
- **Selects:** every rule with `active = true` whose slot template is active; for each, every
  occurrence date from today through `today + p_weeks * 7` days in `settings.timezone`.
- **Writes:** one `appointments` row per occurrence that is in the future, does not overlap a
  blocked period, has no instance of the rule yet (any status), where the customer is not
  already booked and the slot is not full: `status = 'booked'`, `source = 'recurring'`,
  `rule_id` set. Capacity is counted under `book()`'s advisory lock.
- **Returns:** the number inserted.
- **Idempotent:** the unique index `appointments_rule_id_starts_at_idx` allows one instance
  per rule and start, ever, so a second run returns 0 and a cancelled instance is not
  recreated.
- **Who may run it:** no signed-in user (`auth.uid() is null`: pg_cron as `postgres`, the
  service role) or the trainer. Granted to `authenticated` for the trainer path; a customer or
  an unlinked user gets `AMRAP_FORBIDDEN`.
- **Deadlock:** a `40P01` for `materialize_recurring` in `cron.job_run_details` is harmless
  (the next run catches up); a booking that hits `40P01` in that window can be retried
  ([ADR 0008](adr/0008-recurrence-and-occupancy.md)).
- **Tests:** `supabase/tests/020_materialize.sql`.
- **Tests (schedule):** `supabase/tests/021_rules_and_jobs.sql` checks both jobs in `cron.job`.
- **Manual run:** see [Schedules](#schedules).
- **Diagram:** [architecture/materialization-sequence.md](architecture/materialization-sequence.md).

## send_cutoff_reminders (every 15 minutes)

```sql
public.send_cutoff_reminders() returns int
```

Pushes the pre-cutoff reminder, the customer's only warning before a booking becomes a charge
(ADR 0009). Defined in `20261023214654_notifications_and_reminders.sql`; the full rules are in
[rpcs.md](rpcs.md#send_cutoff_reminders).

- **Schedule:** every 15 minutes via pg_cron (job `send_cutoff_reminders`).
- **Selects:** `booked` appointments whose cutoff (`starts_at − late_cancel_hours · 1 h`) is in
  `[now() + 45 min, now() + 75 min)`, of a linked customer with at least one push
  subscription. The window is 30 minutes wide, so each cutoff falls in two consecutive runs and
  one missed run still reminds; the customer gets the reminder 45 to 75 minutes before the
  cutoff. With `late_cancel_hours = 0` the cutoff is the start itself.
- **Writes:** one `notifications` row (`cutoff_reminder`) per selected appointment, inserted
  `on conflict (kind, appointment_id) do nothing`, then one pg_net request to `send-push` with
  the ids inserted by this run (`dispatch_notifications`). Deletes `notifications` rows older
  than 30 days first.
- **Returns:** the number of reminders inserted.
- **Idempotent:** one reminder per appointment, ever (unique `(kind, appointment_id)`), so the
  second run that sees the same cutoff, a retry or an overlapping run inserts nothing and sends
  nothing. A run with nothing new queues no request.
- **Not configured:** without the Vault rows `amrap_functions_url` and `amrap_push_secret` (or
  without the `settings` row) it logs `send_cutoff_reminders: …` with `raise log` (visible in
  the Postgres logs, not in `cron.job_run_details`) and returns 0, recording nothing, so the
  hosted project runs the job harmlessly before push is set up.
- **Delivery:** best effort and at most once: the request leaves after the job's transaction
  commits, `send-push` claims the ids (`claim_notifications`) and pushes to every device of the
  customer. The pg_net response lands in `net._http_response` (kept 6 hours):
  `select id, status_code, content, error_msg from net._http_response order by id desc limit 10;`.
- **Who may run it:** pg_cron as `postgres` and `service_role`; not `authenticated` or `anon`.
- **Tests:** `supabase/tests/031_reminders.sql` (window boundaries 44/45/74/75 min, statuses,
  unlinked and unsubscribed customers, one row per appointment with two devices, the queued
  request and its ids, second and overlapping runs, a late subscriber, a 0-hour cutoff,
  pruning, no config, no settings, grants, the schedule).
- **Manual run:** see [Schedules](#schedules).
- **Diagram:** [architecture/push-sequence.md](architecture/push-sequence.md).

## send-push (edge function)

The only edge function: `supabase/functions/send-push/`. pg_net calls it after a notification
writer commits ([notifications.md](notifications.md)); it is not scheduled itself.

- **Endpoint:** `POST <functions_url>/send-push` (hosted
  `https://etzkbwqgjuipihypokjp.supabase.co/functions/v1/send-push`, local
  `http://127.0.0.1:54321/functions/v1/send-push`, from the db container
  `http://host.docker.internal:54321/functions/v1/send-push`).
- **Auth:** `verify_jwt = false` (`supabase/config.toml` `[functions.send-push]`), so the
  gateway passes the request without a user JWT. The function compares the
  `x-amrap-push-secret` header with its `PUSH_SECRET` secret in constant time.
- **Request:** `{"ids": ["<notification uuid>", ...]}`.
- **Responses:**

| Status | When | Claims anything |
|---|---|---|
| 405 | not `POST` | no |
| 503 | `PUSH_SECRET` or a VAPID secret is not set (logged) | no |
| 401 | the secret header is missing or wrong | no |
| 400 | the body is not JSON with an `ids` array of strings | no |
| 500 | `claim_notifications` failed (logged) | no |
| 200 | `{"claimed", "sent", "failed", "removed"}`: claimed notifications, pushes delivered, pushes failed (kept), subscriptions deleted | yes |

- **Work:** `claim_notifications(ids)` with the function's service key (the default
  `SUPABASE_SECRET_KEYS` entry, else the legacy `SUPABASE_SERVICE_ROLE_KEY`), then one push per
  returned subscription in parallel: web-push 3.6.7 builds the encrypted (`aes128gcm`),
  VAPID-signed request and `fetch` sends it (8 s timeout each). A 404 or 410 deletes those
  subscriptions in one `delete … in (endpoints)`; any other status or a network error is
  logged and the subscription kept. TTL, urgency and topic per kind are in
  [notifications.md](notifications.md#push-payload).
- **Secrets:** `PUSH_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (`mailto:` or `https:`). Locally from `supabase/functions/.env` (gitignored; template
  `supabase/functions/.env.example`), loaded by `supabase start`, which serves every function
  in `supabase/functions/` without a separate `supabase functions serve`. Hosted: `supabase
  secrets set` ([runbook.md](runbook.md#turn-on-push-notifications)).
- **Logs:** local `docker logs supabase_edge_runtime_amrap`; hosted dashboard, Edge Functions,
  `send-push`, Logs. The caller's view is `net._http_response` (status and the JSON summary).
- **Tests:** Deno unit tests next to the code (`payload_test.ts`, `handler_test.ts`) with fake
  claim, send and delete; run by `scripts/test-functions.sh` and the `functions` CI job.
- **Diagram:** [architecture/push-sequence.md](architecture/push-sequence.md).
