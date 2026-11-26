# Self-Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who scans the gym's QR code creates their own account and customer record; the trainer is told, sees the new customer marked, and assigns fixed appointments.

**Architecture:** The app signs the person up with Supabase Auth and then calls a new `SECURITY DEFINER` RPC, `register_customer`, which checks a gym code and creates the linked `customers` row (the same two-step shape as `accept_invite`). The gym code lives in its own one-row table that only the trainer can read. A trigger notifies the trainer. The trainer manages the code in Settings and can delete a record that has no history.

**Tech Stack:** Supabase Postgres (plpgsql, pgTAP), Deno edge function `send-push`, React + Vitest app, Playwright (from the browser-tests plan).

**Spec:** `docs/superpowers/specs/2026-11-19-self-registration-design.md` (owner decisions of 2026-11-26 included)

**Starts from:** `main` after the browser tests are merged. Branch `feat/self-registration`.

## Global Constraints

- Every database change follows `.claude/skills/new-migration/SKILL.md`: `supabase migration new <name>`, failing pgTAP test first, `supabase db reset && supabase test db && supabase db lint`, docs in the same commit, regenerated `app/src/lib/database.types.ts`. Never edit a migration that is on `main`.
- RPCs: `language plpgsql security definer set search_path = ''`, explicit role check, errors as `raise exception 'AMRAP_<CODE>: detail' using errcode = 'P0001'`, explicit grants and revokes.
- Registration only ever creates role `customer`. Role comes from the `customers` row, never from auth metadata.
- The gym code is never readable by a customer or a signed-out user, in any table, view or RPC result.
- "Closed" and "wrong code" give the same error, `AMRAP_REGISTRATION_CLOSED`.
- Name: trimmed, 2 to 80 characters. Phone: trimmed, 6 to 30 characters, required. Gym code: 8 or more characters. Password: at least 6 characters (`minimum_password_length` in `supabase/config.toml`).
- No email is sent. Email stays unconfirmed. No Google sign-in. No QR library in the app.
- The invite flow (`create_invite`, `accept_invite`, `/invite/:token`) stays unchanged.
- Every new error token gets copy in `sl.ts` (`app/src/i18n/sl.test.ts` checks this against `docs/rpcs.md`) and a row in `docs/copy-review.md`.
- Docs 1:1 (`bash scripts/check-docs.sh`); new test files go in the `docs/harness.md` "Testing" table. Docs are plain English; code comments minimal; no hardcoded test totals.
- Gates for every task: `supabase test db`, `supabase db lint`, generated types current, `bash scripts/check-docs.sh`, `bash scripts/test-functions.sh`, and in `app/`: `npm run lint && npm run typecheck && npm test -- --run && npm run build && npm run e2e`.

## Review Focus

