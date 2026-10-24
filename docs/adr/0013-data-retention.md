# 0013. Data retention

Status: Accepted
Date: 2026-10-24

## Context

The hosted project is on the Supabase Free Plan (ADR 0005): the database goes read-only when
its size passes 500 MB (Supabase docs, "Database size", checked 2026-10-24; WAL and system files
do not count). The only way out that costs nothing is deleting data, so the database has to stay
far below the limit by design. Some data grows with use and must be kept: balances are
`SUM(credit_transactions.amount)` (ADR 0003) and history comes from `appointments`. Other data
is a log that nothing reads after a few days. Before this ADR `public.notifications` was already
pruned to 30 days by `send_cutoff_reminders`, but `cron.job_run_details` was never trimmed:
pg_cron never deletes run rows (Supabase's pg_cron guide says so and schedules a cleanup job).

Usage estimate from issue #12: about 100 customers training 3 times a week. The jobs run every
15 minutes (`charge_due_appointments`, `send_cutoff_reminders`) and nightly
(`materialize_recurring`): 2 × 96 + 1 = 193 cron runs a day.

### Measured (local stack, 2026-10-24)

The local database holds demo data only: `pg_database_size` is 14 MB, almost all of it
Supabase's own schemas and empty pages. Each relation is at its minimum pages
(`pg_total_relation_size`, heap plus indexes):

| Relation | Rows | Size |
|---|---|---|
| `auth.refresh_tokens` | 11 | 128 kB |
| `public.appointments` | 23 | 120 kB |
| `public.customers` | 10 | 96 kB |
| `auth.sessions` | 1 | 96 kB |
| `auth.audit_log_entries` | 51 | 80 kB |
| `public.notifications`, `public.push_subscriptions`, `public.credit_transactions` | 0, 0, 19 | 64 kB each |
| `public.recurring_rules` | 0 | 40 kB |
| `public.blocked_periods`, `public.settings` | 2, 1 | 32 kB each |
| `cron.job_run_details` | 41 | 32 kB |
| `net._http_response` | 0 | 32 kB |
| `public.slot_templates` | 11 | 24 kB |

So bytes per row were measured instead: 10,000 representative
rows inserted into each table in a transaction, `pg_total_relation_size` (heap, TOAST and every
index) compared before and after, then rolled back.

| Relation | Bytes per row (with indexes) | Kind of row inserted |
|---|---|---|
| `public.appointments` | 269 | charged session (a template id adds about 30 more) |
| `public.credit_transactions` | 185 | `session` charge linked to its appointment |
| `public.notifications` | 286 | `cutoff_reminder` with its `data` |
| `cron.job_run_details` | 167 | a succeeded `charge_due_appointments` run |
| `auth.audit_log_entries` | 289 | copies of local `token_refreshed` / `token_revoked` entries |

Installed versions: pg_cron 1.6.4, pg_net 0.20.4 with `pg_net.ttl` = 6 hours (the default).

### Projection, one year at the estimated usage

| Relation | Rows a year | Growth a year | Bounded by |
|---|---|---|---|
| `appointments` | ~17,000 (15,600 sessions plus cancellations) | ~5 MB | nothing; kept |
| `credit_transactions` | ~17,000 (15,600 charges plus top-ups, refunds, adjustments) | ~3 MB | nothing; kept |
| `cron.job_run_details` without pruning | 70,000 | ~12 MB, every year, forever | nothing |
| `cron.job_run_details` with 14 days | ~2,900 kept | ~0.5 MB in total | this ADR |
| `notifications` | at most ~3 per appointment | ~1 MB in total (30 days) | 30-day pruning |
| `net._http_response` | one per dispatch | well under 1 MB in total | pg_net TTL, 6 hours |
| `auth.refresh_tokens`, `auth.sessions` | one per signed-in device | under 1 MB in total | Supabase Auth cleanup |
| `auth.audit_log_entries` | 2 per token refresh, ~80,000 at one app open a day per person | ~20 MB (one open a day) to ~70 MB (three) | nothing |

The business tables grow by about 8 MB a year, below the issue's 15–20 MB estimate; with room
for dead rows before autovacuum, under 16 MB. At that rate the kept data stays far below 500 MB
for decades.

## Decision

Retention per table:

- **Ledger (`credit_transactions`), `appointments`, `customers`:** kept for ever. Balances and
  history need every row. No archiving and no compaction of the ledger.
- **Other `public` tables** (`settings`, `slot_templates`, `recurring_rules`, `blocked_periods`,
  `push_subscriptions`): kept; they are small and change by hand. `push_subscriptions` is
  trimmed by `send-push` when a push service answers 404 or 410.
- **`notifications`:** 30 days, deleted by `send_cutoff_reminders` on every run (as before).
- **`cron.job_run_details`:** 14 days. A new daily job, `prune_cron_history` at 03:07 UTC,
  deletes every run that ended (or, if it never ended, started) more than 14 days ago. It is a
  function rather than inline SQL in `cron.schedule` so a pgTAP test can check that it deletes
  only the old rows ([jobs.md](../jobs.md#prune_cron_history-daily)). Supabase's example keeps 7
  days; 14 keeps two weeks of history for checking a missed charge or reminder.
- **`net._http_response`:** pg_net's own TTL, 6 hours by default. The worker deletes expired
  rows when it processes requests, so after a quiet spell a few older rows stay until the next
  push; they are bounded by a day's dispatches. Nothing to add.
- **Auth tables:** managed by Supabase Auth, which deletes revoked refresh tokens after 24 hours
  and time-boxed sessions 72 hours after they expire. Sessions without a time box (the default)
  stay until sign-out, one per device, which is small. `auth.audit_log_entries` is never
  deleted by Supabase and is the fastest-growing relation in the projection, but even at three
  app opens a day it takes years to reach the 250 MB warning line. No job writes into `auth`
  now: it is Supabase's schema. The monthly size check (runbook) lists it; when it passes
  50 MB, a new ADR decides how to trim it.

## Consequences

- The cron log stops growing: about 0.5 MB instead of 12 MB more every year. One more pg_cron
  job (four in total), checked by the release checklist and the unpause runbook.
- The database's growth is now the business data plus the auth audit log, both slow. The
  "Database size check" in [runbook.md](../runbook.md#database-size-check) is how the owner sees
  it: monthly during the pilot, with a warning at 250 MB and action at 400 MB.
- Upgrading the plan is never the answer to a size warning (nothing billable, ADR 0005); the
  answer is deleting log rows and vacuuming, which the runbook describes.
- The hosted baseline is not measured here (the local stack is not the hosted project); the
  first monthly check records it.
