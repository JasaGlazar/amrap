# Charging sequence

How a credit is deducted. The first lane is the normal path: pg_cron calls
`charge_due_appointments()` every 15 minutes (job `charge_due_appointments`, see
[jobs.md](../jobs.md#schedules)), which locks every due
`booked` row with `for update skip locked`, sets it `charged` and writes one `session`
transaction per appointment, returning the count. The second lane is the race: a `cancel()`
arrives at the same time as the job. `cancel` locks the appointment row with `for update`
before reading its status, so the two are serialized: whichever holds the lock first decides,
and the other either skips the row (job) or sees the new status (cancel). The partial unique
index on `credit_transactions` (ADR 0003) is the final guard.

```mermaid
sequenceDiagram
    participant Cron as pg_cron (every 15 min)
    participant Job as charge_due_appointments()
    participant Appt as appointments
    participant Ledger as credit_transactions
    participant App as Customer or trainer app
    participant Cancel as cancel()

    Cron->>Job: run (as postgres, no grant to authenticated)
    Job->>Appt: select where status booked and starts_at <= now() for update skip locked
    Appt-->>Job: due rows not locked by a cancel
    Job->>Appt: set status charged
    Job->>Ledger: insert session -1, created_by null, for each
    Job-->>Cron: number charged
    Note over Job,Ledger: a second run selects no booked due rows and returns 0

    Note over Cron,Cancel: Race lane - cancel vs charge job on one appointment
    App->>Cancel: cancel(appointment_id)
    Cancel->>Appt: select ... for update (waits while the job holds the row)
    alt job charged it first (status charged)
        alt caller is the customer
            Cancel-->>App: AMRAP_NOT_CANCELLABLE, no transaction
        else caller is the trainer
            Cancel->>Appt: set status cancelled_by_trainer
            Cancel->>Ledger: insert refund +1
            Cancel-->>App: cancelled, charge refunded
        end
    else cancel locked it first (status booked)
        Note over Job,Appt: the job skips the locked row
        alt customer, after the cutoff and before the start
            Cancel->>Appt: set status cancelled_late
            Cancel->>Ledger: insert late_cancel -1
        else customer before the cutoff, or the trainer
            Cancel->>Appt: set status cancelled or cancelled_by_trainer
        end
        Cancel-->>App: cancelled
    end
    Note over Appt,Ledger: partial unique index allows at most one session or late_cancel row per appointment
```