1. **The browser closes between sign-up and `register_customer`.** The person signs in later and can finish: the not-linked page links to registration, and the short form creates the record. (Task 4)
2. **The same person submits twice, or two tabs submit at once.** Exactly one customer record exists; the second call gets `AMRAP_ALREADY_LINKED`. (Task 1)
3. **A person registers with an email that already has an account.** With the right password they continue; with a wrong one they are told to sign in, and no data of the existing account is shown. (Task 4)
4. **The link has no code, or the trainer changed the code after the QR was printed.** No account is created without a code in the link; an old code is refused with copy that says to scan the code in the gym. (Tasks 1 and 4)
5. **A name or phone made of spaces, or very long.** Refused by the database with `AMRAP_INVALID_ARGUMENT`, and by the form before the request. (Tasks 1 and 4)

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_self_registration.sql` | table `registration_settings`, `customers.registered_at`, `register_customer`, `set_registration_code` |
| `supabase/migrations/<ts>_customer_registered_notification.sql` | enum value, trigger |
| `supabase/migrations/<ts>_delete_customer.sql` | `delete_customer` |
| `supabase/tests/038_registration.sql`, `039_customer_registered.sql`, `040_delete_customer.sql` | pgTAP |
| `app/src/data/registration.ts` | `registerCustomer`, `getRegistrationCode`, `setRegistrationCode` |
| `app/src/pages/RegisterPage.tsx` | the public registration page |
| `app/src/pages/trainer/SettingsRegistration.tsx` | the trainer's "Registracija" tab |
| `app/e2e/registration.spec.ts` | the browser test |

---

### Task 1: Gym code and `register_customer` (database)

**Files:**
- Create: `supabase/migrations/<ts>_self_registration.sql`, `supabase/tests/038_registration.sql`, `docs/adr/0020-customers-register-with-a-gym-code.md`
- Modify: `app/src/lib/database.types.ts`, `app/src/i18n/sl.ts` (error copy), `docs/copy-review.md`, `docs/schema.md`, `docs/rpcs.md`, `docs/architecture/data-model.md`, `docs/architecture/auth-invite-flow.md` (add the registration sequence), `docs/harness.md`, `docs/adr/README.md`, `CONTEXT.md`

**Interfaces:**
- Produces:
  - table `public.registration_settings (id int primary key default 1 check (id = 1), code text check (code is null or length(code) >= 8), updated_at timestamptz not null default now())` with one row, `code` null. RLS on; one policy: the trainer may select. No grants to `anon`. No insert, update or delete through the API.
  - column `public.customers.registered_at timestamptz` (null for trainer-created records).
  - `public.register_customer(p_name text, p_phone text, p_code text) returns uuid` — granted to `authenticated, service_role`; revoked from `public, anon`.
  - `public.set_registration_code(p_code text) returns void` — trainer only; null clears the code (closes registration); granted to `authenticated, service_role`.
  - error token `AMRAP_REGISTRATION_CLOSED`.

- [ ] **Step 1: Write `038_registration.sql`.** Fixtures: a trainer, a linked customer, two fresh auth users without a record. One test per line:
  - Signed-out call of `register_customer` → refused (no execute for `anon`).
  - With the code null → `^AMRAP_REGISTRATION_CLOSED:`.
  - With a code set and a wrong `p_code` → `^AMRAP_REGISTRATION_CLOSED:`; with `p_code` null → the same.
  - Correct code → returns an id; the row has role `customer`, the trimmed name and phone, `email` equal to the auth user's email, `auth_user_id` the caller, `registered_at` set.
  - A second call by the same user → `^AMRAP_ALREADY_LINKED:` and still exactly one row for that user (Review Focus 2).
  - An already linked customer calls it → `^AMRAP_ALREADY_LINKED:`. The trainer calls it → `^AMRAP_ALREADY_LINKED:`.
  - Name `'  '`, name of 1 character, name of 81 characters → each `^AMRAP_INVALID_ARGUMENT:`. Phone `'   '`, 5 characters, 31 characters, null → each `^AMRAP_INVALID_ARGUMENT:` (Review Focus 5).
  - Invalid arguments with a wrong code → `^AMRAP_REGISTRATION_CLOSED:` (the code is checked first, so the answer never confirms a code).
  - A customer and a signed-out user select from `registration_settings` → no rows. The trainer sees one row.
  - A customer updates `registration_settings` directly → no row changed.
  - `set_registration_code`: a customer → `^AMRAP_FORBIDDEN:`; the trainer with 7 characters → `^AMRAP_INVALID_ARGUMENT:`; with 8 → stored; with null → cleared, and `register_customer` with the old code is then refused.
- [ ] **Step 2: Run `supabase test db`.** Expected: `038` fails (relation does not exist).
- [ ] **Step 3: Write the migration.** `register_customer` order of checks: `auth.uid()` not null (`AMRAP_FORBIDDEN`); `public.current_customer_id()` is null (`AMRAP_ALREADY_LINKED`); the stored code is not null and equals `p_code` (`AMRAP_REGISTRATION_CLOSED`); name and phone lengths. Read the email from `auth.users` for `auth.uid()`. Insert inside a `begin ... exception when unique_violation` block that raises `AMRAP_ALREADY_LINKED`, as `accept_invite` does for the concurrent case.
- [ ] **Step 4: Run `supabase db reset && supabase test db && supabase db lint`.** Expected: all green.
- [ ] **Step 5: Docs and copy.** `docs/rpcs.md` (both functions, the error table), `docs/schema.md` (migration row, table, column, RLS matrix row), data-model diagram, registration sequence in the auth flow diagram, `docs/harness.md`, `CONTEXT.md` (terms **registration**, **gym code**; rule "Registration creates only customers"). ADR 0020: refines ADR 0006 (invites are no longer the only way in; the gym code is the proof that a person saw the QR; email stays unconfirmed; why a separate table and not a `settings` column — customers can read `settings`). `sl.ts`: `errors.AMRAP_REGISTRATION_CLOSED: 'Registracija ni mogoča. Skenirajte QR kodo v telovadnici ali se obrnite na trenerja.'`
- [ ] **Step 6: Regenerate types, run all gates.**
- [ ] **Step 7: Commit** — `feat: let a person register as a customer with the gym code`.

---

### Task 2: `customer_registered` notification

**Files:**
- Create: `supabase/migrations/<ts>_customer_registered_notification.sql`, `supabase/tests/039_customer_registered.sql`
- Modify: `supabase/tests/030_notifications.sql` and `032_event_notifications.sql` (their pinned lists of kinds and triggers grow), `supabase/functions/send-push/types.ts`, `payload.ts`, `payload_test.ts`, `app/src/push/render.ts`, `render.test.ts`, `app/src/i18n/sl.ts`, `app/src/lib/database.types.ts`, `docs/notifications.md`, `docs/rpcs.md`, `docs/schema.md`, `docs/harness.md`, `docs/architecture/push-sequence.md`, `docs/copy-review.md`, `CONTEXT.md`

**Interfaces:**
- Consumes: `customers.registered_at` (Task 1); `public.enqueue_notification(uuid, public.notification_kind, jsonb, uuid, uuid)`.
- Produces: enum value `customer_registered`; trigger function `public.notify_customer_registered()`; `data` keys `customer_id`, `customer_name`; push `url` `/t/stranke/<customer_id>`.

- [ ] **Step 1: Write `039_customer_registered.sql`** (push configured and a trainer push subscription, as in `032_event_notifications.sql`):
  - A registration writes one `customer_registered` row whose recipient is the trainer, with both `data` keys.
  - A customer the trainer creates (no `registered_at`) writes none.
  - Two registrations write two rows (both have a null `appointment_id`, so the unique key does not merge them).
  - With no trainer subscription, no row is written and the registration succeeds.
  - With a broken push config, the registration still succeeds.
- [ ] **Step 2: Run `supabase test db`.** Expected: `039` fails.
- [ ] **Step 3: Write the migration.** `alter type public.notification_kind add value 'customer_registered';` first; no statement outside a plpgsql body uses the value in this migration. `notify_customer_registered()` modelled on `notify_booking_created()` in `20261023215339_event_notifications.sql` (same recipient choice, same best-effort exception block). Trigger `customers_notify_registered after insert on public.customers for each row when (new.registered_at is not null)`. Revoke execute from all API roles.
- [ ] **Step 4: `send-push`.** `payload.ts` has a fixed URL per kind. Add the kind and build its URL from `data.customer_id`: `/t/stranke/<id>`, falling back to `/t/stranke` when the id is missing. Tests in `payload_test.ts`: the URL with and without an id; TTL 24 hours, urgency `normal`, no topic.
- [ ] **Step 5: App rendering.** `render.ts` and `sl.ts`: title "Nova registracija", body with the customer's name. The service worker tag is `<kind>:<appointment_id>` today; for this kind use the customer id so two registrations do not replace each other (check `app/src/sw.ts` and `render.ts` for where the tag is built). Test in `render.test.ts`.
- [ ] **Step 6: Run all gates, regenerate types.**
- [ ] **Step 7: Docs.** `docs/notifications.md` (kinds table, payload table), `docs/rpcs.md`, `docs/schema.md`, push sequence diagram, `docs/harness.md`, `CONTEXT.md` (kinds list), `docs/copy-review.md`.
- [ ] **Step 8: Commit** — `feat: notify the trainer when a customer registers`.

---

### Task 3: `delete_customer`

**Files:**
- Create: `supabase/migrations/<ts>_delete_customer.sql`, `supabase/tests/040_delete_customer.sql`
- Modify: `app/src/data/customers.ts`, `app/src/pages/trainer/CustomerDetail.tsx`, `app/src/pages/trainer/customers.test.tsx`, `app/src/data/trainer.test.ts`, `app/src/i18n/sl.ts`, `app/src/lib/database.types.ts`, `docs/rpcs.md`, `docs/schema.md`, `docs/screens.md`, `docs/data-layer.md`, `docs/harness.md`, `docs/copy-review.md`, `docs/runbook.md`

**Interfaces:**
- Produces: `public.delete_customer(p_customer_id uuid) returns void` (trainer only; granted to `authenticated, service_role`); error token `AMRAP_NOT_DELETABLE`; `deleteCustomer(client: Client, customerId: string): Promise<ActionResult<null>>` in `app/src/data/customers.ts`.

- [ ] **Step 1: Write `040_delete_customer.sql`.**
  - A customer calls it → `^AMRAP_FORBIDDEN:`. Unknown id → `^AMRAP_NOT_FOUND:`. Null → `^AMRAP_INVALID_ARGUMENT:`.
  - A record with an appointment (any status) → `^AMRAP_NOT_DELETABLE:`. With a credit transaction → the same. With a recurring rule (even inactive) → the same. A trainer record → the same.
  - A record with none of these → deleted; its `notifications` rows are gone (the foreign key cascades); the auth user still exists.
- [ ] **Step 2: Run `supabase test db`.** Expected: `040` fails.
- [ ] **Step 3: Write the migration.** Lock the customer row `for update` before the checks.
- [ ] **Step 4: App, test first.** Vitest: the customer page shows a delete button (`customerDetail.delete`: "Izbriši stranko") only when the loaded customer has no appointments, no transactions and no rules; a tap asks for confirmation in the page (a second tap on "Potrdi izbris", the pattern the Settings forms already use for confirmations), calls `deleteCustomer`, and goes to `/t/stranke`; a refusal shows `errors.AMRAP_NOT_DELETABLE` ("Stranke z zgodovino ni mogoče izbrisati.").
- [ ] **Step 5: Run all gates, regenerate types.**
- [ ] **Step 6: Docs.** `docs/rpcs.md`, `docs/schema.md`, `docs/screens.md`, `docs/data-layer.md`, `docs/harness.md`, `docs/copy-review.md`. `docs/runbook.md`: new section "A customer registered twice" (keep the record with the history, delete the new record here, delete its auth user in the Supabase dashboard, send an invite for the old record) and a line that a deleted record's auth user still exists until removed in the dashboard.
- [ ] **Step 7: Commit** — `feat: let the trainer delete a customer record that has no history`.

---

### Task 4: Registration page

**Files:**
- Create: `app/src/data/registration.ts`, `app/src/pages/RegisterPage.tsx`, `app/src/pages/register.test.tsx`
- Modify: `app/src/routes.tsx`, `app/src/routes.test.tsx`, `app/src/pages/NotLinkedPage.tsx`, `app/src/i18n/sl.ts`, `app/src/test/fakeSupabase.ts` (if it needs the new RPC), `docs/auth.md`, `docs/screens.md`, `docs/data-layer.md`, `docs/copy-review.md`

**Interfaces:**
- Consumes: `register_customer(p_name, p_phone, p_code)` and its error tokens (Task 1); `useAuth()` (`loading`, `session`, `customer`, `refresh`).
- Produces: route `/registracija` outside `RequireAuth`; `registerCustomer(client: Client, input: { name: string; phone: string; code: string }): Promise<ActionResult<string>>` in `app/src/data/registration.ts`; query parameter name `koda`.

- [ ] **Step 1: Write failing tests** (`register.test.tsx`, in the style of the existing invite page tests):
  - No `koda` in the address → the page shows `register.noCode` ("Za registracijo skenirajte QR kodo v telovadnici.") and no form, so no account can be created (Review Focus 4).
  - Signed out, with a code → fields name, phone, email, password, repeat password; all required.
  - Password under 6 characters, passwords that differ, a name under 2 characters, a phone under 6 characters → each shows its copy and sends no request (Review Focus 5).
  - A valid submit calls `auth.signUp`, then `register_customer` with the trimmed name and phone and the code from the address, then `refresh()`, then navigates to `/`.
  - `user_already_exists` with the right password → signs in and continues with `register_customer`. With a wrong password → shows `register.accountExists` with a link to `/login`, and `register_customer` is not called (Review Focus 3).
  - `register_customer` refuses with `AMRAP_REGISTRATION_CLOSED` → its copy shows; the user stays on the page.
  - Signed in without a customer record → only name and phone show; submit calls `register_customer` without `signUp` (Review Focus 1).
  - Signed in with a record → redirect to `/`.
  - `NotLinkedPage` has a link "Dokončaj registracijo" to `/registracija`; its text says to scan the QR code in the gym again.
- [ ] **Step 2: Run `npm test -- --run`.** Expected: the new tests fail.
- [ ] **Step 3: Implement.** Follow `InvitePage.tsx` for the sign-up, the account-exists branch, the no-session case and the `refresh()` before navigating. Phone input `type="tel"` with `autoComplete="tel"`; name `autoComplete="name"`. Intro copy: "Ustvarite račun. Termine vam nato dodeli trener."
- [ ] **Step 4: Run all gates.**
- [ ] **Step 5: Docs.** `docs/auth.md` (new section "Registration", the changed not-linked page, the route list), `docs/screens.md`, `docs/data-layer.md`, `docs/copy-review.md`.
- [ ] **Step 6: Commit** — `feat: add the registration page`.

---

### Task 5: Trainer settings, the "Nov" marker and the empty Home

**Files:**
- Create: `app/src/pages/trainer/SettingsRegistration.tsx`
- Modify: `app/src/data/registration.ts`, `app/src/data/customers.ts`, `app/src/routes.tsx`, `app/src/pages/trainer/Settings.tsx` (new tab), `app/src/pages/trainer/Customers.tsx`, `app/src/pages/customer/Home.tsx`, tests next to each (`settings.test.tsx`, `customers.test.tsx`, `customer.test.tsx`, `trainer.test.ts`), `app/src/i18n/sl.ts`, `docs/screens.md`, `docs/data-layer.md`, `docs/copy-review.md`, `docs/runbook.md`, `docs/pilot.md`

**Interfaces:**
- Consumes: `registration_settings`, `set_registration_code` (Task 1); `customers.registered_at`.
- Produces: `getRegistrationCode(client): Promise<string | null>`, `setRegistrationCode(client, code: string | null): Promise<ActionResult<null>>`; `Customer.registeredAt: Date | null` and `Customer.hasRules: boolean` from `listCustomers`; route `/t/nastavitve/registracija`; customer-list filter value `novi`.

- [ ] **Step 1: Write failing tests.**
  - Settings tab "Registracija": closed state shows "Registracija je zaprta" and a button "Odpri registracijo"; opening calls `setRegistrationCode` with a new random code of at least 16 characters (URL-safe, from `crypto.getRandomValues`); the open state shows the full link `<origin>/registracija?koda=<code>`, a copy button, "Nova koda" and "Zapri registracijo".
  - "Nova koda" and "Zapri registracijo" need a second confirming tap and first show the warning that the printed QR code stops working.
  - Customer list: a customer with `registeredAt` set and `hasRules` false has the tag "Nov"; with a rule, or created by the trainer, no tag; the filter `novi` lists only tagged customers.
  - Customer Home with no upcoming and no cancelled appointments shows `customer.noAppointmentsYet` ("Trener vam bo dodelil termine. Videli jih boste tukaj."); the install card and the notification switch still show.
- [ ] **Step 2: Run `npm test -- --run`.** Expected: the new tests fail.
- [ ] **Step 3: Implement.** `listCustomers` also selects `registered_at` and whether any recurring rule exists (an embedded PostgREST count on `recurring_rules`; read the Supabase docs for the exact select syntax). The Settings tab follows the existing tabs (`SettingsCutoff` is the smallest example).
- [ ] **Step 4: Run all gates.**
- [ ] **Step 5: Docs.** `docs/screens.md`, `docs/data-layer.md`, `docs/copy-review.md`. `docs/runbook.md`: "Print the registration QR" (open registration, copy the link, make the QR with any generator, print; a new code needs a new print). `docs/pilot.md`: the trainer's first steps now include opening registration; the customer steps start with scanning the QR.
- [ ] **Step 6: Check at phone width** (orchestrator step): the Settings tab, the customer list tag, the registration page and the empty Home at 360 px.
- [ ] **Step 7: Commit** — `feat: let the trainer open registration and see new customers`.

---

### Task 6: Browser test

**Files:**
- Create: `app/e2e/registration.spec.ts`
- Modify: `app/e2e/fixtures.ts`, `docs/harness.md`

**Interfaces:**
- Consumes: the fixtures from the browser-tests plan (`test`, `expect`, `signIn`, `TRAINER`, the admin client); `/registracija?koda=`; `set_registration_code`.
- Produces: fixture `registrationCode: string` — sets a fresh code through the admin client before the test. Tests that use it run in serial mode within this file, because the code is one shared row.

- [ ] **Step 1: Write `registration.spec.ts`.**
  - `a person registers with the gym code and the trainer assigns a session` — open the link with the code; fill the form with a unique email; land on `/c` with the empty-Home copy; in a second context the trainer opens the customer list, sees the new customer with the tag "Nov", opens their page and adds a fixed appointment for a template the test created; the customer reloads Home and sees upcoming appointments. Teardown deletes the auth user and the customer row.
  - `a wrong code is refused` — open the link with another code; submit; the `AMRAP_REGISTRATION_CLOSED` copy shows and the URL is still `/registracija`.
  - `the link without a code shows no form`.
- [ ] **Step 2: Run `npm run e2e` three times.** Expected: all pass each time.
- [ ] **Step 3: Docs.** `docs/harness.md` "Testing" table row.
- [ ] **Step 4: Commit** — `test: cover registration in the browser`.

## Owner actions after merge

- `supabase db push` and the `release-checklist` skill.
- In the Supabase dashboard: confirm that sign-ups are allowed and that the sign-up rate limit suits a busy evening at the gym.
- Open registration in Settings, copy the link, make the QR, print it.
