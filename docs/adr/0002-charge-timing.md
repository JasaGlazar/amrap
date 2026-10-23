# 0002. Charge timing

Status: Accepted
Date: 2026-10-23

## Context

With check-in removed (ADR 0001), the system needs a deterministic moment at which a credit is
deducted. It must work without any human action, tolerate the cron job and a customer cancel
racing each other, and let the trainer undo a charge.

## Decision

- **Session charge at session start.** A pg_cron job runs `charge_due_appointments()` every
  15 minutes. Every `booked` appointment with `starts_at <= now()` becomes `charged` and gets
  one `session` transaction (−1). The function is idempotent.
- **Late cancel charged at cancel time.** When a customer cancels after the cutoff, `cancel`
  sets `cancelled_late` and writes the `late_cancel` transaction (−1) in the same transaction.
- **Trainer cancel never charges.** `cancel` by the trainer sets `cancelled_by_trainer`. If a
  charge already exists, a `refund` (+1) is inserted so the net is zero.
- A customer can cancel only while the status is `booked`; once the appointment has started and
  is `charged`, only the trainer can act on it.
- `cancel` locks the appointment row, so a cancel racing the job ends with exactly one charge
  (see ADR 0003 for the DB-level guard).

## Consequences

- A session is charged up to 15 minutes after its start time, not at the exact start.
- Reading the ledger of a future appointment shows no charge yet; the balance is "credits minus
  already charged sessions", not a reservation.
- Exactly one charge per appointment holds under any interleaving of cron and cancel.
- The job must be testable by calling `charge_due_appointments()` directly against seeded
  fixture dates.
- A `cancelled_late` appointment cannot be cancelled again; the trainer waives a late-cancel charge with `adjust(+1, note)`.
