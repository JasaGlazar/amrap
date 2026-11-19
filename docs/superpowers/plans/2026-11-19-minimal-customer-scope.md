# Minimal Customer Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers cannot book; they see their fixed appointments, cancel one, and undo a free cancel until an 8-hour cutoff, and the trainer is told about every cancel and undo.

**Architecture:** Three database migrations (booking switch and cutoff; `undo_cancel` RPC; `booking_restored` notification), each test-first with pgTAP. Then two app tasks: hide the customer booking screen behind the new setting, and add the undo button. No code is deleted.

**Tech Stack:** Supabase Postgres (plpgsql RPCs, pgTAP, pg_cron), Deno edge function `send-push`, React + Vite + Vitest app in `app/`.

**Spec:** `docs/superpowers/specs/2026-11-19-minimal-customer-scope-design.md`

## Global Constraints

- Every database change follows `.claude/skills/new-migration/SKILL.md`: `supabase migration new <name>`, failing pgTAP test first, `supabase db reset && supabase test db && supabase db lint`, docs in the same commit, regenerated `app/src/lib/database.types.ts`.
- Never edit a migration that is on `main`. Replace functions with `create or replace` in a new migration.
- RPCs: `language plpgsql security definer set search_path = ''`, explicit role check, errors as `raise exception 'AMRAP_<CODE>: detail' using errcode = 'P0001'`, explicit grants.
- One charge per appointment. `undo_cancel` writes no `credit_transactions` row.
- Cutoff comparisons use `now() < starts_at - cutoff` (strict), the same as `cancel()`.
- Docs 1:1: every migration file in `docs/schema.md`, every public function in `docs/rpcs.md` (`bash scripts/check-docs.sh`). New test files go in the `docs/harness.md` "Testing" table.
- UI copy is Slovenian in `app/src/i18n/sl.ts`, in the style of `docs/copy-review.md`. Identifiers and docs are English, plain words.
- Code comments stay minimal; behaviour is explained in `docs/<layer>.md`.
- No test asserts a hardcoded total; expectations come from the inserted fixtures.
- Each task ends with one commit and all of these green: `supabase test db`, `supabase db lint`, `bash scripts/check-docs.sh`, and in `app/`: `npm run lint && npm run typecheck && npm test -- --run`.

## Review Focus

