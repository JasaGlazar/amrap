# Minimal customer scope — design

Date: 2026-11-19. Status: Approved by the owner on 2026-11-19.

## Intent

The gym owner wants a smaller first release. Customers do not book sessions themselves. The
trainer gives each customer fixed appointments (recurring rules), and the customer only works
with those: see them, see history, cancel one, and undo that cancel while it is still free.

This is the first of three projects. The other two get their own design docs:
browser tests in CI (Playwright), and self-registration from a QR code.

## Goals

1. A customer cannot book. The booking screen is hidden and the database refuses the call.
2. The cutoff is 8 hours.
3. A customer can undo their own free cancel until the cutoff.
4. The trainer gets a push when a customer undoes a cancel.
5. Customer booking can be turned on again later without restoring deleted code.

## Non-goals

- Self-registration and Google sign-in (separate design).
- Playwright tests (separate design). This project keeps the existing test layers: pgTAP,
  Vitest, Deno.
- Changes to how the trainer assigns, cancels or switches off fixed appointments. Those RPCs
  (`activate_rule`, `deactivate_rule`, `cancel`, `cancel_occurrence`) and their customer
  notifications already exist and stay as they are.
- Turning push on for the hosted project. That is the owner procedure in
  `docs/runbook.md` ("Turn on push notifications") plus a test on a real phone.

## Anti-goals

- Deleting the customer booking code. The owner may want it back.
- A second appointment row for the same customer and session after an undo.
- Any path where an undo avoids or reverses a charge.

## Constraints

- All credit and capacity changes go through `SECURITY DEFINER` RPCs with explicit role checks
  (CONTEXT.md).
- One charge per appointment. Undo never touches the ledger.
- Supabase free tier. No new services.
- Every migration and public function must appear in `docs/schema.md` and `docs/rpcs.md`
  (`scripts/check-docs.sh`). Use the `new-migration` skill.
- UI copy is Slovenian, in `app/src/i18n/sl.ts`. Identifiers and docs are English.

## Approaches

**Undo of a cancel**

| Approach | Trade-off |
|---|---|
| A. New `undo_cancel` RPC that sets the same appointment back to `booked` | One row per session, keeps `rule_id` and `source`, booking can stay closed. Needs one new RPC. **Chosen.** |
| B. Customer books the slot again through `book()` | No new RPC, but creates a second row for the same session, loses the link to the rule, and needs booking left open for customers. Rejected. |

**Stopping customer booking**

| Approach | Trade-off |
|---|---|
| A. Setting `customer_booking_enabled` checked inside `book()`, plus hiding the screen | Turned back on by changing one setting. **Chosen.** |
| B. Hide the screen only | A signed-in customer can still call `book()` directly. Rejected. |
| C. Delete the customer path in `book()` and the screen | Less code, but the owner said it may come back. Rejected. |

The owner picked hide plus block (A) and approved undo approach A on 2026-11-19.

## Design

### 1. Cutoff of 8 hours

One migration sets `settings.late_cancel_hours` to 8 for the existing row and changes the
column default to 8. `cancel()`, the reminder job and the app already read this value, so
nothing else changes. The reminder moves with it: it arrives 45 to 75 minutes before the
cutoff, so about 9 hours before the session.

### 2. Customer booking off

- New column `settings.customer_booking_enabled boolean not null default false`.
- `book()`: when the caller is not the trainer and the setting is false, raise a new error
  `AMRAP_BOOKING_DISABLED`. The check comes right after the existing role check. A missing
  settings row fails closed (`AMRAP_SETTINGS_MISSING`). The trainer and
  `materialize_recurring` are not affected.
- App: the customer shell reads the setting. When it is false, the customer calendar route
  and its navigation entry are not shown, and a direct visit to the route redirects to the
  customer home. `errors.AMRAP_BOOKING_DISABLED` gets Slovenian copy for the case where a
  stale screen still sends the call.
- The setting has no UI in this project. Turning it on is a database change by the owner,
  described in the runbook.

### 3. `undo_cancel`

```
public.undo_cancel(p_appointment_id uuid) returns void
```

