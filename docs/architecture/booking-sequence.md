# Booking sequence

How a customer books an open slot. `book()` is a `SECURITY DEFINER` RPC that runs in one
transaction: it checks the caller is a customer, locks the slot so concurrent bookings are
serialized, counts the appointments occupying the slot (`booked` plus `charged`) against the
template's capacity, and inserts only if there is room (ADR 0004).

```mermaid
sequenceDiagram
    participant C as Customer app
    participant B as book()
    participant S as slot_templates
    participant BP as blocked_periods
    participant A as appointments

    C->>B: book(slot, starts_at)
    B->>B: current_customer_id() or reject
    B->>S: lock slot template row
    S-->>B: capacity, duration_minutes
    B->>BP: check blocked_periods overlapping the slot
    BP-->>B: none or blocked (blocked means error - slot is blocked)
    B->>A: count status in (booked, charged) for that slot
    A-->>B: occupied
    alt occupied < capacity
        B->>A: insert booked, source self_booked
        B-->>C: appointment
    else slot full
        B-->>C: error - slot is full
    end
```