1. **A stale app tab still shows the booking screen after the setting is off.** Booking must show the `AMRAP_BOOKING_DISABLED` copy, not crash. (Task 4)
2. **Undo at exactly the cutoff instant.** It must be refused; only strictly before the cutoff is allowed. (Task 2)
3. **Undo races the trainer filling the last spot.** Capacity is never exceeded; the loser gets `AMRAP_CAPACITY_FULL`. (Task 2)
4. **Cancel, undo, cancel, undo on one appointment.** The trainer gets a notification row for each of the four changes. (Task 3)
5. **The settings read fails in the customer shell.** Booking is treated as off and the rest of the app works. (Task 4)

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_customer_booking_switch.sql` | cutoff 8, `settings.customer_booking_enabled`, check in `book()` |
| `supabase/migrations/<ts>_undo_cancel.sql` | `undo_cancel` RPC |
| `supabase/migrations/<ts>_booking_restored_notification.sql` | enum value, trigger, repeat-notification fix |
| `supabase/tests/035_booking_switch.sql`, `036_undo_cancel.sql`, `037_booking_restored.sql` | pgTAP for each migration |
| `supabase/functions/send-push/types.ts`, `payload.ts`, `payload_test.ts` | new kind in the push payload |
| `app/src/data/settings.ts`, `app/src/data/appointments.ts` | `customerBookingEnabled`, `undoCancel` |
| `app/src/pages/CustomerPages.tsx`, `app/src/routes.tsx` | hide the calendar entry and route |
| `app/src/pages/customer/Home.tsx`, `app/src/pages/shared/CancelDialog.tsx` | undo button, dialog note |
| `app/src/push/render.ts`, `app/src/i18n/sl.ts` | copy for the new kind, errors and buttons |

---

### Task 1: Booking switch and 8-hour cutoff (database)

**Files:**
- Create: `supabase/migrations/<ts>_customer_booking_switch.sql`, `supabase/tests/035_booking_switch.sql`, `docs/adr/0018-customers-do-not-book-in-first-release.md`
- Modify: existing pgTAP files in which a customer calls `book()` (find with `grep -ln "book(" supabase/tests`), `app/src/lib/database.types.ts`, `docs/schema.md`, `docs/rpcs.md`, `docs/architecture/data-model.md`, `docs/harness.md`, `docs/runbook.md`, `docs/adr/README.md`, `CONTEXT.md`

**Interfaces:**
- Produces: column `public.settings.customer_booking_enabled boolean not null default false`; error token `AMRAP_BOOKING_DISABLED` from `public.book(uuid, timestamptz, uuid, timestamptz)`; `settings.late_cancel_hours` default and current value 8.

- [ ] **Step 1: Write `035_booking_switch.sql`** with these tests (fixtures as in `011_cancel.sql`: one trainer, one customer, one active slot template, a future occurrence):
  - `settings.late_cancel_hours` is 8 for row `id = 1` and the column default is 8.
  - `customer_booking_enabled` is false by default.
  - Customer `book()` on their own future slot → `throws_matching(..., '^AMRAP_BOOKING_DISABLED:')`.
  - Trainer `book()` for that customer with the setting false → succeeds.
  - `materialize_recurring` for an active rule with the setting false → creates the instance.
  - With the setting true, customer `book()` succeeds.
  - With the settings row deleted, customer `book()` → `^AMRAP_SETTINGS_MISSING:`.
- [ ] **Step 2: Run `supabase test db`.** Expected: `035` fails (column does not exist).
- [ ] **Step 3: Write the migration.** `update public.settings set late_cancel_hours = 8 where id = 1`; `alter ... set default 8`; add the column; `create or replace function public.book(...)` copied from `20261024222414_cancel_occurrence.sql` with one added block directly after the `AMRAP_FORBIDDEN` role check: for a non-trainer caller, read `customer_booking_enabled` from `settings` (`id = 1`); no row → `AMRAP_SETTINGS_MISSING`; false → `AMRAP_BOOKING_DISABLED: customer booking is turned off`.
- [ ] **Step 4: Fix existing tests.** In each existing test file where a customer books through `book()`, add `update public.settings set customer_booking_enabled = true where id = 1;` to the fixtures. Any test that derives times from a hardcoded 5-hour cutoff must read `late_cancel_hours` instead. Do not change assertions.
- [ ] **Step 5: Run `supabase db reset && supabase test db && supabase db lint`.** Expected: all green.
- [ ] **Step 6: Docs.** `docs/schema.md` (migration row, new column, default 8), `docs/architecture/data-model.md`, `docs/rpcs.md` (`book` rules and the error token table), `docs/harness.md` (test file row), `CONTEXT.md` (cutoff default 8; new term **booking setting**; rule "Customers book only when `settings.customer_booking_enabled` is true"). `docs/runbook.md`: new section "Turn customer booking on" (`update public.settings set customer_booking_enabled = true where id = 1;` and that the app shows the calendar entry on the next load). ADR 0018: context (owner wants a minimal first release), decision (hide and block with a setting, keep the code), consequences. Add it to `docs/adr/README.md`.
- [ ] **Step 7: Regenerate types** with `supabase gen types typescript --local > app/src/lib/database.types.ts`, run the app checks, run `bash scripts/check-docs.sh`.
- [ ] **Step 8: Commit** — `feat: turn customer booking off by a setting and set the cutoff to 8 hours`.

---

### Task 2: `undo_cancel` RPC

**Files:**
- Create: `supabase/migrations/<ts>_undo_cancel.sql`, `supabase/tests/036_undo_cancel.sql`
- Modify: `app/src/lib/database.types.ts`, `docs/schema.md`, `docs/rpcs.md`, `docs/harness.md`, `CONTEXT.md`, the appointment state diagram in `docs/architecture/`

**Interfaces:**
- Consumes: `settings.late_cancel_hours`; the advisory lock key `book()` uses for a slot template and start (copy the expression from `book()`).
- Produces: `public.undo_cancel(p_appointment_id uuid) returns void`, granted to `authenticated, service_role`; new error token `AMRAP_NOT_UNDOABLE`.

- [ ] **Step 1: Write `036_undo_cancel.sql`.** Fixtures: trainer, customers A and B, one slot template with capacity 1 and one with capacity 5, appointments inserted directly with starts derived from `now()` and `late_cancel_hours`. One test per line:
  - A undoes their own `cancelled` appointment before the cutoff → status `booked`, `cancelled_at` null.
  - That undo inserts no `credit_transactions` row (count for the appointment unchanged).
  - `charge_due_appointments()` charges a restored appointment whose start has passed (move `starts_at` back as superuser), exactly one `session` row.
  - B undoes A's appointment → `^AMRAP_FORBIDDEN:`.
  - The trainer calls it → `^AMRAP_FORBIDDEN:`.
  - A user without a customer row → `^AMRAP_FORBIDDEN:`.
  - Unknown id → `^AMRAP_NOT_FOUND:`; null id → `^AMRAP_INVALID_ARGUMENT:`.
  - Status `booked`, `charged`, `cancelled_late`, `cancelled_by_trainer` → each `^AMRAP_NOT_UNDOABLE:`.
  - `starts_at - cutoff` equal to `now()` → `^AMRAP_NOT_UNDOABLE:` (Review Focus 2); one second later than `now()` → succeeds.
  - Settings row deleted → `^AMRAP_SETTINGS_MISSING:`.
  - Appointment overlaps a blocked period → `^AMRAP_BLOCKED:`.
  - Capacity-1 slot now holds B's `booked` appointment → `^AMRAP_CAPACITY_FULL:` and the live count stays 1 (Review Focus 3).
  - Slot template deactivated → `^AMRAP_SLOT_INACTIVE:`.
  - A has another live appointment at the same start → `^AMRAP_ALREADY_BOOKED:`.
  - Instance whose `recurring_rules` row is inactive → `^AMRAP_NOT_UNDOABLE:`; with the rule active → succeeds.
  - Ad-hoc appointment (`slot_template_id` null) → succeeds without a capacity check.
- [ ] **Step 2: Run `supabase test db`.** Expected: `036` fails (function does not exist).
- [ ] **Step 3: Write the migration.** Order of checks: argument; caller is a linked non-trainer customer; `select ... for update` on the appointment (not found); ownership; status `cancelled`; settings and cutoff; rule active when `rule_id` is set; blocked-period overlap on `[starts_at, ends_at)`; for a slot appointment: template active, then the advisory lock, then the live count (`booked` + `charged`) against capacity; no other live appointment of this customer at `starts_at`. Then `update ... set status = 'booked', cancelled_at = null`. Take the advisory lock before counting, as `book()` does, so a concurrent `book()` and `undo_cancel()` on the same occurrence are serialized.
- [ ] **Step 4: Run `supabase db reset && supabase test db && supabase db lint`.** Expected: all green.
- [ ] **Step 5: Docs.** `docs/rpcs.md`: new `## undo_cancel` section (signature, who may call, rules in order, side effects) and `AMRAP_NOT_UNDOABLE` plus the reused tokens in the error table. `docs/schema.md` migration row. State diagram: arrow `cancelled → booked`. `CONTEXT.md`: term **undo**; rule "A `cancelled_late` or `cancelled_by_trainer` appointment cannot be restored." `docs/harness.md` test row.
- [ ] **Step 6: Regenerate types, run app checks and `bash scripts/check-docs.sh`.**
- [ ] **Step 7: Commit** — `feat: let a customer undo a free cancel before the cutoff`.

