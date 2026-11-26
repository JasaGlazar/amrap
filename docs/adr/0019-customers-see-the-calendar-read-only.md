# 0019. Customers see the calendar read-only

Status: Accepted
Date: 2026-11-26

## Context

The gym owner asked that every customer can see which sessions are free. ADR 0018 hid the
customer calendar route and its navigation entry while `settings.customer_booking_enabled` is
false. So while booking is off, a customer could not see the free places at all.

## Decision

- The customer calendar is always visible, with its route and its navigation entry.
- `settings.customer_booking_enabled` only decides whether the calendar has book buttons. While
  it is false, the calendar is read-only: it shows the free places of each session, a full tag
  on a full session, the customer's own appointments with cancel, and a hint line.
- `book()` still refuses customers with `AMRAP_BOOKING_DISABLED` while the setting is false.
- Customers see counts only: free places and capacity, never who booked.

## Consequences

- This refines one sentence of ADR 0018: the app no longer hides the customer calendar route
  and its navigation entry. Everything else in ADR 0018 stands.
- The customer shell reads no settings. Only the calendar reads the setting, when it loads.
- A customer sees the book buttons the next time the calendar loads after the setting turns on.
