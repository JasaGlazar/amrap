# 0018. Customers do not book in the first release

Status: Accepted
Date: 2026-11-19

## Context

The owner wants a minimal first release for customers. In it, the trainer books every
appointment. A customer sees their appointments and balance, cancels, and gets notifications,
but does not book their own slots. The booking code (`book()` for customers, the customer
calendar) already works and is tested, and the owner may want it later.

The same release changes the cutoff from 5 to 8 hours. ADR 0001 named 5 hours as the default.
The cutoff is `settings.late_cancel_hours`, and `cancel()`, the reminder job and the app already
read it.

## Decision

- Hide and block customer booking with a setting, and keep the code. New column
  `settings.customer_booking_enabled boolean not null default false`.
- `book()` checks the setting right after its role check. When the caller is not the trainer
  and the setting is false, it raises `AMRAP_BOOKING_DISABLED`. A missing settings row fails
  closed with `AMRAP_SETTINGS_MISSING`. The trainer and `materialize_recurring` do not read the
  setting.
- The app reads the setting and hides the customer calendar route and its navigation entry
  while it is false.
- The setting has no UI. The owner turns it on with one SQL statement
  ([runbook](../runbook.md#turn-customer-booking-on)).
- The cutoff default and the current row value become 8 hours.

## Consequences

- Turning customer booking on later is one database change and needs no deploy.
- The customer booking code stays tested: pgTAP files where a customer books turn the setting
  on in their fixtures.
- A customer's call to `book()` from a stale screen gets `AMRAP_BOOKING_DISABLED`, so the app
  needs Slovenian copy for it.
- The cutoff reminder moves with the cutoff: it arrives about 9 hours before the session.
- ADR 0001 still says the default cutoff is 5 hours; this ADR replaces that number.