---

### Task 3: `booking_restored` notification and repeat notifications

**Files:**
- Create: `supabase/migrations/<ts>_booking_restored_notification.sql`, `supabase/tests/037_booking_restored.sql`
- Modify: `supabase/functions/send-push/types.ts`, `payload.ts`, `payload_test.ts`, `app/src/push/render.ts`, `app/src/push/render.test.ts`, `app/src/i18n/sl.ts`, `app/src/lib/database.types.ts`, `docs/notifications.md`, `docs/schema.md`, `docs/rpcs.md`, `docs/harness.md`, `CONTEXT.md`

**Interfaces:**
- Consumes: `public.undo_cancel(uuid)` (Task 2); `public.enqueue_notification(uuid, public.notification_kind, jsonb, uuid, uuid)`.
- Produces: enum value `booking_restored` in `public.notification_kind`; trigger function `public.notify_booking_restored()`; `data` keys `appointment_id`, `customer_name`, `starts_at`, `timezone`.

- [ ] **Step 1: Write `037_booking_restored.sql`.** Set up push as `032_event_notifications.sql` does (config and a trainer push subscription). Tests:
  - Customer undo writes one `booking_restored` row for the trainer with the four `data` keys.
  - The customer gets no row for their own undo.
  - With no trainer subscription, no row is written and the undo still succeeds.
  - Cancel, undo, cancel, undo on one appointment: after each step the newest row of the matching kind has `created_at`/`dispatched_at` of a fresh row, so that the trainer is told four times (Review Focus 4). Assert by marking each row dispatched as superuser and checking that the next change leaves one undispatched row of its kind.
  - A status change `cancelled → booked` made as superuser with a broken config still succeeds (the trigger never fails the write).
