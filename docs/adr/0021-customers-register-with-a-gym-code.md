# 0021. Customers register themselves with a gym code

Status: Accepted
Date: 2026-11-27

## Context

The gym will hang a QR code on the wall. A new customer scans it, registers in the app, and the
trainer then gives them fixed appointments. ADR 0006 made the trainer's invite the only way in:
the trainer creates the record first, then sends a link. The owner wants people to join
without the trainer doing anything first.

Email is still not confirmed (ADR 0006), so an email address proves nothing. Without some
other proof, anyone with the link could fill the trainer's customer list with fake records.

## Decision

This refines ADR 0006. Invites stay, and registration is a second way in.

- A signed-in user without a customer record calls
  `register_customer(name, phone, code)`. It creates one `customers` row with the role
  `customer`, linked to the caller, with `registered_at = now()`. Registration never creates
  a trainer, and the role still comes from the `customers` row, never from auth metadata.
- The gym code is the proof that the person saw the QR code in the gym. The QR link carries
  it. The trainer sets, replaces or clears it with `set_registration_code(code)`. A code has 8
  or more characters; the app generates it. Null means registration is closed.
- "Closed" and "wrong code" give the same error, `AMRAP_REGISTRATION_CLOSED`. The code is
  checked before name and phone, so no answer confirms a code.
- The code lives in its own one-row table, `registration_settings`, not in a `settings`
  column. Customers can read `settings`, and the code must never be readable by a customer or
  a signed-out user. Only the trainer can read the table, and nobody writes it through the API.
- Email stays unconfirmed. No email is sent.

## Consequences

- A person can join without the trainer. The new record has no appointments and no credits
  until the trainer acts, so no approval step is needed.
- If the code leaks, the trainer makes a new code and prints a new QR code. Every old QR code
  stops working.
- A person who already has a record from the trainer can register again and get a second
  record. The trainer fixes that by hand; invites stay the way to link an existing record.
- `customers.registered_at` tells registered records from records the trainer created.
- ADR 0006 still says customers join only through invites; this ADR replaces that sentence.
