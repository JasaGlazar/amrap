# Jobs

Scheduled work that runs without a user. Stage 1 defines the functions; the pg_cron schedules
themselves land in Stage 2 (`IMPLEMENTATION_PLAN.md`). Until then the job is run by hand or by
tests.

## charge_due_appointments (every 15 minutes)

```sql
public.charge_due_appointments() returns int
```

Charges sessions at their start (ADR 0002). Defined in `20261023175948_core_rpcs.sql`.

- **Schedule:** every 15 minutes via pg_cron (Stage 2), so a session is charged up to 15
  minutes after it starts.
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
- **Manual run (local):** `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c
  'select public.charge_due_appointments()'`.

## materialize_recurring (nightly)

```sql
public.materialize_recurring(p_weeks int default 4) returns int
```

Turns recurring rules into appointments about four weeks ahead. Defined in
`20261023192556_recurring_and_jobs.sql`; the full rules are in
[rpcs.md](rpcs.md#materialize_recurring).

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
- **Tests:** `supabase/tests/020_materialize.sql`.
- **Manual run (local):** `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c
  'select public.materialize_recurring()'`.
- **Diagram:** [architecture/materialization-sequence.md](architecture/materialization-sequence.md).