- [ ] **Step 2: Run `supabase test db`.** Expected: `037` fails.
- [ ] **Step 3: Write the migration.** `alter type public.notification_kind add value 'booking_restored';` as the first statement; no statement in this migration may use the value outside a plpgsql body (Postgres does not allow a new enum value to be used in the transaction that adds it). `notify_booking_restored()` modelled on `notify_booking_cancelled()` in `20261023215339_event_notifications.sql`: same recipient choice, same best-effort `exception when others` block. Trigger `appointments_notify_booking_restored after update of status ... when (old.status = 'cancelled' and new.status = 'booked')`. Repeat notifications: in both `notify_booking_restored()` and a replaced `notify_booking_cancelled()`, delete the existing `notifications` row of that kind for the appointment before calling `enqueue_notification`, so the unique `(kind, appointment_id)` key does not swallow the second event. Revoke execute on the trigger function from `public, anon, authenticated, service_role`.
- [ ] **Step 4: `send-push`.** Add `booking_restored` to `NotificationKind` in `types.ts` and to `URLS` in `payload.ts` with `/t`. Test in `payload_test.ts`: url `/t`, ttl 24 hours, urgency `normal`, no topic. Run `bash scripts/test-functions.sh`.
- [ ] **Step 5: App rendering.** `app/src/push/render.ts` and `sl.ts`: title and body for `booking_restored` in the same shape as `booking_cancelled` (customer name and local start time). Test in `render.test.ts`.
- [ ] **Step 6: Run `supabase db reset && supabase test db && supabase db lint`, regenerate types, run app checks.**
- [ ] **Step 7: Docs.** `docs/notifications.md`: row in "Kinds and data", row in the payload table, and a paragraph on repeat cancel/undo. `docs/rpcs.md` (new function), `docs/schema.md`, `docs/harness.md`, `CONTEXT.md` (notification kinds list).
- [ ] **Step 8: Commit** — `feat: notify the trainer when a customer restores a cancelled appointment`.

---

### Task 4: Hide customer booking in the app

**Files:**
- Modify: `app/src/data/settings.ts`, `app/src/pages/CustomerPages.tsx`, `app/src/routes.tsx`, `app/src/i18n/sl.ts`, `app/src/test/fakeSupabase.ts` (if the settings fixture needs the new column), tests next to each (`app/src/data/data.test.ts`, `app/src/routes.test.tsx`, `app/src/pages/customer/customer.test.tsx`), `docs/screens.md`, `docs/app-structure.md`

**Interfaces:**
- Consumes: `settings.customer_booking_enabled`, error token `AMRAP_BOOKING_DISABLED` (Task 1).
- Produces: `GymSettings = { lateCancelHours: number; timeZone: string; customerBookingEnabled: boolean }` from `getSettings(client)`.

- [ ] **Step 1: Write failing tests.**
  - `getSettings` returns `customerBookingEnabled` from the row.
  - Customer shell with the setting false: no link to `/c/koledar`; with true: the link is there.
  - Visiting `/c/koledar` with the setting false redirects to `/c`.
  - Settings read fails: no calendar link, Home still renders (Review Focus 5).
  - `book` returning `AMRAP_BOOKING_DISABLED` shows `t.errors.AMRAP_BOOKING_DISABLED` in the calendar's notice line (Review Focus 1; render the calendar directly with the setting true and the fake RPC failing).
