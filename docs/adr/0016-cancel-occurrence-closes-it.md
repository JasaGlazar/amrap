# 0016. Cancelling a whole session closes it with a blocked period

Status: Accepted
Date: 2026-10-25

## Context

When the trainer cannot hold a session (illness, a closed gym), every booking of that slot
occurrence has to be cancelled one by one with `cancel()`, and nothing stops a customer from
booking the freed places again. The owner decided in issue #19 (2026-10-24): **cancel and close
it**. Every booking is cancelled, refunded if already charged, every customer is notified with
the optional reason (ADR 0015), and nobody can book the occurrence again.

ADR 0008 already has a way to say "no bookings here": a blocked period, which `book()` and the
nightly materialization skip. A blocked period added in Settings does not cancel the bookings
inside it; it only warns (open question 3 in issue #7, still open).

`book()` and `materialize_rule()` serialize one occurrence with a transaction-scoped advisory
lock (ADR 0004, 0008), but until now they checked blocked periods before taking it. Under read
committed, a booking that passed that check, then waited on the lock while the session was
cancelled, would have inserted a booking into the closed occurrence once the lock was free.

## Decision

- A trainer-only RPC `cancel_occurrence(p_template_id, p_starts_at, p_reason default null)`
  does it in one transaction: validates the occurrence like `book()` (template exists and is
  active, the start is on its weekday and time in `settings.timezone`), takes `book()`'s
  advisory lock for it, cancels every `booked` and then every `charged` appointment of the
  occurrence as `cancelled_by_trainer` with the reason (charged ones get a `refund` like
  `cancel()`), inserts one blocked period `[starts_at, starts_at + duration)` with the reason,
  and returns the number cancelled. The notifications come from ADR 0015's trigger.
- Closing is a blocked period, not a new column or table: the existing checks in `book()` and
  materialization, the Koledar's **Zaprto** state and Settings → **Zaprta obdobja** all work
  unchanged. Reopening is deleting that period; the bookings stay cancelled.
- `book()` and `materialize_rule()` now take the advisory lock before the blocked-period check
  (`create or replace`, same grants, same lock key), so whoever waits for a cancel sees its
  blocked period. Ad-hoc bookings take no lock and are not affected by a whole-session cancel.
- An occurrence that already overlaps a blocked period is rejected (`AMRAP_BLOCKED`) instead of
  getting a second period: it is already closed, and its stranded bookings, if any, are
  cancelled one by one (the app hides **Odpovej termin** on a **Zaprto** occurrence).
- Past occurrences are allowed for the trainer, as with `cancel()`: a missed session that the
  charge job already charged is refunded in one step. An occurrence without bookings is allowed
  and only closed.
- Existing tokens cover the rejections (`AMRAP_FORBIDDEN`, `AMRAP_INVALID_ARGUMENT`,
  `AMRAP_NOT_FOUND`, `AMRAP_SLOT_INACTIVE`, `AMRAP_SLOT_MISMATCH`, `AMRAP_BLOCKED`,
  `AMRAP_SETTINGS_MISSING`); no new copy is needed for them.

## Consequences

- The trainer cancels a session with one action in the Koledar (day view and week grid) and the
  occurrence shows **Zaprto** at once.
- A whole-session cancel leaves a blocked period per cancelled session in **Zaprta obdobja**;
  past ones are hidden there (the list shows upcoming periods) but stay in the table.
- Materialization now takes the advisory lock for blocked occurrences too before skipping them;
  that is a few extra locks per rule per night and changes no result.
- Open question 3 of issue #7 (should a Settings blocked period cancel the bookings inside it?)
  stays open; if the answer is yes, it can reuse `cancel_occurrence()`'s cancel step per
  occurrence.
- pgTAP has one session, so the race is covered by a structural assertion (the lock comes before
  the blocked check in the three functions) plus the lock being held, not by two real sessions.