Caller: a customer, for their own appointment. The trainer does not need it (the trainer can
book the customer again) and gets `AMRAP_FORBIDDEN`.

Checks, in order, with the appointment row locked `for update` as in `cancel()`:

1. Signed-in customer, and the appointment belongs to them → else `AMRAP_FORBIDDEN`;
   unknown appointment → `AMRAP_NOT_FOUND`.
2. Status is `cancelled` → else new error `AMRAP_NOT_UNDOABLE`. This excludes `cancelled_late`
   (already charged, final) and `cancelled_by_trainer` (the trainer's decision).
3. `now() < starts_at - cutoff` → else `AMRAP_NOT_UNDOABLE`. Missing settings row →
   `AMRAP_SETTINGS_MISSING`.
4. The appointment does not overlap a blocked period → else `AMRAP_BLOCKED`.
5. For a slot appointment: take the same advisory lock `book()` uses for that slot and start,
   then count live appointments; at capacity → `AMRAP_CAPACITY_FULL`. Slot template
   deactivated → `AMRAP_SLOT_INACTIVE`.
6. The recurring rule the instance came from, if any, is still active → else
   `AMRAP_NOT_UNDOABLE`. (Builder's call: without this check a customer could bring back an
   instance of a fixed appointment the trainer has switched off. `deactivate_rule` marks future
   booked instances `cancelled_by_trainer`, but an instance the customer cancelled first stays
   `cancelled`.)

Effect: status → `booked`, `cancelled_at` → null. No ledger row. The "customer already has a
live appointment at that start" rule from `book()` also applies; a conflict raises
`AMRAP_ALREADY_BOOKED`.

Because the row goes back to `booked`, the charge job and the reminder job treat it like any
other booked appointment. The reminder is at most one per appointment, so a customer who
already got it does not get a second one.

### 4. Notification to the trainer

New kind `booking_restored`, recipient the trainer, written by a trigger when an appointment
changes from `cancelled` to `booked`. `data`: `appointment_id`, `customer_name`, `starts_at`,
`timezone`. Payload like `booking_cancelled`: url `/t`, TTL 24 hours, normal urgency.

The log allows one row per kind and appointment. A customer who cancels, undoes, cancels
again and undoes again would then notify the trainer only for the first of each. The builder
must check how `booking_cancelled` behaves on the second cancel and make both kinds consistent:
the trainer should be told about every change. This is the builder's call on the mechanism
(for example, deleting the earlier row of that kind for the appointment before inserting).

### 5. Customer screens

- Home shows a cancelled appointment with an undo button while it can be undone: status
  `cancelled` and the cutoff not passed. History is unchanged. The button calls `undo_cancel`
  and refreshes the list. Errors show their `errors.AMRAP_*` copy.
- The cancel dialog says that the cancel can be undone until the cutoff time, shown as a
  clock time.
- No other screen changes. Fixed appointments already appear as upcoming appointments.

### 6. Docs

Update `CONTEXT.md` (cutoff default, new terms "undo" and "booking setting"), `docs/rpcs.md`,
`docs/schema.md`, `docs/notifications.md`, `docs/screens.md`, `docs/runbook.md` (how to turn
customer booking on), and add one ADR for "customers do not book in the first release".

## Tests

- pgTAP: `book()` refuses a customer when the setting is off and allows the trainer and
  materialization; every `undo_cancel` check above, one test each; undo writes no ledger row;
  the restored appointment is charged by the charge job at its start; `booking_restored` is
  written for the trainer.
- Vitest: the calendar entry is hidden when the setting is off; the undo button shows only for
  an undoable appointment; the error copy shows.
- Deno: `send-push` payload for `booking_restored`.

## Left to the builder

- Migration split (one or several), following the `new-migration` skill.
- The exact place of the undo button and the Slovenian copy, in the style of
  `docs/copy-review.md`.
- The mechanism for repeat notifications in section 4.

## Owner actions after merge

- `supabase db push` and the release checklist.
- Tell the gym owner that the reminder now arrives about 9 hours before a session.