- [ ] **Step 2: Run `npm test -- --run` in `app/`.** Expected: the new tests fail.
- [ ] **Step 3: Implement.** Add the column to the `select` in `getSettings`. In `CustomerPages.tsx` load the settings once with `useLoad`; build the nav items without the calendar entry unless the load succeeded with `customerBookingEnabled` true. Guard the `koledar` child route under `/c` in `routes.tsx` with the same value and `<Navigate to="/c" replace />`. Add `errors.AMRAP_BOOKING_DISABLED` copy: "Rezervacije prek aplikacije trenutno niso mogoče. Termine vam dodeli trener."
- [ ] **Step 4: Run `npm run lint && npm run typecheck && npm test -- --run && npm run build`.** Expected: all pass.
- [ ] **Step 5: Docs.** `docs/screens.md` (customer navigation and the calendar route depend on the setting), `docs/app-structure.md` if it lists the settings type.
- [ ] **Step 6: Commit** — `feat: hide the customer booking screen when booking is off`.

---

### Task 5: Undo button on the customer home

**Files:**
- Modify: `app/src/data/appointments.ts`, the customer home data loader it uses, `app/src/pages/customer/Home.tsx`, `app/src/pages/shared/CancelDialog.tsx`, `app/src/i18n/sl.ts`, `app/src/pages/customer/customer.test.tsx`, `app/src/data/data.test.ts`, `docs/screens.md`, `docs/data-layer.md`, `docs/copy-review.md`

**Interfaces:**
- Consumes: `public.undo_cancel(p_appointment_id uuid)` and its error tokens (Task 2); `GymSettings.lateCancelHours` (existing).
- Produces: `undoCancel(client: Client, appointmentId: string): Promise<ActionResult<null>>` in `app/src/data/appointments.ts`, built with `runAction` like `cancel`.

- [ ] **Step 1: Write failing tests.**
  - `undoCancel` calls the `undo_cancel` RPC with `{ p_appointment_id }` and maps an `AMRAP_NOT_UNDOABLE` error to its copy.
  - Home lists a future appointment with status `cancelled` and a start later than now + cutoff in a section "Odpovedani termini" with a button "Razveljavi odpoved".
  - Home does not list a `cancelled` appointment inside the cutoff, a `cancelled_late` one or a `cancelled_by_trainer` one in that section.
  - Tapping the button calls `undoCancel`, reloads, and shows the status line "Termin je spet rezerviran."
  - A failed undo shows the error copy and keeps the appointment in the section.
  - The cancel dialog for a free cancel shows the note with the cutoff as a local clock time.
- [ ] **Step 2: Run `npm test -- --run`.** Expected: the new tests fail.
- [ ] **Step 3: Implement.** Extend the home loader to also return the customer's future `cancelled` appointments (ordered by start). Filter by the cutoff in the page with the loaded `lateCancelHours`; the database stays the authority. Copy: `errors.AMRAP_NOT_UNDOABLE`: "Te odpovedi ni več mogoče razveljaviti."; dialog note: "Odpoved lahko razveljavite do {time}." (date and time of `starts_at − cutoff` in `settings.timezone`, formatted with the helpers described in `docs/time.md`).
- [ ] **Step 4: Run `npm run lint && npm run typecheck && npm test -- --run && npm run build`.** Expected: all pass.
- [ ] **Step 5: Check on a phone-width screen.** Run the local stack and `npm run dev -- --host`, sign in as a seeded customer, cancel a fixed appointment, undo it. Report what was seen.
- [ ] **Step 6: Docs.** `docs/screens.md` (new section on Home, dialog note), `docs/data-layer.md` (`undoCancel`, loader change), `docs/copy-review.md` (new strings).
- [ ] **Step 7: Commit** — `feat: let customers undo a cancel from the home screen`.

---

## After the last task

- Whole-branch review, then one PR to `main`.
- Owner actions: `supabase db push` and the `release-checklist` skill; tell the gym owner the reminder now arrives about 9 hours before a session.
