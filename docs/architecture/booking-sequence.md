# Booking sequence

How a customer books an open slot. `book(p_customer_id, p_starts_at, p_slot_template_id)` is a
`SECURITY DEFINER` RPC that runs in one transaction: it checks the caller books for themselves,
validates the template (active, start in the future, on the template's weekday and start time
in `settings.timezone`), takes a transaction-scoped advisory lock on the slot occurrence so
concurrent bookings, materialization and `cancel_occurrence()` are serialized, rejects an
appointment whose `[starts_at, ends_at)` overlaps a blocked period (so one that starts before a
closure but runs into it is rejected too; checked after the lock, so a booking that waited on a
whole-session cancel sees the period it added), counts the
appointments occupying it (`booked` plus `charged`) against the template's capacity, and
inserts only if there is room (ADR 0004). The trainer goes through the same RPC without the
future check, and may also book ad hoc (no template, explicit end, no capacity). Every
rejection is an `AMRAP_*` error token, listed in [rpcs.md](../rpcs.md#book). A customer's own
booking fires the trigger that notifies the trainer (best effort, never fails the booking;
[notifications.md](../notifications.md#event-notifications)).

```mermaid
sequenceDiagram
    participant C as Customer app
    participant B as book()
    participant S as slot_templates
    participant BP as blocked_periods
    participant A as appointments

    C->>B: book(customer_id, starts_at, slot_template_id)
    B->>B: is_trainer() or customer_id = current_customer_id(), else AMRAP_FORBIDDEN
    B->>S: read template
    S-->>B: active, weekday, start_time, duration_minutes, capacity
    B->>B: active, future, weekday and start_time match, else AMRAP_SLOT_INACTIVE / AMRAP_IN_PAST / AMRAP_SLOT_MISMATCH
    B->>B: pg_advisory_xact_lock(template + starts_at), waits for a cancel_occurrence() of it
    B->>BP: [starts_at, ends_at) overlaps a blocked period?
    BP-->>B: none, or AMRAP_BLOCKED
    B->>A: count status in (booked, charged) for that template and starts_at
    A-->>B: occupied
    alt occupied < capacity
        B->>A: insert booked, source self_booked, ends_at = starts_at + duration
        alt customer already has a live booking at starts_at
            A-->>B: unique_violation
            B-->>C: AMRAP_ALREADY_BOOKED
        else inserted
            A->>A: trigger notify_booking_created (source self_booked), trainer push after commit
            B-->>C: appointment id
        end
    else slot full
        B-->>C: AMRAP_CAPACITY_FULL
    end
```
