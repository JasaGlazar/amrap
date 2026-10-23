# Appointment states

Life cycle of an `appointments.status`. A new appointment is `booked` (`book()`). The charge
job `charge_due_appointments()` moves it to `charged` at start time (ADR 0002). A customer
`cancel()` before the cutoff is free (`cancelled`); after the cutoff and before the start it is
`cancelled_late` and charged at cancel time. Once the appointment has started the customer can
no longer cancel it. The trainer
can cancel from `booked` or `charged` without charge (`cancelled_by_trainer`); from `charged` a
`refund` transaction is inserted. A customer cannot cancel a `charged` appointment, and a
`cancelled_late` appointment cannot be cancelled again (the trainer waives the charge with
`adjust(+1, note)`).

```mermaid
stateDiagram-v2
    [*] --> booked : book() by customer or trainer / materialize_recurring()
    booked --> charged : charge_due_appointments() after start time (session -1)
    booked --> cancelled : customer cancel before cutoff (free)
    booked --> cancelled_late : customer cancel after cutoff, before start (late_cancel -1)
    booked --> cancelled_by_trainer : trainer cancel (no charge)
    charged --> cancelled_by_trainer : trainer cancel (refund +1)
    cancelled --> [*]
    cancelled_late --> [*]
    cancelled_by_trainer --> [*]
    charged --> [*]
```
