# Appointment states

Life cycle of an `appointments.status`. A new appointment is `booked`. The charge job moves it
to `charged` at start time (ADR 0002). A customer cancel before the cutoff is free
(`cancelled`); after the cutoff it is `cancelled_late` and charged at cancel time. The trainer
can cancel in any state without charge (`cancelled_by_trainer`); if a charge exists, a `refund`
transaction is inserted. A customer cannot cancel a `charged` appointment.

```mermaid
stateDiagram-v2
    [*] --> booked : book / trainer creates / materialization
    booked --> charged : charge_due_appointments at starts_at (session -1)
    booked --> cancelled : customer cancel before cutoff (free)
    booked --> cancelled_late : customer cancel after cutoff (late_cancel -1)
    booked --> cancelled_by_trainer : trainer cancel (no charge)
    charged --> cancelled_by_trainer : trainer cancel (refund +1)
    cancelled --> [*]
    cancelled_late --> [*]
    cancelled_by_trainer --> [*]
    charged --> [*]
```
