# Charging sequence

How a credit is deducted. The first lane is the normal path: pg_cron calls
`charge_due_appointments()` every 15 minutes, which writes one `session` transaction per due
appointment. The second lane is the race: a customer late-cancel arrives at the same time as the
job. `cancel` locks the appointment row, so exactly one of the two writes the charge, and the
partial unique index on `credit_transactions` (ADR 0003) is the final guard.

```mermaid
sequenceDiagram
    participant Cron as pg_cron (every 15 min)
    participant Job as charge_due_appointments()
    participant Appt as appointments
    participant Ledger as credit_transactions
    participant Cust as Customer app
    participant Cancel as cancel()

    Cron->>Job: run
    Job->>Appt: select booked with starts_at <= now()
    Appt-->>Job: due rows
    Job->>Ledger: insert session -1 for each
    Job->>Appt: set status charged
    Note over Job,Ledger: running twice yields one charge per appointment

    Note over Cron,Cancel: Race lane - late cancel vs charge job
    Cust->>Cancel: cancel(appointment_id)
    Cancel->>Appt: lock appointment row
    alt job already charged it (status charged)
        Cancel-->>Cust: rejected - started and charged
    else still booked and past cutoff
        Cancel->>Ledger: insert late_cancel -1
        Cancel->>Appt: set status cancelled_late
        Cancel-->>Cust: late cancel, charged
    end
    Note over Appt,Ledger: partial unique index allows at most one session or late_cancel row per appointment
```
