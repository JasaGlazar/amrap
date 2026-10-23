# 0003. Ledger-only balance with a partial unique index on charges

Status: Accepted
Date: 2026-10-23

## Context

Credits are money-like. A stored balance column can drift from the history that produced it,
especially with concurrent writers (a cron job and a cancelling customer). The paper sheet this
replaces is itself a ledger of strokes.

## Decision

- There is no balance column anywhere. The balance is `SUM(credit_transactions.amount)`,
  exposed through the view `customer_balances`.
- `credit_transactions.type` is one of `topup`, `session`, `late_cancel`, `refund`,
  `adjustment`. Rows are append-only.
- A partial unique index on `credit_transactions(appointment_id) WHERE type IN ('session',
  'late_cancel')` enforces one charge per appointment at the database level.
- `refund` is deliberately excluded from the index, so a trainer can refund an appointment
  that was already charged.

## Consequences

- The balance is always consistent with history; corrections are new rows, never updates.
- A cron-versus-cancel race that tries to charge twice fails on the unique index instead of
  corrupting the ledger; RPCs must handle that outcome (lock first, so it does not occur).
- Balance reads aggregate rows; at gym scale this is trivially cheap and needs no cache.
- Tests must derive expected balances from the transactions they insert.
