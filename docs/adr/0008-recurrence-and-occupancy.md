# 0008. Recurrence, blocked periods, slot occupancy and cron roles

Status: Accepted
Date: 2026-10-23

## Context

Stage 2 adds recurring rules that a nightly job turns into appointments, trainer blocked
periods, a customer calendar that shows remaining capacity, and pg_cron schedules. Each needed
a rule that later code must keep: how a blocked period collides with an appointment, what
happens to a cancelled recurring instance, how a customer can see capacity while RLS hides
other customers' appointments, and which role the jobs run as.

## Decision

- **Blocked periods by interval overlap.** An appointment `[starts_at, ends_at)` is blocked
  when it overlaps a blocked period `[starts_at, ends_at)`
  (`tstzrange(…) && tstzrange(…)`), not only when its start falls inside. `book()` and
  materialization use the same check, so an appointment that starts before a block and runs
  into it is rejected or skipped, and one that ends exactly when a block starts is allowed.
- **A cancelled rule instance is never recreated.** The unique index
  `appointments_rule_id_starts_at_idx` on `(rule_id, starts_at)` covers every status, so
  materialization skips an occurrence that already has an instance, cancelled or not.
  Deactivating a rule cancels its future `booked` instances as `cancelled_by_trainer`;
  reactivating it does not restore them.
- **`slot_occupancy` is an owner-run view.** It is a deliberate exception to invoker RLS
  (`customer_balances` stays `security_invoker`): it runs as its owner so it counts every
  customer's `booked` and `charged` appointments, exposes counts only (template, start,
  count, never a customer), and returns rows only to a linked caller
  (`current_customer_id()` is not null, or `is_trainer()`).
- **Cron runs as the owner.** pg_cron runs both jobs as `postgres`, the role that scheduled
  them, with no JWT, so `auth.uid()` is null.
- **Job grants differ.** `charge_due_appointments` has no grant to `authenticated` or `anon`
  and no role check inside (owner and `service_role` only). `materialize_recurring` is granted
  to `authenticated` so the trainer can materialize a new rule from the app, and checks the
  role inside: it runs when there is no JWT (cron, service role) or the caller is the trainer,
  otherwise `AMRAP_FORBIDDEN`. The per-rule helper `materialize_rule` has no grant.

## Consequences

- A date the trainer cancels stays cancelled even if the rule is deactivated and reactivated;
  the trainer re-books it by hand if needed.
- The dashboard's Security Advisor reports `slot_occupancy` as a security definer view. That
  is expected; the linked-caller filter and the count-only columns are the guard. A role
  without a JWT (`service_role`) gets zero rows from it.
- The nightly materialization and a booking at the same start can, rarely, deadlock
  (SQLSTATE 40P01). Postgres aborts one side and nothing is half-written: a failed nightly run
  is caught up by the next run, a failed booking can be retried.
- Any new job function must decide explicitly between the two grant patterns above.
- Details: `docs/rpcs.md`, `docs/jobs.md`, `docs/schema.md` ("slot_occupancy").
