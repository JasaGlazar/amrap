# AMRAP — Implementation Plan

Source of truth: `PLAN.md` (revised 2026-10-23). Every stage below is a PR on its own
branch (`stage-N-<name>`), opened with `--label patch --assignee @me`. Stage N+1 branches
off stage N until it merges.

## Global Constraints

- Supabase Free Plan and Cloudflare Pages free tier only. No paid add-ons, no custom SMTP.
- Ledger-first: no mutable balance column; balance = `SUM(credit_transactions.amount)`.
- All credit/capacity mutations go through `SECURITY DEFINER` RPCs with explicit role checks.
- Partial unique index on `credit_transactions(appointment_id) WHERE type IN ('session','late_cancel')`.
- Appointment status enum: `booked | charged | cancelled | cancelled_late | cancelled_by_trainer`.
- Transaction type enum: `topup | session | late_cancel | refund | adjustment`.
- Defaults: cutoff 5 h, slot 60 min, capacity 5, gym timezone `Europe/Ljubljana`.
- Slovenian UI; every user-visible string lives in `app/src/i18n/sl.ts`. No hardcoded UI strings.
- Docs 1:1: a diff touching schema, RPCs, jobs or screens touches the matching doc and
  diagram in the same commit (`docs/schema.md`, `docs/rpcs.md`, `docs/jobs.md`,
  `docs/screens.md`, `docs/architecture/*.md`).
- Do not commit generated artifacts except `app/src/lib/database.types.ts` (Supabase types).
- Tests derive expected counts/balances from the data they insert; no hardcoded totals.
- No git hooks or Claude hooks that block mid-turn.
- Auth: email/password with email confirmations disabled (default SMTP is 2 emails/hour and
  non-production). Customers join only via trainer invite token (`create_invite` /
  `accept_invite`). Magic links and OTP are not used.
- Tests: pgTAP via `supabase test db` (`supabase/tests/*.sql`); role switching through
  helper functions in `supabase/seeds/test_helpers.sql` (local-only seed). Frontend logic
  tests with Vitest.
- Layout: `supabase/` (migrations, seeds, tests, functions), `app/` (Vite PWA), `docs/`,
  `CONTEXT.md`, `.claude/agents/`, `.claude/skills/`, `scripts/`, `.github/workflows/`.
- Commits: small, each compiles and passes tests; message explains why; end with
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never `supabase db push` to the remote from a feature branch; remote migration happens
  after merge (documented in `docs/runbook.md`).

## Stage 1: Foundation
**Goal**: Harness scaffolding, Supabase schema + RLS + RPCs with pgTAP tests, Vite PWA shell
with auth and invite flow, CI with docs check. Branch `stage-1-foundation`.
**Success Criteria**: `supabase test db` green on a fresh `supabase db reset`; `npm run build`
and `npm test` green in `app/`; `scripts/check-docs.sh` green; CI workflow green; a customer
can be invited, sign up through the link, log in and see an empty home screen; the trainer can
log in and see the trainer shell.
**Tests**: RLS isolation per table; capacity overflow at the boundary; late-cancel boundary
±1 min; charge job idempotency; charge-vs-late-cancel race (one charge); trainer cancel after
charge → refund, net 0; customer cancel after start → rejected, no transaction; negative
balance allowed; invite token reuse/expiry rejected; custom duration/capacity respected;
Vitest for strings module and auth routing.
**Status**: Complete (PR #1 merged 2026-10-23; hosted `db push` of both Stage 1 migrations done;
owner steps tracked in issue #2)

## Stage 2: Credits & appointments core
**Goal**: Recurring rules + nightly materialization (4 weeks ahead, idempotent), pg_cron
schedules for materialization and `charge_due_appointments()`, trainer blackout periods
enforced in `book()`, both calendars, customer Home/History, trainer Today/Customers/Settings
screens. Pilot-ready. Branch `stage-2-core`.
**Success Criteria**: Paper sheet and whiteboard fully replaced: trainer manages grid, rules,
customers, credits; customers book/cancel and see balance and history.
**Tests**: materialization idempotency and blocked-period skipping; booking rejected in a
blocked period; screen-level Vitest for calendar/capacity rendering and cancel warning copy.
**Carry-over from Stage 1 review**: materialization must take the same
`pg_advisory_xact_lock` key as `book()` (template id + start epoch) or it can overfill a slot;
add a sign-out link to both shells (done, Task 7); add an automated two-session test for `accept_invite` if a
harness allows it (none does: pgTAP runs each file in one rolled-back transaction, so a second
connection, e.g. dblink, cannot see its fixtures; the race stays covered by the row lock and the
unique `auth_user_id`, see rpcs.md).
The customer calendar must show remaining capacity per slot while RLS hides other customers'
appointments: add a `SECURITY DEFINER` counting RPC or view (e.g. `slot_occupancy`). Route the
not-linked and lookup-failed sign-out buttons through `/logout` so failures surface (done,
Task 7).
**Status**: Complete (PR open)

## Stage 3: Automation & notifications
**Goal**: Web push (VAPID) via edge function + pg_net, `push_subscriptions` UI, pre-cutoff
reminder job (~1 h before cutoff, required before pilot), trainer booking/cancel
notifications, keep-alive read on app load, unpause runbook verified. Branch
`stage-3-notifications`.
**Success Criteria**: Reminder arrives on Android and iOS (home-screen install) before the
cutoff; no duplicate reminders.
**Tests**: reminder selection query idempotency with fixture dates; edge function unit tests.
**Status**: Complete (PR #4 open; device check pending, owner action 8). Owner actions: see
"Stage 3 owner actions" below.

## Stage 4: Polish & pilot
**Goal**: Install onboarding, Slovenian copy review with the trainer, real trial, release
checklist skill. Branch `stage-4-pilot`.
**Success Criteria**: Trainer runs one full week on AMRAP without the paper sheet.
**Tests**: manual E2E on both roles on real phones.
**Status**: Complete (PR open; trial week pending). Owner actions: "Stage 4 owner actions"
below; open questions: "Stage 4 open questions".

## Stage 5: UI fixes
**Goal**: Fix the bugs, spacing and alignment problems found in the 2026-10-24 UI review
(laptop, tablet and phone widths) without changing the look or the structure yet. Branch
`stage-5-ui-fixes` off `main`.
**Success Criteria**: every item in "Stage 5 tasks" is fixed and seen in a browser at 390,
768 and 1440 px; `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` green.
**Tests**: Vitest for the changed labels and states (refund button label on charged
appointments, minus sign on debtor chips, zero balance not marked positive, linked customers
without a status tag).
**Status**: Complete (PR open)

## Stage 6: Brand and theme
**Goal**: The AMRAP visual identity from the gym logo: black, white and grey tokens, light and
dark themes (system default, owner-selectable), the logo in the app and in the PWA icons, one
typeface. Branch `stage-6-brand-theme` off `stage-5-ui-fixes`.
**Success Criteria**: no teal left; both themes pass the contrast rules in `docs/screens.md`;
the theme choice persists per device and applies before first paint; the logo shows in the
top bar and on the sign-in screens; installed icons show the framed wordmark.
**Tests**: Vitest for the theme preference store (read, write, storage failure) and the
appearance control.
**Status**: Complete (PR open)

## Stage 7: Navigation and structure
**Goal**: Navigation in the top bar from tablet width up (bottom tabs stay on phones);
Nastavitve split into sub-tabs; every "new X" form opens on demand. Branch
`stage-7-nav-structure` off `stage-6-brand-theme`.
**Success Criteria**: at 1440 px there is no bottom bar and nav sits next to the logo; no
screen shows a "new X" form until its button is pressed; a trainer week in the calendar is
no longer one long column of customer pickers.
**Tests**: routing tests for the settings sub-routes; Vitest for open/close of each
on-demand form and for the per-slot add control.
**Status**: Complete (PR open)

## Stage 8: Small fixes and data
**Goal**: Issues #20, #12 and #13 from the 2026-10-24 owner review: the starting-balance label
without "(s papirja)"; a written data-retention policy with the pg_cron run log pruned to 14
days and a database size check in the runbook; history lists 10 rows at a time with **Pokaži
več**. Branch `stage-8-small-data` off `main`.
**Success Criteria**: the Nova stranka label reads "Začetno stanje kreditov"; `cron.job` has a
daily `prune_cron_history` that deletes only runs older than 14 days; ADR 0013 states the
retention per table with measured numbers; the runbook has "Database size check"; customer
History and the trainer's customer detail show 10 rows per list, then 10 more per press, with a
loading state, an error line that keeps the rows, and no button at the end.
**Tests**: Vitest for the label; pgTAP `033_retention.sql` (schedule, grants, 13/15-day runs,
the exact 14-day boundary, runs that never ended, a second run); Vitest for the paged reads
(25-row fixture → pages of 10, 10, 5, order and ties) and for each of the four lists (10 → 20 →
25 with no button, order across pages, loading state, a failed page keeps the rows and
retries, focus on the first new row).
**Status**: Complete (PR open)

## Stage 9: Stranke search, Urnik grid and overlaps
**Goal**: Issues #14, #16 and #15 from the 2026-10-24 owner review: Stranke searchable and
filterable for about 100 customers; Nastavitve → Urnik as a week grid from 768 px and day
groups on a phone; a warning when a slot overlaps another, and overlaps marked in the grid.
Branch `stage-9-stranke-urnik` off `main`.
**Success Criteria**: "zupancic" finds "Zupančič" and "040111" finds "+386 40 111 111";
**Vsi**, **Dolžniki** and **Brez računa** combine with the search, with a plural count line
and an empty state that clears both; `?q=…&f=…` survives going to a customer and back (browser
back and **Nazaj na stranke**) and typing adds no history entries. From 768 px seven
capitalised day columns with blocks placed by time, overlaps side by side, inactive muted and
tagged, each block a fully named button that opens the edit form in a dialog with the
on-demand focus rules; below 768 px capitalised day groups without empty days. Saving an
active template that newly overlaps another active one on the same day warns, naming it, and
saves on a second **Shrani**; touching ranges and inactive templates never warn; overlapping
blocks have a dashed edge and a "prekrivanje" tag. No page-level horizontal scroll at 360 or
768 px.
**Tests**: Vitest for `lib/customerSearch.ts` (diacritics, words, phone with spaces and
+386, filters, Slovenian sort) and the Stranke page on a 100-customer fixture (each filter,
filter with search, empty state and clear, count line, URL with `replace`, back from a
customer both ways, the caret while typing, reset from the main navigation); `weekdayHeading`;
`lib/schedule.ts` (minutes, `clock`, axis range, lanes, `overlapsWith`, `overlappingIds`); the
grid (headings in order, each template in its column with range and places, inactive marked,
dialog opens with the template's values and focus, Prekliči and Escape return focus, save
closes it) and the day groups (headings in order without empty days, rows, edit in place); the
overlap warning (one and two other slots, changed values checked again, touching, inactive on
either side, no self-overlap, an existing overlap not asked again, a new one on edit, together
with stranded bookings) and the marks in both layouts.
**Status**: Complete (PR open)

## Stage 10: Trainer Koledar day view and week grid
**Goal**: Issue #17 from the 2026-10-24 owner review: the trainer's **Koledar** as a day view
below 1024 px and a week grid from 1024 px, instead of one long column of every slot. The
customer calendar stays as it is. Branch `stage-10-koledar` off `main`.
**Success Criteria**: below 1024 px a strip of seven day buttons under the week navigation
(selected `aria-pressed`, today `aria-current="date"`, neither by colour alone, 44 px targets,
no page scroll at 360 px) and only the selected day's occurrences and appointments outside the
grid, with an empty state; the default day is today in the current week and Monday in any
other; `?dan=YYYY-MM-DD` keeps the day and decides the week through reload and Back, written
with `replace`. From 1024 px seven day columns in the ADR 0014 `wide` box, occurrences and
outside-the-grid appointments in their day's column by time as compact cards, today tagged.
**Dodaj stranko** (one open at a time, Polno, Zaprto, Ni strank za dodajanje), the cancel
dialog, **Nov termin po dogovoru** and past weeks work in both views; days are bucketed in the
gym timezone.
**Tests**: Vitest for `parseLocalDate` and `defaultDayOf`; the day view (seven buttons in
order, today selected and marked, only that day's occurrences, a pressed day in the URL with
`replace`, the URL's day and week, an impossible date, Monday in another week and today again,
the day kept after another screen and Back, the empty day, that day's outside-the-grid list
and none on a day without); the week grid (columns in order and no strip, each occurrence in
its column in time order, an ad-hoc appointment in its column by time and tagged, today's
column, the URL's week); add, one control open, Polno and both cancels in each view; the DST
Sunday (a 10:00 slot and an ad-hoc at 00:30, 22:30 UTC on Saturday) in both views.
**Status**: Complete (PR open)

## Workflow (from 2026-10-23 evening)

- Orchestrator session runs on Opus. Per stage: a Herdr worktree with a fresh session does the
  stage; the orchestrator reviews each task with the project `reviewer` agent.
- PR per stage (`--label patch --assignee @me`), based on the previous stage branch. Merge
  automatically when CI is green; no owner review needed. After a stage merges to `main`, run
  `supabase db push` and report it (owner approved on 2026-10-23).
- Only one worktree runs the local Supabase stack at a time (fixed ports): `supabase stop`
  before switching.
- Code comments are kept to a minimum (a non-obvious *why* only). What a layer does lives in
  `docs/<layer>.md` (auth, data layer, time/calendar, RPCs, jobs). See Task 9.
- The SDD ledger (`.superpowers/`) is gitignored; this file is the committed handoff.
- The owner is not available during the run. Anything only the owner can do (hosted dashboard
  clicks, secrets, phone testing) is recorded as a GitHub issue (`gh issue create --assignee @me`)
  and the build continues past it. Issue #2 holds the Stage 1 owner actions.

### Handoff state (2026-10-23, end of Fable session)
- Stage 1: PR #1 merged to `main` (418f876); `db push` after merge per Workflow.
- Stage 2: branch `stage-2-core`. Task 6 committed (c99c787..d2bce86), reviewed (approve with
  fixes); fixes done: ADR 0008, deterministic DST tests, docs index/jobs/schema notes. The
  implementer's concerns were all ruled acceptable and are recorded in ADR 0008.
- Task 9 done: comment sweep (migrations, seeds, scripts, `app/src`), new `docs/auth.md` and
  `docs/app-structure.md`, harness rule and reviewer item.
- Task 7 done: customer Home, Calendar (`/c/koledar`), History (`/c/zgodovina`), cancel
  dialog, `src/data/`, `lib/time.ts`, sign-out via `/logout` everywhere; docs `data-layer.md`,
  `time.md`, `screens.md`. Manually checked in a browser as ana. Review fixes done.
- Task 8 done: trainer Today, Calendar (`/t/koledar`), Customers (`/t/stranke`, `/:id`),
  Settings (`/t/nastavitve`) on the shared week loader and calendar parts; runbook invite path
  is the Customers screen. Manually checked as trainer. Review fixes done (off-grid bookings
  listed, stranded-booking warning, recent charges with refund). Stage 2 complete; the
  orchestrator opens the PR to `main`.

### Handoff state (2026-10-23, Stage 3)
- Stage 2: PR #3 merged to `main` (5499077).
- Stage 3: branch `stage-3-notifications`. Item 0 done: "Stage 3 tasks" below and ADR 0009
  (push design). Research (Context7 + local stack): pg_net 0.20.4 available but not installed,
  Vault installed, `npm:web-push@3.6.7` verified in edge runtime 1.74.3 (Deno 2.1.4), Deno not
  installed on the host (tests via the `denoland/deno:2.1.4` image). Plan approved with
  rulings: dev-seed Vault placeholders, Docker Deno, 45-75 min window, no row without config or
  subscription, trainer cancels do not notify customers (owner question), `save_push_subscription`
  RPC, `apikey` fallback documented for the owner to verify.
- Task 10 done: migration `20261023214654_notifications_and_reminders.sql` (pg_net in
  `extensions`, `notifications` log, `push_config`, `dispatch_notifications`,
  `claim_notifications`, `send_cutoff_reminders` + cron every 15 min), tests 030/031, dev-seed
  Vault rows, docs (`notifications.md`, `push-sequence.md`, schema/rpcs/jobs/ERD/context,
  runbook pg_net check). Checked by hand: pg_net from the db container reaches
  `host.docker.internal:54321` (gateway 503 until `send-push` exists, Task 12). pg_net 0.20.4's
  default timeout is 5000 ms (docs say 2000); dispatch sets 10000.
- Task 11 done: migration `20261023215339_event_notifications.sql` (`enqueue_notification`,
  triggers `appointments_notify_booking_created` / `_booking_cancelled` /
  `credit_transactions_notify_credit_change`, `save_push_subscription` upsert on endpoint), test
  032, docs (notifications event section, schema triggers, rpcs, booking and push sequences).
  Best effort is tested by replacing `enqueue_notification` with a raising body inside the test
  (the trigger's guard keeps book/cancel/top_up succeeding); the notification row is not kept in
  that case. Single-trainer assumption documented (the triggers loop over every trainer, the
  `(kind, appointment_id)` key lets only the first one with a device get it).
- Task 12 done: `supabase/functions/send-push/` (handler with injected deps, payload per kind,
  web-push `generateRequestDetails` + `fetch`), 14 Deno tests, `scripts/test-functions.sh`
  (fmt, lint, check, test; Docker image when no local deno), CI job `functions`,
  `[functions.send-push] verify_jwt = false`, `supabase/functions/.env.example`, runbook "Turn on
  push notifications". `supabase start` serves the function without `functions serve`.
  End-to-end locally: a credit trigger → pg_net → `send-push` → a fake push service container on
  `supabase_network_amrap` received two encrypted (`aes128gcm`, VAPID-signed) pushes; its 410
  device was deleted; summary `{"claimed":1,"sent":1,"failed":0,"removed":1}`. The Bash sandbox
  blocks listening sockets on the host, hence the container. A local VAPID pair is in the
  gitignored `supabase/functions/.env`.
- Task 10 and 11 review fixes done (items 1-15 of the orchestrator's list): derived test counts,
  job docs, `enqueue_notification` error guard (test-first), one trainer recipient, balance
  from `customer_balances`, `save_push_subscription` granted to `authenticated` only, more
  best-effort tests (real pg_net failure, actions take effect), https-only endpoints (check
  constraint, RPC check, `send-push` skips others). The Task 11 migration was edited in place
  (not on the hosted DB). Accepted deviation: `dispatch_notifications` returns silently for an
  empty or null id list (the plan said `raise log`); nothing is lost and the job would log on
  every quiet run. The Task 12 local end-to-end used an `http://` fake push service; with the
  https rule a repeat needs an https fake endpoint.
- Task 12 review fixes done: guarded `serviceKey(env)` with Deno tests (Important), response
  table, runbook check steps, harness notes, per-test console stub, comments removed.
- Task 13 done: `src/sw.ts` (injectManifest, `skipWaiting` + `clientsClaim`, push and click
  handlers), `src/push/` (`render`, `support`, `browser`, `subscribe`), `PushToggle` on customer
  Home and trainer Settings, `/logout` removes the device first, `save_push_subscription` /
  delete wrappers in `src/data/push.ts`, `tsconfig.sw.json` (WebWorker lib), workbox-core and
  workbox-precaching 7.4.1 pinned. Vitest 199 (46 new). Browser check not done: the Claude in
  Chrome extension timed out injecting into the local preview page three times; the build, the
  emitted `sw.js` (no imports, push handler present) and the dev server were checked instead.
  The local VAPID public key is in the gitignored `app/.env.local`.
- Task 14 done: keep-alive already covered (`routes.test.tsx` "keep-alive": once per sign-in,
  not on token refresh, not signed out, failure tolerated; `auth.md` matches); runbook unpause
  section checked against current Supabase docs and extended (warning email, one-year restore,
  post-restore checks, what a pause does to charges, reminders and instances). Manual check with
  headless Google Chrome 155 driven by agent-browser and raw DevTools protocol, results below and
  in `docs/notifications.md` "Manual check".

- Task 13 review fixes done: subscribe waits for `serviceWorker.ready`, stale-VAPID-key retry,
  push rows filtered by the signed-in user (trainer RLS sees all rows), notification clicks stay
  on the app's origin and navigate only controlled windows, `cleanupOutdatedCaches` and the
  `index.html` navigation route restored (workbox-routing 7.4.1), push sequence diagram extended
  to the device side. Stage 3 complete; the orchestrator opens the PR. Local stack stopped
  (`supabase stop`).
- Final review fixes (PR #4): browser re-check at e5c893f (below), unparseable notification URL
  falls back to `/`, sign-out without a session still unsubscribes the browser, 5-second timeout
  on `serviceWorker.ready`, long doc lines rewrapped. Local stack stopped again.

### Stage 3 manual check (2026-10-24, local stack, production build)

Verified in a real browser:
- Service worker registered, activated and controlling the page; Push API and Notification API
  present.
- Toggle states: "blocked" (headless default permission), "off" with **Vklopi obvestila**, "on"
  after enabling, "off" again after **Izklopi obvestila** (customer Home and trainer Settings).
- Enabling with permission granted creates a real FCM subscription and saves it for the signed-in
  user (row with 87-character `p256dh`, 22-character `auth`).
- Signing out as ana deleted her row (1 → 0) and unsubscribed the browser.
- Delivery side against real FCM: credit trigger (top-up), reminder job (first run 1, second run
  0, one row) and a customer booking through the `book` RPC with ana's token each led to
  `send-push` answering `{"claimed":1,"sent":1,...}` (FCM 201). After headless Chrome dropped its
  registration, the next pushes (an adjustment, the customer's cancel) got 404/410 and the
  subscription was deleted (`removed: 1`).
- Service worker rendering of real payloads (credit top-up with note, the reminder from the job's
  row, booking created, booking cancelled) via `ServiceWorker.deliverPushMessage`: titles, bodies,
  times in Europe/Ljubljana across the DST change, tags and in-app URLs as specified.

Not verified:
- A push delivered by FCM into a browser (headless Chrome's GCM login fails) — owner phone test.
- The notification click (cannot be simulated headless).
- **Izklopi obvestila** deleting a row that still existed: by then the 410 cleanup had removed
  the trainer's row (the UI flow, the browser unsubscribe and logout's deletion were verified;
  unit tests cover the delete).
- iOS (home-screen install hint shown only by unit test) and Android.

### Stage 3 browser re-check (2026-10-24, at e5c893f, after the Task 13 fixes)

Local stack, production build (`vite preview`), a fresh headless Google Chrome 155 profile driven
over the DevTools protocol (notification permission granted per session, as in the first check).

Verified:
- First visit: the service worker installed, activated and controlled the page on the first load
  of `/login`; signing in as ana and pressing **Vklopi obvestila** right away, without a reload,
  showed "on", created an FCM subscription and saved ana's row.
- Deep links online: `/c/zgodovina` (History with its sections) and
  `/invite/dev-invite-token` (invite sign-up form).
- Deep links offline (network emulation offline; a fetch probe confirmed the network was
  blocked): both navigations were answered by the service worker with the app shell
  (`NavigationRoute`); `/invite/dev-invite-token` rendered the sign-up form, `/c/zgodovina`
  rendered the designed "Podatkov ni mogoče naložiti" page because its data needs the network.
- **Izklopi obvestila** with a live row: ana's row 1 → 0 and the browser unsubscribed.
- Signing out with a live row: row 1 → 0 and the browser unsubscribed.

Not verified:
- `cleanupOutdatedCaches` (needs two builds in a row).
- Enabling while the worker is still installing (the worker activated before the click could
  run) and the 5-second ready timeout, both only by unit tests; the final review fixes after
  e5c893f (unparseable URL, sign-out without a session, ready timeout) are unit-tested only.
- FCM delivery into a browser, the notification click, iOS and Android (owner action 8).

### Stage 3 owner actions (consolidated)

All after the Stage 3 PR merges to `main` and the orchestrator has run `supabase db push` for
the two Stage 3 migrations (Workflow); exact steps in `docs/runbook.md`.

1. Check runbook "Deploy migrations after merge" step 6 in the SQL editor: pg_net in
   `extensions`, three jobs in `cron.job`.
2. Generate the hosted VAPID key pair and a push secret (runbook "Turn on push notifications"
   step 1).
3. `supabase secrets set --env-file …` for `PUSH_SECRET`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (step 2).
4. `supabase functions deploy send-push --no-verify-jwt` and the curl check (step 3).
5. Insert the Vault rows `amrap_functions_url` and `amrap_push_secret` in the SQL editor
   (step 4).
6. Cloudflare Pages: `VITE_VAPID_PUBLIC_KEY` for Production and Preview, redeploy (step 5).
7. Check on a phone signed in as a test customer: top up 1 and adjust −1, confirm two
   notifications and `{"claimed":1,"sent":n,...}` in `net._http_response` (step 6). If the
   response is a gateway 401, report it: the `apikey` fallback in ADR 0009 is needed.
8. Real-device tests: Android Chrome and iPhone (Add to Home Screen first): enable on Home and
   on the trainer's Settings on the first visit after installing, without reloading; receive a
   reminder (an appointment whose cutoff is about an hour away), a booking and a cancel
   notification; tap a notification and land on the right screen; open a deep link
   (`/c/zgodovina`, an invite link) online, then again in airplane mode (the app shell must
   still open).
9. Decide: should a trainer cancel notify the customer? (Not in PLAN.md, not built.)
10. Before the pilot, keep in mind the runbook's unpause notes: sessions that pass during a pause
    are charged on restore and need a trainer review.

### Handoff state (2026-10-24, Stage 4)
- Stage 3: PR #4 merged to `main` (e305f91).
- Stage 4: branch `stage-4-pilot` off `main`. Item 0 done: "Stage 4 tasks" below (Tasks 15-19),
  waiting for the orchestrator's approval before Task 15 starts. No DB change is planned.
- Plan approved as written (all rulings, including the starting-balance field in Task 18).
- Task 15 done: `src/install/` (`capture.ts` store and listener registered in `main.tsx`,
  `mode.ts`, `dismissed.ts`, `platform.ts` with `InstallContext`, `useInstall.ts`),
  `InstallCard` in `AppShell`, `PushToggle` refers to the card on iOS while it is shown
  (`pushToggle.needsInstallSeeCard`), device detection moved to `lib/device.ts`, `install.*`
  copy, `fakeInstall.ts`. Docs: `screens.md` (Install card), `app-structure.md` (Install
  onboarding), `notifications.md`, `auth.md`, README and harness layer tables. Vitest 253.

- PGRST303 fix (16cdc35): `retryIssuedAtFuture` in `lib/supabase.ts`, documented in `auth.md`.
- Task 15 review fixes: invite-flow diagram ends on Home with the install card; the prompt is
  kept until the browser answers (no second prompt meanwhile); `amrap.install.installed`
  remembers an install per device (`flags.ts`); `install.why` general plus an iOS line per
  role (`iosWhyCustomer` names the reminder before a charge, `iosWhyTrainer`); the card is an
  `aside`. No `install.installed` string is needed: an installed app just hides the card.
- PGRST303 root cause (capped check): PostgREST allows 30 s of `iat` skew, so "same second" was
  wrong; the clocks agree and idle probes (10 s, 70 s) all passed; two same-millisecond
  requests with one token split 401/200, so a steady container offset is ruled out. Not
  reproduced; recorded in `auth.md`; the single retry stays as a defensive measure.
- Task 16 done: `plural()` / `Plural` in `i18n/fill.ts` (`Intl.PluralRules('sl')`),
  `settings.places` for the template line, eleven copy fixes (list in `docs/copy-review.md`
  "Changes made in this pass"), new `docs/copy-review.md` (conventions, changes, questions for
  the trainer, all 259 strings by screen), `CONTEXT.md` term "install", i18n conventions in
  `app-structure.md`. Date and time formats checked, no change (the hour style is a trainer
  question). Trainer sign-off of the copy is an owner action.

- Task 16 review fixes: screens.md re-link hint, copy-review lifecycle (term list moved to
  app-structure.md; the file is deleted at sign-off), retry wrapper without the `Request`
  branch and a wiring test without a real wait, Auth note in auth.md, »Koledar« quoted,
  "Rezervacija za ta termin že obstaja.".
- Task 17 done (UI polish and accessibility). `web-design-guidelines` findings and decisions:
  - fixed: no `:focus-visible` style (3 px accent ring added); tap targets under 44 px (from the
    stylesheet: `.button.small` about 33 px, selects about 36 px, top-bar **Odjava**, customer
    list links, debtor chips, the checkbox row; measured: **Nazaj na stranke** 18 px; all now
    `--tap` 44 px); muted text on cards 4.39:1 (`--muted` #6b7280 → #4b5563: 7.56 on white, 6.87
    on cards); greyed slot rows by opacity 0.5 (3.38:1 time, 1.98:1 info; now the muted colour);
    input and select borders 1.47:1 (`--control-border` #6b7280, 4.83:1); the credits amount
    used `inputMode="numeric"`, so an iPhone had no minus key for a negative adjustment
    (removed); trainer forms about other people autofilled the trainer's own details
    (`autoComplete="off"`, best effort: browsers may ignore it; real-phone check in Task 19);
    the cancel dialog let Tab leave it and dropped focus on close (trap and focus return); the
    page behind the dialog could scroll (first an `overscroll-behavior` rule that did nothing;
    after the Task 17 review the dialog sets `overflow: hidden` on the root element while open);
    no tabular numbers on balances, amounts and times; safe-area insets missing on the top bar
    and page sides; no hover/active feedback on buttons; long text in rows could overflow (wraps
    anywhere now, buttons and amounts never wrap).
  - won't fix: Title Case for headings and buttons (Slovenian uses sentence case); skip link
    (the bottom nav comes after `main` in the DOM, so Tab reaches content first); `name`
    attributes on inputs (no native form posts); confirmation before deleting a blocked period
    (it is recreated in seconds; the pilot can say otherwise); `prefers-reduced-motion` (no
    animation); the install card's `h2` before the page `h1` (accepted in the Task 15 review).
  - Browser check (headless Chrome 155, 360×800, production build, local stack; script
    measurements over DevTools): `/login`, `/invite/dev-invite-token`, `/c`, `/c/koledar` (this
    and next week), `/c/zgodovina`, `/t`, `/t/koledar`, `/t/stranke`, two customer detail
    pages (a 54-character name with a 66-character email, a 103-character top-up note) and
    `/t/nastavitve`: `scrollWidth` 360 on every page, no target under 44 px, the last content
    48-277 px above the bottom navigation. The cancel dialog fits (buttons 148×48 and 74×48)
    and takes focus. Screenshots showed a wrapping **Odpovej** and a split `+8` in the ledger
    next to the long note; after the fix the **Odpovej** screenshot is confirmed. The `+8` fix
    (`.row .amount` never wraps) was not seen in a screenshot; Task 19's end-to-end looks at it.
  - Not verified in a browser: keyboard Tab order (input events do not reach the page in these
    headless sessions, see Task 15); it is the DOM order (no positive `tabindex` anywhere) and
    the dialog's trap is unit-tested. The state pages (not linked, lookup failed, start-up
    error) were not measured; they reuse the same button and link styles.

- Task 18 done: optional starting balance on **Nova stranka** (positive → `top_up`, negative →
  `adjust`, note `customerDetail.startingNote`; a failed credit call opens the detail page with
  `customerDetail.startingFailed`), the note prefilled while a customer's ledger is empty,
  five new strings with their copy-review rows; `docs/pilot.md` (owner prerequisites, the
  trainer's first day and daily check in Slovenian, text for customers, owner SQL checks,
  problem reports, end of the week); `.claude/skills/release-checklist/SKILL.md` with the
  harness Skills table, skill rule and a runbook pointer. Browser check (local stack,
  production build, 360×800): a customer created with `-2` through the form got one
  `adjustment -2` row with the note "Začetno stanje (papir)", the detail page opened with an
  empty note field; `/t/stranke` with the new field: `scrollWidth` 360, no target under 44 px.
  Not checked in a browser: a positive starting balance and the failure path (unit tests).

- Task 18 review fixes: blocked-period overlap warning (count of live bookings, second
  **Shrani**; pilot guide and an owner question), unreadable starting balance rejected
  (`validity.badInput`), failed starting balance prefilled and shown once, pilot wording,
  invite-flow diagram, release-checklist `--linked` and first-run baseline, stronger dialog tests
  and the iOS scroll-lock caveat.
- Task 19 done: end-to-end below; Stage 4 complete, the trial week is open. Local stack stopped.
  The local VAPID pair for the check is in the gitignored `supabase/functions/.env` and
  `app/.env.local`.

### Stage 4 end-to-end check (Task 19, 2026-10-24)

Fresh `supabase db reset`, production build with a local VAPID key, headless Google Chrome 155 at
360×800 (one profile for the trainer, one for the customer), driven over DevTools by script
(fields set through the native value setter, buttons clicked by their text), following
`docs/pilot.md` literally. Local time Saturday 24 Oct, 02:15-02:31.

Verified:
- Prvi dan: cutoff saved (5); three slot templates from the form (today 05:00, today 08:20,
  Sunday 10:00) next to the seed's; a known blocked period (24-27 Dec); **Nova stranka** "Petra
  Pilot" with starting balance 5 → detail page with "+5 Začetno stanje (papir)"; recurring rule
  Sunday 10:00 → "Novih terminov: 4" (25 Oct to 15 Nov); invite created and its link copied.
- Trainer before day one: **Vklopi obvestila** on **Nastavitve** created a real FCM subscription.
- Customer, following the forwarded text: the invite link, »Ustvari račun«, landed on `/c` with
  the install card (Chrome's `beforeinstallprompt` fired, **Namesti aplikacijo** shown);
  `accept_invite` answered 200 at once (no PGRST303 this time, fetch log at document start);
  **Vklopi obvestila** on **Domov** (FCM subscription); booked today 05:00 and 08:20 in
  **Koledar**; cancelled Sunday 10:00 (dialog: "Odpoved je brezplačna.") and today 05:00 (dialog:
  "Pozna odpoved: zaračunan bo 1 kredit."), balance 5 → 4.
- Notifications: two `booking_created` for the trainer and one `booking_cancelled`; the reminder
  job by hand while 08:20's cutoff was 61 minutes away returned 1, then 0; `credit_topup` for
  the customer. `send-push` answered `{"claimed":1,"sent":1,…}` for the first three (real FCM);
  then FCM reported both headless registrations gone and `send-push` deleted them
  (`removed: 1`), so the later late-cancel and waiver recorded no notification, as specified.
- Trainer daily check: **Danes** with today's slots and names, no debtors. Trainer booked Petra
  into last Saturday 05:00 in **Koledar** (‹), `charge_due_appointments()` charged it; on her
  page: top-up 8 with a long note, waiver `+1` »Popravi stanje« with "Oprostitev pozne
  odpovedi", trainer cancel of the charged appointment (dialog: "Odpoved z vračilom …") →
  refund. Balance 13 = 5 − 1 − 1 + 8 + 1 + 1. Ledger at 360 px: every amount on one line
  (24 px), including `+8` beside the long note (the Task 17 open item).
- After the Task 18 fixes: a blocked period 07:00-09:00 today warned "rezerviranih terminov: 1"
  and saved on the second **Shrani**; the trainer then cancelled the 08:20 booking in
  **Koledar** ("Stranki se kredit ne zaračuna.", `cancelled_by_trainer`); **Nova stranka** with
  `2.5` was refused with `customers.startingInvalid`, with `3` created "+3 Začetno stanje
  (papir)".
- The owner checks in `pilot.md` run as written: the job query listed `charge_due_appointments`
  and `send_cutoff_reminders` succeeding at 02:30; uncharged started bookings 0; the
  notification and `net._http_response` queries.
- The pilot guide needed no change from this run beyond the Task 18 review fixes.

Not verified:
- Real phones (install, push delivered and shown, notification click, iOS); FCM into these
  headless browsers is dropped after a few pushes, as in Stage 3.
- Real keyboard input: clicks and typing were scripted (headless input events do not reach the
  page, see Task 15); an unreadable number from a phone keyboard (`badInput`) is unit-tested.
- The starting-balance failure path in a browser (unit-tested); PGRST303 did not recur, so the
  retry was not exercised against the stack.

### Stage 4 owner actions (consolidated)

1. Hosted push first: Stage 3 owner actions 1-8 (VAPID pair and secrets, deploy `send-push`,
   Vault rows, `VITE_VAPID_PUBLIC_KEY` on Pages, phone check). Without them there are no
   reminders.
2. After the Stage 4 merge, release with the `release-checklist` skill (no migration and no
   function change in Stage 4: Pages deploy and the smoke test).
3. The trainer answers `docs/copy-review.md` and signs it off; one commit then applies the
   answers to `sl.ts` and deletes the file (its README entry, `reviewer.md` item 5, harness
   mention).
4. Android Chrome: **Namesti aplikacijo** opens the install dialog; accepting hides the card,
   declining leaves the menu steps; after installing, AMRAP opened in a browser tab shows no
   card; push from the installed app.
5. iPhone Safari: the card's Share steps; Add to Home Screen; launched from the home screen there
   is no card and the toggle offers **Vklopi obvestila**; push from the installed app; the page
   behind the open cancel dialog does not scroll; the keyboard has a minus key in the credits
   amount and in the **Nova stranka** starting balance (and `2,5` there is refused).
6. **Ne zdaj** is remembered on each device.
7. On the trainer's phone: the customer and blocked-period forms do not offer the trainer's own
   name, phone or email.
8. The trial week with `docs/pilot.md`; record the outcome in the Stage 4 issue.

### Stage 4 open questions (for the owner and the trainer, not decided)

1. Should a trainer cancel notify the customer? (Stage 3, not built.)
2. Does the trainer want a veto over self-bookings? (`PLAN.md` open question 1.)
3. Should adding a blocked period cancel the live bookings inside it (`cancelled_by_trainer`,
   refund if charged) instead of only warning?
4. The copy questions in `docs/copy-review.md` (vi or ti, the word "kredit", "Opravljeno" and
   "Vadba" for a charged session, "Odpovedal trener", "Dolžniki", hour style).
5. Technical, open: the cause of the PGRST303 401s (`docs/auth.md`); the single retry stays.

### Stage 4 Task 15 browser check (2026-10-24, local stack, production build)

Headless Google Chrome 155 at 360×800, user agent overridden per profile, driven by
agent-browser 0.6.0 (`--cdp`) and raw DevTools calls (`Runtime.evaluate`,
`Page.addScriptToEvaluateOnNewDocument`).

Verified:
- Android user agent: after signing up from `/invite/dev-invite-token` the app landed on `/c`
  with the card on top and **Namesti aplikacijo**: headless Chrome fired a real
  `beforeinstallprompt` (logged at document start), the store kept it.
- `prompt()` without a user gesture is refused by Chrome (`NotAllowedError`); the card then
  dropped the used event and fell back to the Android menu steps, as designed.
- iPhone user agent (with `beforeinstallprompt` suppressed at document start, since iOS never
  fires it): the iOS steps on `/c`, `/t` and `/t/nastavitve`; the toggle on Home and Settings
  says the steps are in the card (`needsInstallSeeCard`). With `amrap.install.dismissed` set in
  `localStorage` and a reload, the card is gone and the toggle gives the full steps
  (`needsInstall`). No horizontal scroll (`scrollWidth` 360) on any page checked.
- Card spacing fixed after the first screenshot (f2b89ac).

Not verified:
- A real-gesture install prompt and **Ne zdaj** by a click: in these headless sessions, input
  events stopped reaching the page once the app had navigated past the login (raw
  `Input.dispatchMouseEvent` and agent-browser clicks alike, even on nav links, with a phone or
  the default user agent; the first click on a freshly loaded page worked). Stopped after three
  attempts. Both are covered by unit tests; the real prompt is an owner action on Android. A
  script `element.click()` does reach React handlers (it is not a user gesture, so Chrome
  refuses `prompt()` from it), which is how Tasks 17 and 19 can drive flows.
- Real iOS Safari and a standalone (home-screen) launch: owner action.

Found (pre-existing, not Task 15 code; not fixed, for the orchestrator to schedule):
- **`PGRST303 "JWT issued at future"`** on the local stack (PostgREST v16.2, Auth v2.196.0):
  a request made right after the token was issued is sometimes rejected with 401.
  Seen three times in this check: `accept_invite` right after an invite sign-up (the page
  showed `genericError`; the 79-byte 401 body matches PGRST303 exactly), the customer lookup
  right after sign-in (the "Podatkov ni mogoče naložiti" page), and the keep-alive (logged
  only). Captured with a fetch logger injected at document start. Each recovers on retry
  (the invite link again, **Poskusi znova**). Whether the hosted project shows it is unknown.
  Fixed after Task 15 (orchestrator ruling): `retryIssuedAtFuture` in `lib/supabase.ts` retries
  a 401 `PGRST303` once after one second, nothing else ([auth.md](docs/auth.md)). The
  "same second" explanation turned out wrong (PostgREST allows 30 s of skew); the cause is
  open, see auth.md.

### Handoff state (2026-10-24, Stage 5)

- Branch `stage-5-ui-fixes` off `main`; all 15 Stage 5 tasks done, PR open and not merged (the
  owner looks at visual work first). Vitest 317, lint, typecheck, build and `check-docs.sh`
  green. No DB change. The project `reviewer` approved with fixes; the fixes are in 413446b.
- Test first (watched red): zero balance neutral, positive marked (task 2); `−` (U+2212) on
  debtor chips and Stranke (task 4); **Vrni kredit** on charged sessions (task 3); heading and
  submit button differ on `/login` and `/invite/:token` (task 8); no tag for a linked customer
  on Stranke (task 13).
- Browser check (Vite dev server on 5174, local stack, agent-browser sessions `s5-trainer`,
  `s5-ana` and a signed-out `s5-login`): every changed screen at 390, 768 and 1440 px; at
  360 px `scrollWidth` 360 and no target under 44 px on `/t`, `/t/koledar`, `/t/stranke`, a
  customer detail and `/t/nastavitve`, the customer calendar row does not overflow. The cancel
  dialog was opened and closed with Escape, never confirmed: overlay 0,0 to full window, the
  dialog centred from 768 px. Screenshots in the gitignored `.superpowers/shots/`.
- Demo data: nothing added or changed. The inactive Sunday template already existed (task 11);
  there are no recurring rules, so the `ustavljen` rule row (same markup fix) was not seen in a
  browser.
- Judged differently from the task list, or beyond it:
  - Task 4: one formatter family, two functions: `formatAmount` (always signed, ledger) and
    `formatBalance` (minus only), both `Intl.NumberFormat('sl-SI')`, rendered by a shared
    `pages/shared/Amount.tsx` that also picks the colour. The big balance on customer Home and
    customer detail had the same hyphen and uses `formatBalance` too.
  - Tasks 6/7: disabled buttons are neutral as specified; to make a disabled secondary button
    (the `‹` arrow) differ from an enabled one, enabled secondary buttons got a 1 px
    `--control-border` outline everywhere (cards already had it). A disabled button on a card
    keeps a 1 px `--border` outline so it still reads as a button.
  - Task 8: the invite page repeated "Ustvari račun"; its heading is now **Nov račun** and the
    button keeps the action (rather than renaming the button). Both rows in
    `docs/copy-review.md`, which also answers the old `login.submit` question.
  - Task 13: Stranke only. Customer detail still shows the account tag (task 12 moves it to the
    label line); runbook re-link step 3 now says the customer is tagged "Brez računa".
  - Task 14: spacing is set by context at the end of `styles.css` (page, section, card, form);
    components carry no outer margins. The submit rule covers `.form` only; standalone card
    buttons (**Ustvari povabilo**, the notifications toggle) keep their natural width.
  - Calendar rows (task 9) wrap with the separator leading the second part (`· Prosta mesta:
    …`).
- Left for the owner: the visual review of the PR.
- Fix list 1 done (`.superpowers/fixes-1.md`, items 1-9; `box-shadow: none` on disabled buttons kept, it removes the outline off cards).

### Handoff state (2026-10-24, Stage 6)

- Branch `stage-6-brand-theme` off `stage-5-ui-fixes` (PR #8, still open); all 8 Stage 6 tasks
  done, PR open against `stage-5-ui-fixes`, not merged. Vitest 347, lint, typecheck, build and
  `check-docs.sh` green. No DB change. `grep -rn "0f766e\|ccfbf1\|fee2e2" app/src app/index.html
  app/vite.config.ts` is empty; the build precaches the two Archivo woff2 files.
- Test first (watched red): the theme store (`src/theme/theme.ts`: read, write, unknown value,
  throwing storage, `applyTheme` and the `theme-color` tags) and the `index.html` inline
  script, run in jsdom from the file itself; the account menu (Enter/Space opens on the chosen
  theme, choose, persists, back to Sistem, Escape returns focus, outside click, button again,
  Tab out, Odjava); the brand mark on `/login`, `/invite/:token` and both top bars.
- Browser check (Vite dev server on 5175, local stack, agent-browser sessions `s6-trainer`,
  `s6-ana`, `s6-anon`): every screen at 390, 768 and 1440 px in both system themes, the
  explicit menu choice against the opposite system setting (and after a reload), the cancel
  dialog opened and closed with Escape (never confirmed), the account menu in both shells. At
  360 px `scrollWidth` 360 on the trainer screens. Screenshots in the gitignored
  `.superpowers/shots/`.
- Judged beyond the task list:
  - The logo's black is `#060807`, not pure black. The icons are padded with it (no seam) and
    the mark's filter adds `contrast(1.1)`, which takes the box to `#000000` on black paper
    (and white once inverted), so "pure black is the brand ink" holds on screen.
  - Manifest: `background_color` black (the splash matches the icon), `theme_color` the light
    paper; the per-scheme `theme-color` tags override it at run time.
  - The balance sits on the page in its frame (no grey card) on customer Home and customer
    detail, so the frame reads like the logo; `h2` is width 100, weight 700 (the plan names the
    display cut only for titles, balance and slot times).
  - Outside click closes the menu without moving focus (moving it would fight the click);
    Escape returns focus to the button.
  - Commit trailer is `Claude Fable 5.1` as the Global Constraints say, though this stage ran on
    Opus 5.5.
- Left for the owner: the visual review of the PR; a phone check of the installed icon (Android
  maskable crop, iOS home screen), the status bar colour, and the Android launch screen with the
  manifest `theme_color` `#ffffff` (try `#000000` if it looks wrong).
- Fix list 1 done (`.superpowers/fixes-1.md`, items 1-10): the account menu closes on its button
  in Safari and Firefox on macOS, the account button edge is `--control-line`, no dialog shadow
  in dark, the inline theme script leaves no global, the wordmark crop is the frame's outer edge
  (shown at 28 px, lined up with the page text; icons regenerated), dead selectors and docs
  tidied.

### Handoff state (2026-10-24, Stage 7)

- Branch `stage-7-nav-structure` off `stage-6-brand-theme`; all 6 Stage 7 tasks done, PR open
  against `stage-6-brand-theme`, not merged. Vitest 380, lint, typecheck, build and
  `check-docs.sh` green. No DB change.
- Test first (watched red): one navigation inside the top bar (both shells); the settings
  redirect and each tab with `aria-current` on the tab and on **Nastavitve**; per screen, the
  on-demand form closed until its button is pressed, focus in its first field, **Prekliči**
  drops the input and returns focus, a save closes it (Nov termin, Novo zaprto obdobje, Nova
  stranka, Nov termin po dogovoru, Dodaj stalni termin, Uredi podatke); the calendar's one
  **Dodaj stranko** per occurrence, one control open at a time, **Polno** and **Zaprto**; the
  customer detail heading order and the balance/credits grid.
- Browser check (Vite dev server on 5177, local stack, agent-browser sessions `s7-trainer`,
  `s7-ana`): every screen at 390, 768 and 1440 px in both system themes, each on-demand form
  opened and cancelled with focus checked; the account menu and the cancel dialog (closed with
  Escape, never confirmed) next to the new nav at 1440. At 360 px `scrollWidth` 360 on every
  trainer and customer screen and no tap target under 44 px on the trainer screens. No form
  was saved: demo data unchanged. Screenshots in the gitignored `.superpowers/shots/` (`t1-*`
  … `t5-*` per task, `final-*` for the full pass; the 390 px `--full` shots of a customer
  detail draw the fixed bottom nav mid-page, a capture artifact).
- Judged beyond the task list:
  - The on-demand buttons sit at the right of the heading the form belongs to (the page title
    for **Nova stranka** and **Nov termin po dogovoru**, the section heading otherwise) and the
    form opens under that heading, above the list, not under the list as the ASCII sketch
    shows: one pattern everywhere, visible without scrolling (ADR 0011).
  - Settings tabs spread across the column below 768 px (left aligned they did not fit at
    360 px with the 44 px minimum on "Urnik"); left aligned from 768 px.
  - From 768 px the top bar spans the window with a hairline below it; its content keeps the
    46 rem column, and the active link's underline sits on the hairline.
  - The **Krediti** card stays always open (the detail page's main action); **Podatki** shows
    phone and email as text until **Uredi podatke**, and its success line moved to the section
    so it survives the form closing.
  - The section headings under the tabs stay (Termini v tednu, Rok za brezplačno odpoved,
    Zaprta obdobja, Obvestila); two repeat the tab's name.
  - Editing an existing template or blocked period (**Uredi** in a row) is unchanged: it already
    opened in place with **Prekliči**; it does not move focus.
- Wide screens: at 1440 the 46 rem column holds every screen except that the trainer calendar
  stays a long single column of days; a wider calendar (days side by side) would need its own
  design decision.
- Project `reviewer`: approve with fixes. Done in the fix commit: the settings tabs wrap
  instead of scrolling (the scroll box clipped the focus ring), Prekliči on a new template
  clears the section notice like a new blocked period, opening **Uredi podatke** drops the old
  saved line, and the calendar's add control closes when a rejected booking's reload shows
  the occurrence full or blocked. Not changed: the nav stays between the wordmark and the
  account menu in the DOM (right for the top bar; below 768 px Tab reaches the bottom tabs
  before the account button); **Dodaj stranko** still opens an empty select when every
  customer is already booked on an occurrence with free places (rare; would need new copy).
- Fix list 1 done (`.superpowers/fixes-1.md`, items 1-8; Vitest 391): Prekliči disabled while a
  save or count runs (fake client `holdTable`), **Ni strank za dodajanje**, one black button per
  screen (section-level on-demand buttons outlined), balances of 0 or more in plain ink, focus
  to the occurrence row when its control closes into a disabled button, the ad-hoc form closes
  on a week change, pilot path and the Dodaj stranko copy question. The "nobody to add"
  screenshot mocks an empty customer list in the page (`fetch` patched in the browser); no data
  changed.
- Left for the owner: the visual review of the PR.

### Handoff state (2026-10-25, Stage 8)

- Branch `stage-8-small-data` off `main` (d22cd71); issues #20, #12, #13 done in that order, one
  feature commit each, then a review-fix commit, the plan commit and the fix-list-1 commit;
  PR #22 open against `main`, not merged. Vitest 410, `supabase test db` 449,
  `supabase db lint`, lint, typecheck, build and `check-docs.sh` green. One migration,
  `20261024193349_data_retention.sql`, applied locally with `supabase migration up --local`
  (no reset); the hosted push is the orchestrator's after merge.
- Test first (watched red): #20 the label without "(s papirja)" (`getByLabelText` failed on the
  old text); #12 `033_retention.sql` failed with `prune_cron_history() does not exist` before
  the migration; #13 the data tests failed on the missing `./page` module and then on the
  unpaged results, the page tests failed on every list before `PagedList`.
- #12 measurements (local stack, demo data, 10,000 rows inserted per table in a rolled-back
  transaction): appointments 269 B/row, credit_transactions 185, notifications 286,
  cron.job_run_details 167, auth.audit_log_entries 289; `pg_database_size` 14 MB; pg_cron
  1.6.4, pg_net 0.20.4 with `pg_net.ttl` 6 hours. Projection in ADR 0013: business data about
  8 MB a year, the cron log 12 MB a year without pruning and about 0.5 MB with it.
- Browser check (Vite dev server on 5178, local stack, agent-browser sessions `s8-ana`,
  `s8-trainer`): `/c/zgodovina` and ana's customer detail at 390, 768 and 1440 px in both
  themes, each with the button, after one **Pokaži več** and at the end of the list
  (`t3-history-*`, `t3-detail-*`); at 360 px `scrollWidth` 360 and the button 48 px tall. By
  keyboard with the ledger request aborted (agent-browser `network route --abort`): the button
  shows "Nalaganje …" with `aria-disabled` and keeps focus; supabase-js retries a network
  failure three times (1, 2, 4 s) before the error line appears; the ten rows stay; after
  unrouting, Enter loads 20 and focus is on row 11 (`t3-history-loading`, `-failed`,
  `-retried`). Screenshots in the gitignored `.superpowers/shots/`.
- Demo data: for the check, 16 `cancelled` past appointments for ana (source `trainer`, no
  template, 1-16 Sept 2026 at 18:00 Ljubljana) and 10 pairs of ledger rows with the note
  "s8 test" (`topup` +1 at 10:00 and `adjustment` −1 at 10:01, every other day from 2 Sept) were
  inserted in one transaction, ids recorded, and all 36 deleted again afterwards by id (no
  notification rows were created: no push subscriptions locally). Ana is back at 9 past
  appointments, 5 ledger rows, balance 4. **Opravljeni termini** for ana has 4 charged rows in
  the last 30 days, so its button was not seen in a browser (charged rows were not on the
  allowed list); it is covered by the Vitest page tests.
- Judged beyond the issues:
  - ADR 0013, not 0012: issue #11 reserves 0012 (Workers deploy), so the index has a gap until
    it lands.
  - The cron cleanup is a function (`prune_cron_history`, cron-only like
    `charge_due_appointments`) rather than inline SQL, so pgTAP can test the rows it deletes.
    03:07 UTC, off the quarter hour. 14 days as the issue says (Supabase's example keeps 7).
  - `auth.audit_log_entries` is the one log nothing trims (Supabase Auth cleans refresh tokens
    and expired sessions, not the audit log): 2 rows per token refresh, about 20-70 MB a year
    depending on app opens. No job writes into `auth`; the runbook's threshold (50 MB) triggers
    a new ADR.
  - Paging: one extra row instead of a count, `id` as a tie-break after the time order (one
    charge run gives equal `created_at`), the first page's `now`/`since` reused for later pages,
    duplicates skipped by id. The trainer's **Opravljeni termini** keeps its 30-day window and is
    paged inside it. After an action on customer detail the reload shows the first 10 again.
  - Loading uses `aria-disabled` (styled like `:disabled`, also added to the hover rules), not
    `disabled`, so focus stays on the button for a retry; after a page loads, focus moves to the
    first new row (`tabindex="-1"` on rows), which also covers the button disappearing.
  - The error line reuses `common.loadFailed`, the loading label `common.loading`; the only new
    string is `common.showMore`.
- Project `reviewer`: approve with fixes, no Critical or Important. All four Minor items done
  in 7285d74: two links to `jobs.md#prune_cron_history-daily`, the docs index lists the new job,
  ADR 0013 has the local size of every listed relation, and a page that arrives after a reload
  no longer leaves a row waiting for focus.
- Owner actions: none new. After merge the release checklist expects the fourth cron job
  (`prune_cron_history`, `7 3 * * *`) on the hosted project; the first monthly "Database size
  check" records the hosted baseline. If `auth.audit_log_entries` passes 50 MB, the owner can
  turn off "Write audit logs to the database" (Authentication, Audit Logs; free).
- Fix list 1 done (`.superpowers/fixes-1.md`, items 1-7): the release checklist (step 4) and the
  runbook (deploy step 7) run `select public.prune_cron_history();` once after the push to
  prove the hosted delete permission; `PagedList` merges a page against the rows in state (not
  the rows at click time) and only a page that reaches furthest moves the offset and `more`;
  `033_retention.sql` marks each fixture old or not by hand instead of reusing the function's
  predicate; the label test reads `t.customers.startingBalance` and checks it has no "papir";
  ADR 0013 and the runbook name the Auth setting that stops audit-log writes to the database
  as the owner's remedy at 50 MB (Supabase docs "Auth Audit Logs"); this handoff's commit
  count; two over-long doc lines rewrapped. Item 2 is a refactor that no test can reach
  through the UI (the loading guard stops a second press), so it has no new red test; the page
  tests stay green.

### Handoff state (2026-10-25, Stage 9)

- Branch `stage-9-stranke-urnik` off `main` (6994aea, after Stage 8); issues #14, #16, #15 in
  that order, one feature commit each, then a review-fix commit and this plan commit; PR open
  against `main`, not merged. Vitest 477 (410 at Stage 8), lint, typecheck, build and
  `check-docs.sh` green. No DB change, no migration.
- Test first (watched red): #14 `customerSearch.test.ts` failed on the missing module, the 12
  page tests on the missing search field; the caret test fails on a URL-driven input (checked
  by swapping the old logic back in) and passes on the local-state one; the Back-after-reset
  test (review) failed before the navigation-type check. #16 `weekdayHeading` and
  `schedule.test.ts` failed on the missing functions, the 14 grid, day-group and updated
  template tests before `TemplateWeek`. #15 the overlap unit tests on the missing functions,
  the page tests before the check, and the two edit cases (an overlap the slot already had,
  one an edit adds) before the "new overlaps only" rule. The legend and inactive-legend
  assertions went red before their markup.
- Browser check (Vite dev server on 5179, local stack, agent-browser session `s9-trainer`):
  Stranke default, a diacritic search ("zupancic"), **Dolžniki**, **Brez računa** and the empty
  state at 390, 768 and 1440 in both themes (`t1-stranke-*`); the caret stays put when typing
  mid-word (it jumped to the end with the URL-driven input); `?q=kos&f=brez` survives a
  customer and both **Nazaj na stranke** and browser Back. Urnik grid at 768 and 1440 and day
  groups at 390 in both themes (`t2-urnik-grid-*`, `t2-urnik-groups-*`, also `--full`), the
  edit dialog from a block (1440 dark, 768 light, focus in **Dan**, Escape back to the block),
  the overlap warning in the form (1440 light, 390 dark) and the marks (`t3-urnik-*`). At
  360 px `scrollWidth` 360 on `/t/stranke`, its empty state and `/t/nastavitve/urnik`, no tap
  target under 44 px; at 768 the grid scrolls inside its box (832 in 704) and the page does
  not. Screenshots in the gitignored `.superpowers/shots/`.
- Demo data: the demo week already had an overlap (Monday 07:00 and 07:07, both active), so
  the marks needed no extra row. For the warning and an inactive block, one template was
  added through the UI (Monday 07:30, 60 min, 5 places: warning shown, then saved inactive),
  id `963619a2-642d-45e6-b701-7440dd52d584`, and deleted by id with psql after checking that no
  appointment or rule referenced it; back to 11 templates. The second warning (390 dark) was
  cancelled, not saved. After the review fixes the same template was added again through the
  UI to see them (id `ab00499b-a5cc-4c16-8da3-4da5ebcad322`): the dotted inactive edge and both
  legend lines at 768 and 1440 in both themes and the inactive row at 390 (`t4-urnik-*`), the
  focus ring of a lane-0 block drawn over its neighbour, and the edit dialog at 844×390 (a
  phone held sideways) with the overlap warning, which scrolls inside the window so **Shrani**
  is reachable (`t4-urnik-dialog-*`; Escape, not saved). Deleted by id the same way; 11
  templates, none inactive. The demo has one debtor (Tadej Mlakar, −2), not two, and no inactive
  template.
- Judged beyond the issues:
  - **Brez računa** includes customers with a pending invite (they keep the **Povabilo čaka**
    tag); no separate filter. **Počisti iskanje** also returns to **Vsi**. A query of digits
    (with spaces, `+`, `-`, `/`, `.`, brackets) searches phones only, with `+386`/`00386` read
    as 0; words must all appear in the name or email; đ folds to d.
  - The count line is `customers.total` unfiltered ("9 strank") and `customers.shown` while
    narrowed ("Prikazanih 7 od 9", participle agreeing with the count), one persistent
    `role="status"` that also carries the no-match message. The pressed filter segment is
    framed in ink, not filled, to keep one black button per screen.
  - The search field keeps its own state and writes the URL with `replace` and
    `{fromSearch: true}`; any other navigation (main nav, Back) resyncs it. Filters also use
    `replace`, so the list is one history entry. The row links carry the query string in
    navigation state for **Nazaj na stranke**; the detail page keeps it when it clears its
    starting-balance message.
  - Grid vs day groups is chosen in script (`useMediaQuery`, false in jsdom), not by CSS, so
    only one is in the page (ADR 0011's reasoning). Only the grid widens (`.wide`, ADR 0014;
    Stage 10's calendar can reuse it): from 1024 px it starts at the title's left edge and
    grows right to `--content-wide` (80 rem) or one gutter from the window (1056 px at 1440),
    so the title, tabs and top bar never move between settings tabs. `.wide` also scrolls
    sideways inside its own box whenever its content needs more (768-1023 px), with the hour
    column sticky. (Fix list 2 replaced the first, centred rule.)
  - Editing from a block opens a dialog (portal to `body`) with the cancel dialog's focus
    rules, now a shared `useModal` (`pages/shared/modal.ts`); focus returns to the block, found
    by template id when a save moved it to another day. Day groups keep the inline form.
    No empty-cell click.
  - Blocks: time range in the display cut (condensed 800), an hour 5 rem, every block at
    least 44 × 44 px (a short slot is drawn 44 px tall; day columns are at least the most
    lanes on any day × 48 px, `--max-lanes`); lanes include inactive templates so nothing
    sits on top of anything. Overlap mark: 2 px dashed ink edge plus the condensed
    "prekrivanje" tag; inactive: dotted edge, muted, "neaktiven". A container query hides
    block tags in lanes under 4.75 rem (now also the two Monday lanes at 1440, 67.5 px), and
    a legend line above the grid names the edges.
  - The overlap check warns only about overlaps a save adds (an edit of an intended overlap,
    for example its capacity, saves at once), shares one confirmation with the stranded
    warning (both shown at once, one more **Shrani**), and its copy is keyed
    `single`/`pair`/`several` (terminom/terminoma/termini), not a `Plural`, since no count
    is shown; rule recorded in `app-structure.md`.
  - `settings.templateLine` is gone (Changes row in `copy-review.md`).
- Project `reviewer`: approve with fixes, no Critical. Important, all done in baba563:
  Back to a searched list left the field empty; the dialog could not scroll (a phone held
  sideways is past 768 px); blocks under 44 px. Minor done: inactive blocks' non-colour cue,
  the focus ring above lane neighbours, a persistent status line, the confirm sentence once,
  no duplicate notice behind the dialog, the keyed-strings rule in `app-structure.md`. Not
  changed: the self-overlap page test cannot fail without the id exclusion (the stored self is
  either inactive or already subtracted as an existing overlap), so `schedule.test.ts` is
  what covers it; "386" alone matching phones with a 0 while typing (nit).
- Owner actions: none. Open copy questions for the trainer are in `copy-review.md`
  (`customers.shown` wording, `settings.overlapping`, the empty-list copy when only a filter
  empties it).
- Fix list 2 done (`.superpowers/fixes-2.md`, items 1-10): the wide grid starts at the
  title's edge and grows right, `.wide` carries its own sideways scroll and the grid's classes
  are `template-*` (item 1); 44 × 44 px blocks with `--max-lanes`, the exception dropped (2);
  `closeEdit` clears the notice (3); `useModal` falls back to `returnTo` when the opener is
  `body` or gone, as after a Safari tap (4); day groups move focus into the form on **Uredi**
  and back to **Uredi** on Prekliči or save (5); `+386`/`00386` → 0 only after `+` or `00`
  (6); the duplicate `.dialog` and `li` rules merged (7); the filter-only empty copy is open
  question 7 in `copy-review.md` (8); the search shows only once the list loaded (9). Test
  first: the 386 cases, the search while loading (holding `customer_balances`; holding
  `customers` stalls the sign-in lookup too), `--max-lanes`, the Safari-style click
  (`block.click()` without focus), the failed save's error after Prekliči (new
  `db.writeErrors` in the fake client) and the day-group focus all failed before the change.
  Browser (`f2-*` in `.superpowers/shots/`): grid at 1024x768 and 1440x900 with its left edge
  on the title's (160/160, 368/368) and no page scroll, 768x1024 scrolling 832 in 704, both
  themes; the narrowest overlapping block 51.5 × 76 px at 768; a temporary 15-minute
  inactive template (Wednesday 06:00, id `40419b6e-c068-43fa-ae82-9f9fb59230f9`, added
  through the UI, deleted by id) measured 109.3 × 44 px; at 390 Uredi then Prekliči by
  keyboard leaves the ring on that **Uredi**; Stranke "386" shows the empty state, "+386 41"
  three customers. One keyboard run pressed Enter in a number field instead of Prekliči and
  saved Monday 07:07 with unchanged values. Demo data back to 11 templates.

### Handoff state (2026-10-25, Stage 10)

- Branch `stage-10-koledar` off `main` (39abf3b, after Stage 9); issue #17 in a helper commit,
  a feature commit, a browser-fix commit, a review-fix commit and this plan commit; PR open
  against `main`, not merged. Vitest 525 (483 at Stage 9), lint, typecheck, build and
  `check-docs.sh` green. No DB change, no migration.
- Test first (watched red): `parseLocalDate` and `defaultDayOf` failed on the missing
  functions; 18 page tests (strip, default day, URL with `replace`, Back, empty day, the day's
  outside-the-grid list, grid columns, card order, today's column, the DST Sunday in both
  views) failed before the views existed. The add, one-control, Polno and both cancel tests
  run in each view (`describe.each`); they passed before too, as characterisation of what must
  keep working. A mutation check (bucketing appointments by UTC) turned both DST view tests red.
  Review fixes: the no-reload/focus test and the arrows-disabled test failed first, and the
  day-button name test (visible text in the name) failed on the `aria-label`.
- Browser check (Vite dev server on 5180, local stack, agent-browser sessions `s10-trainer`,
  `s10-ana`): the day view at 390 and 768 in both themes (default day, Monday 26 Oct with the
  full 07:00 and five names, Friday 30 Oct blocked, Tuesday 27 Oct with an ad-hoc
  appointment, a past week, **Dodaj stranko** open with focus in the select, the cancel
  dialog opened and closed with Escape with focus back on **Odpovej**, never confirmed), an
  empty day (`fetch` for `slot_templates` patched to `[]` in the page, then the next week
  opened through the arrow; agent-browser `network route --body` did not intercept these
  requests); the week grid at 1440x900 and 1024x768 in both themes (the week of 26 Oct with
  Polno, Zaprto and two ad-hoc cards, the current week with today and the DST Sunday, the week
  of 12 Oct), the add control and the cancel dialog in the grid at 1440. 1023 px shows the
  strip, 1024 px the grid. At 360 px `scrollWidth` 360, day buttons 44.6 px wide and 52 px
  tall, no target under 44 px. The grid's left edge is the title's (368/368 at 1440,
  160/160 at 1024); the whole week fits from 1280 (976 px box) and scrolls inside its box at
  1024 (920 in 848); the page never scrolls sideways. The first day press on a bare
  `/t/koledar` makes no new request and keeps focus. Customer Koledar at 390 and 1440 is the
  old list (no strip, no grid). Screenshots `t1-*` in the gitignored `.superpowers/shots/`.
- Demo data: nothing added, changed or deleted; no dialog was confirmed and no booking made.
- Judged beyond the issue:
  - `?dan` alone decides the week; the arrows write the target week's default day; both the
    day buttons and the arrows use `replace` (one history entry, like Stranke's filters). The
    main navigation's **Koledar** (no `dan`) resets to the current week and today. The loaded
    week is kept in state, so the first press that adds `dan` in the current week does not
    reload. Before the first load the arrows are disabled (no timezone, so no Monday yet).
  - `loadWeek` takes an optional `start` (a Monday) next to `weekOffset`; the customer
    calendar and Today are untouched. `SlotRow` was extracted from `WeekSlots` with identical
    markup for the day view.
  - Day buttons show `Intl`'s "pon." over "26." instead of a hand-written "Po 26.", so no new
    abbreviations in `sl.ts`; their name is the visible text plus the month in hidden text.
    Selected = ink frame on paper (the Stranke segment style), today = underlined number and
    `aria-current="date"`; the grid marks today with a "danes" tag and a 2 px rule.
  - **Termini zunaj urnika** shows only when the selected day has entries (as on Today); in
    the grid those appointments are grey cards in their day's column, sorted with the slots.
    `trainer.noOther` is removed (Changes row in `copy-review.md`).
  - Grid columns are at least 8 rem, so 1280 and 1366 px laptops see the whole week (9 rem cut
    Sunday below about 1390 px); a container query drops the `+` icon under 8.75 rem; a long
    disabled reason may wrap in a card. No new layout rule: `wide` from ADR 0014 as it is,
    with one consequence line added there. No new ADR: the view switch in script is ADR
    0014's own rule, and the URL behaviour is documented in `screens.md` like Stage 9's.
  - **Nov termin po dogovoru** defaults its date to the selected day instead of the week's
    Monday.
  - Stage 11's **Odpovej termin** fits next to **Dodaj stranko** at the foot of `SlotRoster`
    (rendered by the page's `roster(slot)` for both views).
- Project `reviewer`: approve with fixes. Critical (the first day press on a bare URL reloaded
  the week and dropped focus), both Important (16 px select in cards, dead arrows before the
  first load) and the Minor items (h2 column headings, label in name, focus ring inset,
  disabled outline in cards, tests choosing the day view, docs on the ad-hoc date and
  wrapping) are done in 6cfb1f7. Not changed: a new ADR for `?dan` and the view switch (see
  above).
- Owner actions: none. Phone check of the day strip on a real device whenever convenient.

---

## Stage 1 tasks

### Task 1: Harness foundation (docs before code)

Create, in one commit `docs: harness foundation (CONTEXT, ADRs 0001-0006, diagrams)`:

1. `.gitignore` at repo root: `node_modules/`, `dist/`, `.env`, `.env.*`, `!.env.example`,
   `supabase/.temp/`, `supabase/.branches/`, `.claude/settings.local.json`, `.superpowers/`,
   `.DS_Store`, `coverage/`.
2. `CONTEXT.md` — domain language, one term per entry with a one-sentence definition and the
   DB/RPC name it maps to: credit, balance (ledger sum), top-up, adjustment, charge, session
   charge, late cancel, refund, cutoff (`late_cancel_hours`, default 5), slot template
   (weekday, start time, duration default 60, capacity default 5), slot (a concrete
   occurrence of a template), appointment (statuses listed), recurring rule, materialization,
   ad-hoc appointment, blocked period, debtor (negative balance), invite (single-use,
   expiring token), trainer, customer, keep-alive. Also a "Rules" section: one charge per
   appointment, negative balances allowed, nobody logs attendance, trainer may cancel
   anything at any time without charge.
3. `docs/adr/` with `README.md` (index + template) and ADRs in the format: title line
   `# NNNN. <title>`, `Status: Accepted`, `Date: 2026-10-23`, sections Context / Decision /
   Consequences:
   - `0001-remove-qr-check-in.md` — cutoff-based charging replaces QR/attendance.
   - `0002-charge-timing.md` — session charge at session start by a 15-min job; late cancel
     charged at cancel time; trainer cancel never charges and refunds an existing charge.
   - `0003-ledger-only-balance.md` — no balance column; partial unique index on charges
     (`session`,`late_cancel`) excludes `refund`.
   - `0004-slot-templates-per-slot-capacity.md` — weekly grid as templates with per-slot
     duration/capacity; capacity counted over `booked`+`charged`.
   - `0005-supabase-free-tier-cloudflare-pages.md` — stack choice; consequences: project
     pauses after ~7 days low activity, 500 MB read-only limit, keep-alive read on app load,
     unpause from dashboard; Firebase rejected.
   - `0006-auth-invite-token-password.md` — email/password with confirmations disabled;
     customers only via trainer-generated invite tokens (`create_invite`/`accept_invite`,
     7-day expiry, single use); rationale: default SMTP is 2 emails/hour, best-effort,
     non-production (Supabase docs 2026-10-23); consequence: no self-service password reset
     in Stage 1 (trainer re-issues an invite to re-link), public sign-up yields a user with
     no customer row and therefore no data access.
4. `docs/architecture/` Mermaid diagrams, each a `.md` with a one-paragraph intro and one
   ```mermaid fence: `system-context.md` (PWA on Cloudflare Pages, Supabase Auth/Postgres/
   pg_cron/edge functions, push service, trainer + customer phones), `data-model.md` (erDiagram
   of all tables in PLAN.md incl. `settings.timezone`), `appointment-states.md`
   (stateDiagram-v2: booked → charged | cancelled | cancelled_late | cancelled_by_trainer;
   charged → cancelled_by_trainer with refund), `charging-sequence.md` (cron → RPC → ledger,
   plus a late-cancel race lane), `booking-sequence.md` (customer → `book()` → lock →
   capacity count → insert), `auth-invite-flow.md` (trainer creates invite → link → sign-up →
   `accept_invite` → role-gated home).
5. `docs/README.md` index; `docs/harness.md` describing the conventions: docs 1:1 rule, ADR
   rule (one per decision, Superseded never deleted), diagram rule, skill rule ("second time a
   task repeats"), reviewer gate, no blocking hooks, no regenerated artifacts except DB
   types, tests derive counts. `docs/runbook.md` with sections: unpause a paused Supabase
   project, bootstrap the trainer (placeholder SQL to be finalized in Task 2), deploy
   migrations after merge (`supabase db push` from main only), Cloudflare Pages build settings
   (root `app`, build `npm run build`, output `dist`).
6. Stubs with the heading and a "filled in Task N" note: `docs/schema.md`, `docs/rpcs.md`,
   `docs/jobs.md`, `docs/screens.md`.
7. `.claude/agents/reviewer.md` — a project reviewer agent (frontmatter `name: reviewer`,
   `description`, `tools: Read, Grep, Glob, Bash`) whose body is the review checklist: spec
   vs PLAN.md, docs 1:1 (schema/RPC/job/screen change ⇒ doc + diagram in same commit), no
   generated artifacts beyond DB types, no hardcoded counts in tests, Slovenian strings only
   in `app/src/i18n/sl.ts`, RLS/role check present on every RPC, no blocking hooks, free-tier
   only. Output format: Spec ✅/❌, Critical/Important/Minor, verdict.
8. `README.md` at root: what AMRAP is, layout, how to run locally (`supabase start`,
   `supabase db reset`, `supabase test db`, `cd app && npm i && npm run dev`).

Do not write any code or migrations in this task. Verify every Mermaid block parses with
`npx -y @mermaid-js/mermaid-cli@11 -i <file>` is NOT required; instead keep syntax to the
documented subset and double-check fences. Commit once.

### Task 2: Schema, RLS, test harness, generated types

Migration `supabase/migrations/<ts>_initial_schema.sql` (one file), using TDD with pgTAP:
write the failing RLS tests first, then the migration.

Schema (all in `public`, all tables `enable row level security`):
- `customer_role` enum (`trainer`,`customer`); `appointment_status` enum; `appointment_source`
  enum (`recurring`,`self_booked`,`trainer`); `transaction_type` enum.
- `customers(id uuid pk default gen_random_uuid(), name text not null, phone text, email text,
  role customer_role not null default 'customer', auth_user_id uuid unique references
  auth.users(id) on delete set null, invite_token text unique, invite_expires_at timestamptz,
  created_at timestamptz not null default now())`. Invite status is derived: linked if
  `auth_user_id` is set, pending if a token exists and is not expired, otherwise none.
- `slot_templates(id, weekday smallint not null check 0..6 (0 = Monday), start_time time not
  null, duration_minutes int not null default 60 check > 0, capacity int not null default 5
  check > 0, active boolean not null default true, created_at)`.
- `recurring_rules(id, customer_id fk, slot_template_id fk, active boolean default true,
  created_at)`, unique `(customer_id, slot_template_id)`.
- `appointments(id, customer_id fk not null, slot_template_id fk null, starts_at timestamptz
  not null, ends_at timestamptz not null check ends_at > starts_at, status
  appointment_status not null default 'booked', source appointment_source not null, rule_id
  uuid fk recurring_rules null, cancelled_at timestamptz, created_at)`. Partial unique index
  `(customer_id, starts_at) where status in ('booked','charged')` (one live booking per
  customer per start time). Index `(slot_template_id, starts_at)` and `(status, starts_at)`.
- `credit_transactions(id, customer_id fk not null, amount int not null check amount <> 0,
  type transaction_type not null, appointment_id uuid fk appointments null, created_by uuid
  references auth.users(id) null, note text, created_at)`. Partial unique index
  `(appointment_id) where type in ('session','late_cancel')`. Check: `session` and
  `late_cancel` must have amount = -1 and an appointment_id; `refund` must have amount = 1 and
  an appointment_id; `topup` amount > 0; `adjustment` any non-zero.
- `blocked_periods(id, starts_at, ends_at check >, reason text, created_at)`.
- `settings(id int pk check (id = 1), late_cancel_hours int not null default 5 check >= 0,
  timezone text not null default 'Europe/Ljubljana')`, seeded with the single row in the
  migration.
- `push_subscriptions(id, user_id uuid fk auth.users not null, endpoint text not null unique,
  p256dh text not null, auth text not null, created_at)`.
- View `customer_balances(customer_id, balance)` with `security_invoker = true`:
  `coalesce(sum(amount),0)` per customer over `customers left join credit_transactions`.
- Helpers (`security definer`, `stable`, `set search_path = ''`): `public.current_customer_id()
  returns uuid` (customer row for `auth.uid()`), `public.is_trainer() returns boolean`.
- RLS: trainer full access on every table. Customer: `select` own row in `customers`, own
  rows in `recurring_rules`, `appointments`, `credit_transactions`; `select` on active
  `slot_templates`, `blocked_periods`, `settings`; full CRUD on own `push_subscriptions`.
  No `insert/update/delete` for customers on any other table (writes happen via RPCs in
  Task 3). `anon` has no access at all (revoke).
- `revoke all on all tables in schema public from anon` and keep `authenticated` grants
  consistent with the policies.

Test harness:
- `supabase/seeds/test_helpers.sql` creating schema `tests` with:
  `tests.create_user(email text, password text default 'password') returns uuid` (inserts
  into `auth.users` + `auth.identities` the way Supabase CLI seeds do),
  `tests.authenticate_as(user_id uuid)` (`set local role authenticated; set local
  request.jwt.claims` with `sub` and `role`), `tests.authenticate_as_service_role()`,
  `tests.clear_authentication()`. `supabase/seeds/dev.sql` with a local trainer
  (`trainer@amrap.local` / `password`) and two customers (one invited, one linked:
  `ana@amrap.local` / `password`), two slot templates, and a top-up. Wire both into
  `config.toml` `[db.seed] sql_paths = ["./seeds/test_helpers.sql", "./seeds/dev.sql"]`.
- `supabase/tests/001_schema.sql`: tables, enums, indexes, constraints exist (use pgTAP
  `has_table`, `has_index`, `col_is_pk`, etc.); the partial unique index rejects a second
  `session` charge for the same appointment but allows a `refund`; the balance view sums
  correctly for inserted rows (derive the expected value from the inserted amounts).
- `supabase/tests/002_rls.sql`: as a customer, I see only my rows in every table, cannot
  see other customers, cannot insert/update appointments or transactions directly; as the
  trainer, I see all; as anon, nothing.
- Run `supabase start` (if not running), `supabase db reset`, `supabase test db`. All green,
  pristine output.
- Generate `app/src/lib/database.types.ts` with `supabase gen types typescript --local
  > app/src/lib/database.types.ts` (create the directory; the file is the only generated
  artifact committed).

Docs in the same commits: `docs/schema.md` (every table with columns, constraints, indexes,
RLS policy summary; a "Migrations" section listing each migration filename with one line),
`docs/architecture/data-model.md` ERD updated if it differs, `docs/runbook.md` trainer
bootstrap finalized (create the auth user in the dashboard, then
`insert into public.customers (name, role, auth_user_id) values (...)`), `docs/harness.md`
"Testing" section describing the pgTAP harness and how to write a test. `README.md` run
instructions updated if needed.

Commits: (1) `test: pgTAP harness and failing schema/RLS tests`, (2) `feat(db): initial
schema, RLS and balance view`, (3) `chore: generated database types` — or fewer if the TDD
evidence is kept in the report. Do not create a `.claude/skills/new-migration` skill yet
(first migration).

### Task 3: Core RPCs with pgTAP tests (TDD) + new-migration skill

Migration `supabase/migrations/<ts>_core_rpcs.sql`. All functions `security definer`,
`set search_path = ''`, `language plpgsql`, raise `exception` with a stable error code via
`using errcode = 'P0001'` and a message prefixed by a machine-readable token (e.g.
`'AMRAP_CAPACITY_FULL: ...'`) so the UI can map it to Slovenian copy. `grant execute` to
`authenticated` only, except `charge_due_appointments` which is `revoke`d from
`authenticated` and `anon` (service role / cron only).

Role rules: `public.is_trainer()` decides trainer; customers act only on themselves
(`public.current_customer_id()`), otherwise `AMRAP_FORBIDDEN`.

- `book(p_customer_id uuid, p_starts_at timestamptz, p_slot_template_id uuid default null,
  p_ends_at timestamptz default null) returns uuid`.
  Customer: `p_customer_id` must be own id, `p_slot_template_id` required, template must be
  active, `p_starts_at` must be in the future and match the template's weekday/start_time
  in `settings.timezone`; `ends_at = starts_at + duration`. Trainer: any customer; with a
  template the same rules minus the future check; without a template `p_ends_at` required
  (ad-hoc). Source: `trainer` if trainer else `self_booked`. Take
  `pg_advisory_xact_lock(hashtext(p_slot_template_id::text || p_starts_at::text))` when a
  template is given, then count appointments with that template and start in
  (`booked`,`charged`); if `>= capacity` → `AMRAP_CAPACITY_FULL`. Reject if the start falls
  inside a `blocked_periods` row → `AMRAP_BLOCKED`. Duplicate live booking surfaces as
  `AMRAP_ALREADY_BOOKED` (catch `unique_violation`).
- `cancel(p_appointment_id uuid) returns void`. `select ... for update` the appointment.
  Customer: must own it; status must be `booked` else `AMRAP_NOT_CANCELLABLE` (covers
  already charged/started); if `now() < starts_at - late_cancel_hours * interval '1 hour'`
  → status `cancelled`, no transaction; else → `cancelled_late` + insert `late_cancel` (−1)
  with `created_by = auth.uid()`. Trainer: status `booked` → `cancelled_by_trainer`;
  status `charged` → `cancelled_by_trainer` + insert `refund` (+1) referencing the
  appointment; any cancelled status → `AMRAP_NOT_CANCELLABLE`. Always set `cancelled_at`.
- `top_up(p_customer_id uuid, p_amount int, p_note text default null) returns uuid` —
  trainer only, amount > 0, type `topup`.
- `adjust(p_customer_id uuid, p_amount int, p_note text default null) returns uuid` —
  trainer only, amount <> 0, type `adjustment`.
- `charge_due_appointments() returns int` — for each `booked` appointment with
  `starts_at <= now()`, lock the row (`for update skip locked`), set `charged`, insert
  `session` (−1) with `created_by = null`; return the number charged. Idempotent.
- `create_invite(p_customer_id uuid) returns text` — trainer only; customer must not be
  linked; sets `invite_token = encode(gen_random_bytes(24),'hex')`,
  `invite_expires_at = now() + interval '7 days'`; returns the token.
- `accept_invite(p_token text) returns uuid` — authenticated; locks the customer row by
  token; rejects missing/expired (`AMRAP_INVITE_INVALID`), already linked
  (`AMRAP_INVITE_USED`), or a caller already linked to another customer
  (`AMRAP_ALREADY_LINKED`); sets `auth_user_id = auth.uid()`, clears the token; returns the
  customer id.

Tests (TDD: write each failing test first; one file per RPC under `supabase/tests/`, named
`010_book.sql`, `011_cancel.sql`, `012_credits.sql`, `013_charge_job.sql`,
`014_invites.sql`), covering at minimum: capacity overflow exactly at the boundary (fill to
capacity, the next book fails, a cancel frees it); custom duration/capacity respected;
customer cannot book for another customer; booking in a blocked period rejected; past start
rejected; wrong weekday/time rejected; duplicate live booking rejected; late-cancel boundary
(start = now() + cutoff + 1 min → free; start = now() + cutoff − 1 min → late with one
`late_cancel` row); customer cancel of a `charged` appointment rejected with no new
transaction; trainer cancel of `charged` → refund and net balance 0 (derive from the view);
trainer cancel of `booked` → no transaction; charge job on two due + one future → returns 2,
run again → returns 0 and still exactly one `session` row per appointment; charge vs late
cancel: after charging, a late cancel is rejected and the partial unique index still holds
one charge; negative balance: cancel late with balance 0 → balance −1 and the view shows it;
`top_up`/`adjust` rejected for customers; invite: token works once, second use rejected,
expired token rejected (update `invite_expires_at` into the past in the test), a user
already linked cannot accept another; `charge_due_appointments` not executable by
`authenticated`. Use `tests.authenticate_as` helpers; insert fixture appointments with past
`starts_at` directly as superuser/service role where `book()` would refuse them.

Docs in the same commits: `docs/rpcs.md` (one section per RPC: signature, who may call,
rules, error tokens, side effects), `docs/schema.md` migrations list, `docs/jobs.md`
describing `charge_due_appointments()` as the 15-min job (scheduling itself lands in
Stage 2), `docs/architecture/charging-sequence.md`, `booking-sequence.md` and
`auth-invite-flow.md` adjusted to the real names. Regenerate
`app/src/lib/database.types.ts`.

This is the second migration, so create the project skill
`.claude/skills/new-migration/SKILL.md` (frontmatter `name`, `description`) describing the
repeatable procedure: timestamped file via `supabase migration new <name>`, write failing
pgTAP test first, `supabase db reset` + `supabase test db`, update `docs/schema.md` and/or
`docs/rpcs.md` plus the affected diagram, regenerate types, commit together. Mention this in
`docs/harness.md` "Skills" section.

### Task 4: Vite PWA shell, auth, invite flow

Create `app/` with Vite 7 + React 19 + TypeScript (strict), `react-router` v7 (data
router), `@supabase/supabase-js` v2, `vite-plugin-pwa`, Vitest + Testing Library,
ESLint (flat config) + Prettier. Use `npm`. Node 25 is installed locally; set
`"engines": { "node": ">=22" }`.

Structure:
- `app/src/i18n/sl.ts` — single exported `const sl = {...} as const` with every string;
  `app/src/i18n/index.ts` exporting `t = sl`. Error-token map `errorMessages: Record<string,
  string>` for the `AMRAP_*` tokens from `docs/rpcs.md`, plus a `fromError(e)` helper that
  maps a Postgres error message to Slovenian copy (fallback generic message).
- `app/src/lib/supabase.ts` — client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  (fail fast with a descriptive error if missing), typed with `Database` from
  `database.types.ts`. `app/.env.example` with the two keys and local defaults
  (`http://127.0.0.1:54321` and the local anon key printed by `supabase start`).
- `app/src/auth/` — `AuthProvider` (session + current `customers` row + role),
  `useAuth()`, `RequireAuth`, `RequireRole('trainer'|'customer')`.
- `app/src/lib/keepAlive.ts` — on app load after sign-in, one lightweight authenticated
  read (`select id from settings limit 1`) to keep the free project active (ADR 0005).
- Routes: `/login` (email + password sign-in), `/invite/:token` (sign-up form: name shown
  read-only is not needed; email + password + confirm; on success call `accept_invite`,
  then redirect to `/`), `/` → redirects to `/t` for trainer or `/c` for customer,
  `/c` customer shell (bottom nav: Domov, Koledar, Zgodovina — placeholder pages that
  render the balance from `customer_balances` and "ni prihajajočih terminov"), `/t` trainer
  shell (nav: Danes, Koledar, Stranke, Nastavitve — placeholder pages), `/logout`.
  A signed-in user with no `customers` row sees a "račun ni povezan" page with a sign-out
  button.
- PWA: `vite-plugin-pwa` with `registerType: 'autoUpdate'`, manifest name "AMRAP",
  `lang: 'sl'`, theme colour, 192/512 PNG icons (generate simple placeholder icons with a
  script committed under `app/scripts/` — the PNGs themselves are committed as assets, they
  are not regenerated artifacts), `display: standalone`.
- Cloudflare Pages: `app/public/_redirects` with `/* /index.html 200`.
- Tests (Vitest, jsdom): `sl.ts` has no empty strings and `fromError` maps a known token and
  falls back; route guard redirects unauthenticated users to `/login` and routes roles to
  `/t` and `/c` (mock the Supabase client module).
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all green.

Docs in the same commits: `docs/screens.md` (route table with role, purpose, strings used;
mark Stage 1 placeholders), `docs/architecture/auth-invite-flow.md` adjusted,
`README.md` local run instructions for `app/`, `docs/runbook.md` Cloudflare section with
the env vars to set in the Pages dashboard.

Commits: `feat(app): Vite PWA shell with Slovenian strings`, `feat(app): auth and invite
flow`, or similar small steps. Do not implement calendar, booking or ledger UI (Stage 2).

### Task 5: CI and docs check

- `scripts/check-docs.sh` (bash, exits non-zero with a listing of what is missing):
  every `supabase/migrations/*.sql` basename must appear in `docs/schema.md`; every
  function name declared by `create or replace function public.<name>` or
  `create function public.<name>` in any migration must appear in `docs/rpcs.md` (helper
  functions `current_customer_id` and `is_trainer` count too — document them under a
  "Helpers" section if missing). Make it runnable locally and keep it under 60 lines.
- `.github/workflows/ci.yml` on `pull_request` and `push` to `main`: job `db` —
  `supabase/setup-cli@v1`, `supabase start -x studio,imgproxy,logflare,vector,edge-runtime`,
  `supabase db reset` is not needed after start (start applies migrations and seeds),
  `supabase test db`; job `app` — Node 22, `npm ci`, `npm run lint`, `npm run typecheck`,
  `npm test -- --run`, `npm run build` in `app/`; job `docs` — `scripts/check-docs.sh`.
  Also verify generated types are current: `supabase gen types typescript --local | diff -
  app/src/lib/database.types.ts` in the `db` job.
- `docs/harness.md` "CI" section describing the three jobs and what the docs check
  enforces. `README.md` badge not needed.
- Run `scripts/check-docs.sh` locally; it must pass on the current tree. Add
  `"check:docs": "bash ../scripts/check-docs.sh"` is NOT needed; keep the script standalone.

Commit: `ci: pgTAP, app and docs checks`.

---

## Stage 2 tasks

Branch `stage-2-core` off `stage-1-foundation`; PR base `main` (#1 is merged).
Rulings for this stage (lasting ones recorded in ADR 0008):
- Blocked periods are checked by **interval overlap** (`appointment [starts_at, ends_at)` vs
  `blocked [starts_at, ends_at)`), for `book()` and materialization alike.
- `materialize_recurring()` may be called by cron/service role (no JWT: `auth.uid() is null`)
  or by the trainer (`is_trainer()`), so a new rule can be materialized immediately from the UI.
- Deactivating a rule cancels its future `booked` instances as `cancelled_by_trainer` (no
  charge) through `deactivate_rule()`; past/charged instances are untouched.
- Remaining capacity is exposed to customers through the owner-executed view
  `slot_occupancy`, a deliberate exception to invoker RLS (ADR 0008): counts only, no
  customer identity, rows only for a linked caller.
- Cron runs as the migration owner (no JWT). `charge_due_appointments` has no grant to
  `authenticated`/`anon`; `materialize_recurring` is granted to `authenticated` and checks
  the role inside (trainer, or no JWT) (ADR 0008).
- A cancelled rule instance is never recreated (any-status `(rule_id, starts_at)` index);
  reactivating a rule does not restore it.

### Task 6: Recurring rules, materialization, occupancy view, pg_cron

New migration (`supabase migration new recurring_and_jobs`; follow the `new-migration`
skill), TDD with pgTAP (`supabase/tests/020_materialize.sql`, `021_rules_and_jobs.sql`,
and extend `010_book.sql` for overlap):

1. Partial unique index `appointments(rule_id, starts_at) where rule_id is not null`
   (any status, so a cancelled instance is never recreated).
2. `book()`: replace the start-only blocked check with interval overlap
   (`tstzrange(starts_at, ends_at) && tstzrange(b.starts_at, b.ends_at)`); keep the
   `AMRAP_BLOCKED` token; adjust existing tests and add an overlap test (appointment that
   starts before the block but ends inside it is rejected).
3. `materialize_recurring(p_weeks int default 4) returns int` — security definer, callable
   when `auth.uid() is null` or `is_trainer()`, else `AMRAP_FORBIDDEN`. For every active rule
   whose template is active, for each occurrence date from today (gym timezone) through
   `today + p_weeks*7 days`: compute `starts_at` = date + `start_time` in `settings.timezone`
   (DST-safe), `ends_at = starts_at + duration`; skip if `starts_at <= now()`; skip if any
   appointment with that `rule_id` and `starts_at` exists; skip if overlapping a blocked
   period; skip if the customer already has a live booking at that start (unique index
   `(customer_id, starts_at)`); take `pg_advisory_xact_lock(hashtext(template_id::text ||
   extract(epoch from starts_at)::text))` exactly as `book()` does, count live appointments
   for that template+start, skip if `>= capacity`; insert `source = 'recurring'`, `status =
   'booked'`, `rule_id`. Return the number inserted. Running twice inserts 0 the second time.
4. `deactivate_rule(p_rule_id uuid) returns int` — trainer only; sets `active = false`;
   cancels future (`starts_at > now()`) `booked` instances of the rule as
   `cancelled_by_trainer` with `cancelled_at = now()`; returns the number cancelled. Also
   `activate_rule(p_rule_id uuid) returns int` — trainer only; sets active and materializes
   that one rule (same loop, factor the per-rule body into a private helper
   `materialize_rule(p_rule_id, p_weeks)` that is NOT granted to anyone and is documented
   under Helpers).
5. View `public.slot_occupancy(slot_template_id, starts_at, booked_count)` — default
   `security_invoker = false` (runs as owner, so it sees all rows), counting appointments in
   (`booked`,`charged`) grouped by template and start, with `where (select
   public.current_customer_id()) is not null or (select public.is_trainer())`; grant select to
   `authenticated`. Test: a customer sees counts that include other customers' bookings but
   no identities; an unlinked user sees nothing.
6. pg_cron: `create extension if not exists pg_cron with schema pg_catalog;` (the hosted
   project needs the extension enabled; if `create extension` fails locally, document the
   dashboard step in the runbook instead and keep the schedules in the migration guarded by
   `if exists (select 1 from pg_extension where extname = 'pg_cron')`),
   `cron.schedule('charge_due_appointments', '*/15 * * * *', $$select
   public.charge_due_appointments()$$)` and `cron.schedule('materialize_recurring', '0 2 * *
   *', $$select public.materialize_recurring()$$)` — `cron.schedule` with a name is
   idempotent. Test: both jobs exist in `cron.job` with the expected schedules.
7. Tests cover: materialization creates exactly the expected number of instances for a rule
   over the window (derive from the generated dates), idempotency (second run → 0), blocked
   overlap skipped, capacity-full skipped, cancelled instance not recreated, inactive
   rule/template skipped, deactivate cancels only future booked instances and leaves charged
   ones, trainer-only on activate/deactivate, `authenticated` cannot execute
   `materialize_recurring` directly (test as a linked customer → `AMRAP_FORBIDDEN`; the
   trainer path succeeds), DST: a rule on a date across the 2026-10-25 change keeps the
   same wall-clock time.
8. Docs in the same commits: `docs/rpcs.md` (new RPCs + helper), `docs/schema.md`
   (migration list, new index, view), `docs/jobs.md` (both schedules, how cron
   authenticates, how to run the jobs by hand locally and on the hosted project),
   `docs/architecture/booking-sequence.md` (overlap), new
   `docs/architecture/materialization-sequence.md`, `data-model.md` (view + index),
   `CONTEXT.md` (materialization, rule activation). Regenerate `database.types.ts`.
   `scripts/check-docs.sh` must pass.

### Task 7: Customer screens — Home, Calendar, History

In `app/` (Stage 1 shell exists; see `docs/screens.md`, `app/src/routes.tsx`,
`app/src/test/fakeSupabase.ts`). All copy in `sl.ts`. Phone-first, plain CSS.

1. Data layer `app/src/data/`: typed query helpers over the Supabase client — slot templates
   (active), `slot_occupancy` for a date range, my appointments (upcoming / past), my ledger
   (`credit_transactions` ordered desc), `customer_balances` for me, `settings`
   (`late_cancel_hours`, `timezone`); RPC wrappers `book`, `cancel` with `fromError`. Keep
   these pure functions (client passed in) so tests use the fake.
2. `app/src/lib/time.ts`: helpers using `Intl`/`Temporal`-free date math for the gym
   timezone: week start (Monday), occurrences of a template in a week, formatting
   (`sl-SI`), cutoff time = `starts_at - late_cancel_hours h`.
3. Home `/c`: balance (red + "dolg" label when negative), next appointment (date, time,
   remaining time), upcoming list with per-item cancel (opens the cancel dialog).
4. Calendar `/c/koledar`: week view (prev/next week), each template occurrence shows start,
   duration, remaining capacity (`capacity - booked_count`), "Rezerviraj" when free capacity
   and in the future, "Polno" when full, blocked occurrences greyed out, my own booking marked
   with "Odpovej". Booking calls `book(my id, starts_at, template_id)`; errors via
   `fromError`.
5. Cancel dialog: shows the cutoff time and whether the cancel is free ("brezplačno") or
   late ("zaračunan 1 kredit") computed client-side from `settings.late_cancel_hours`; confirm
   calls `cancel`. Shows the server error if the state changed meanwhile.
6. History `/c/zgodovina`: past appointments with status labels (Slovenian), and the
   ledger as a readable list (type label, amount with sign, note, date).
7. Bottom nav already exists; wire the three routes.
8. Vitest with the fake client (extend `fakeSupabase.ts` with occupancy, templates,
   settings, ledger, rpc `book`/`cancel`): remaining capacity rendering, book button
   disabled when full/past/blocked, cancel dialog free vs late copy at ±1 min around the
   cutoff, negative balance styling, history ordering. Derive expectations from the fixture
   data.
9. Docs: `docs/screens.md` customer section (routes, data used, states), `README.md` if run
   steps change. Manual check against the local stack with `ana@amrap.local`.

### Task 8: Trainer screens — Today, Calendar, Customers, Settings; runbook update

In `app/`; reuse Task 7's data layer and calendar components (extend, don't duplicate).

1. Today `/t`: today's occurrences with booked customers (names), remaining capacity; a
   debtors strip (customers with negative balance, from `customer_balances` joined to
   `customers`).
2. Calendar `/t/koledar`: week view of all templates with occupancy and the list of booked
   customers per occurrence; actions: book a customer into an occurrence (`book` with the
   customer id), create an ad-hoc appointment (customer, start, end → `book` without a
   template), cancel any appointment (`cancel`; shows "s povračilom" when the appointment
   is charged).
3. Customers `/t/stranke`: list with balance (negative red) and invite status (derived:
   linked / pending / none); create customer (insert via RLS: name, phone, email); detail
   `/t/stranke/:id`: edit fields, ledger, top-up (`top_up`), adjustment (`adjust`, ± with
   note), upcoming appointments with cancel, "Ustvari povabilo" → `create_invite` → shows the
   full link `${location.origin}/invite/${token}` with a copy button, re-link hint pointing
   to the runbook. Recurring rules for this customer: list, add (pick a template) →
   `activate_rule` after insert, deactivate → `deactivate_rule`.
4. Settings `/t/nastavitve`: slot templates CRUD (weekday, start, duration, capacity,
   active); cutoff hours (`settings.late_cancel_hours`); blocked periods CRUD (start, end,
   reason). Inserts/updates/deletes go through RLS (trainer `for all`).
5. Tests with the fake: debtors strip derived from fixture balances, book-for-customer
   calls `book` with the chosen customer, cancel of a charged appointment shows the refund
   copy, invite link rendering, rule activate/deactivate calling the RPCs, template form
   validation (duration > 0, capacity > 0).
6. Docs in the same commits: `docs/screens.md` trainer section; `docs/runbook.md`: the
   "Invite a customer (Stage 1)" SQL recipe becomes a fallback note and the primary path is
   the Customers screen; `docs/architecture/auth-invite-flow.md` back to the UI step;
   `CONTEXT.md` if new terms appear. Manual check with `trainer@amrap.local`.

### Task 9: Comment sweep and layer docs

Owner feedback: too many explanatory comments in code. Sweep every file under `app/src/`,
`supabase/migrations/`, `supabase/seeds/` and `scripts/` and remove comments that explain
*what* the code does; keep only a non-obvious *why* (one line). Move the explanations into
layer docs: `docs/auth.md` (session loading, customer-row lookup, role gating, invite
acceptance, lookup-failed vs not-linked, keep-alive, start-up error), `docs/app-structure.md`
(folders, i18n rule, data layer contract, testing with the fake client), and extend
`docs/rpcs.md` / `docs/schema.md` / `docs/jobs.md` where a migration comment carried behaviour
not yet documented. Add the rule to `docs/harness.md` and a checklist item to
`.claude/agents/reviewer.md` ("no explanatory comments; behaviour documented in the layer doc").
No behaviour changes; all suites green; one or two commits.

---

## Stage 3 tasks

Branch `stage-3-notifications` off `main` (Stage 2 merged as #3). Design in ADR 0009; the
lasting rulings:
- A `notifications` log with a unique `(kind, appointment_id)` key is the dedupe: writers
  insert `on conflict do nothing returning id` and dispatch only returned ids. No config or no
  subscription → no row.
- Postgres decides and builds `data`; a private helper posts the ids to the edge function
  `send-push` with `net.http_post` (after commit, 10 s timeout). The function claims them
  through `claim_notifications(ids)` (sets `dispatched_at` once): at most once, never retried.
- Config = Vault rows `amrap_functions_url` and `amrap_push_secret`. Missing → `raise log`,
  return, no error. DB→function auth is the shared secret header `x-amrap-push-secret`;
  `send-push` has `verify_jwt = false`.
- Event notifications are triggers filtered by `source` / `status` / `type`; RPC bodies are not
  changed. Every trigger and helper body catches errors (`raise warning`) so a push problem
  never aborts the caller.
- The payload is `{kind, data, url}`; the service worker renders copy from `sl.ts`.
- Grants: the reminder job like `charge_due_appointments` (no grant to `authenticated`/`anon`),
  `claim_notifications` to `service_role` only, helpers and trigger functions to nobody.
- Edge function tests run with Deno 2.1.4 (the local edge runtime 1.74.3 is Deno 2.1.4
  compatible). Deno is not installed on this machine: run them with
  `docker run --rm -v "$PWD:/w" -w /w denoland/deno:2.1.4 deno test --allow-env supabase/functions`
  (wrapped by `scripts/test-functions.sh`, which uses a local `deno` when present). CI gets a
  `functions` job with `denoland/setup-deno` pinned to the same version.
- Pre-commit gate for every Stage 3 task (from the brief): app `npm run lint && npm run
  typecheck && npm test -- --run && npm run build`; DB `supabase test db`, `supabase db lint`,
  `bash scripts/check-docs.sh`, types diff; `bash scripts/test-functions.sh` once it exists.
- Owner actions known up front (one issue, filed by the orchestrator): generate the hosted
  VAPID pair, `supabase secrets set` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`, `PUSH_SECRET`), deploy `send-push` after merge, insert the two Vault rows,
  set `VITE_VAPID_PUBLIC_KEY` in Cloudflare Pages, test on a real Android phone and an iPhone
  (home-screen install). Exact steps land in `docs/runbook.md` (Tasks 12 and 14).

### Task 10: Notification log, dispatch and the pre-cutoff reminder job

New migration (`supabase migration new notifications_and_reminders`; `new-migration` skill),
TDD with pgTAP (`supabase/tests/030_notifications.sql`, `031_reminders.sql`, failing first).

1. `create extension if not exists pg_net with schema extensions` (not `public`; the Security
   Advisor flags that). Check it is enabled on the hosted project after `db push` (runbook).
2. Enum `notification_kind` (`cutoff_reminder`, `booking_created`, `booking_cancelled`,
   `credit_topup`, `credit_adjustment`). Table `notifications(id uuid pk, customer_id uuid
   not null references customers on delete cascade (the recipient), kind notification_kind
   not null, appointment_id uuid null references appointments on delete cascade,
   transaction_id uuid null references credit_transactions on delete cascade, data jsonb not
   null default '{}', created_at timestamptz not null default now(), dispatched_at
   timestamptz null)`, unique `(kind, appointment_id)` (nulls distinct, so credit rows never
   collide), index `(created_at)`. RLS on, no policy for `authenticated`, `revoke all` from
   `anon`/`authenticated`.
3. `public.push_config() returns table(functions_url text, push_secret text)` — security
   definer, stable, reads `vault.decrypted_secrets` names `amrap_functions_url` /
   `amrap_push_secret`; granted to nobody.
4. `public.dispatch_notifications(p_ids uuid[]) returns void` — granted to nobody. Empty array
   or missing config → `raise log`, return. Else one `net.http_post(url := functions_url ||
   '/send-push', body := jsonb_build_object('ids', p_ids), headers := Content-Type +
   x-amrap-push-secret, timeout_milliseconds := 10000)`. The whole body is wrapped in
   `begin … exception when others then raise warning …; end`.
5. `public.claim_notifications(p_ids uuid[]) returns table(notification_id uuid, kind
   notification_kind, data jsonb, endpoint text, p256dh text, auth text)` — security definer,
   granted to `service_role` only. `update notifications set dispatched_at = now() where id =
   any(p_ids) and dispatched_at is null returning …`, joined to the recipient's subscriptions
   through `customers.auth_user_id`. A second call with the same ids returns no rows.
6. `public.send_cutoff_reminders() returns int` — the 15-minute job. Missing config or
   missing `settings` → `raise log`, return 0 (cron never raises). Selects `booked`
   appointments whose cutoff `starts_at − late_cancel_hours * interval '1 hour'` is in
   `[now() + interval '45 minutes', now() + interval '75 minutes')`, whose customer is linked
   and has at least one `push_subscriptions` row; inserts one `cutoff_reminder` per
   appointment with `data = {appointment_id, starts_at, cutoff_at, timezone}` `on conflict
   (kind, appointment_id) do nothing returning id`; calls `dispatch_notifications` with the
   returned ids; deletes `notifications` older than 30 days; returns the number inserted.
   Grants like `charge_due_appointments` (owner and `service_role`).
7. `cron.schedule('send_cutoff_reminders', '*/15 * * * *', $$select
   public.send_cutoff_reminders()$$)`.
8. Local config: add the two Vault rows to a dev seed (`supabase/seeds/dev.sql`, or a new
   `seeds/push.sql` listed in `config.toml`) with `http://host.docker.internal:54321/functions/v1`
   and the placeholder secret `local-push-secret` (local only, like the seeded passwords).
   Tests never rely on the seed: they set or delete the Vault rows inside their transaction.
9. Tests (expected sets derived from the fixtures, times relative to `now()` and the
   cutoff from `settings`): cutoff at window start (45 min) selected, 44 min not, 74 min
   selected, 75 min not; `late_cancel_hours = 0`; not `booked` (cancelled, charged) skipped;
   unlinked customer and customer without subscription skipped; second run → 0 and still one
   row per appointment; a pre-existing row (simulating an overlapping run) → no second row and
   no second queue entry; with config a run queues exactly one `net.http_request_queue` row
   whose body holds the inserted ids and whose headers carry the secret; without config →
   returns 0, no rows, no queue entry, no error; missing settings → 0, no error;
   `claim_notifications` returns the subscriptions once and nothing on the second call;
   grants: `authenticated` cannot execute the job, `claim_notifications` or the helpers, and
   cannot read `notifications`; the cron job exists with its schedule; old rows pruned.
10. Docs in the same commits: `docs/schema.md` (migration, enum, table, grants, RLS),
    `docs/rpcs.md` (`claim_notifications`, `send_cutoff_reminders`, helpers `push_config`,
    `dispatch_notifications`), `docs/jobs.md` (the schedule, selection window, dedupe,
    no-op without config, manual run), new `docs/notifications.md` (layer doc: kinds and
    their `data`, the log, dedupe, dispatch, config, best effort; added to `docs/README.md`
    and the harness layer table), new `docs/architecture/push-sequence.md` (cron/trigger →
    log → pg_net after commit → `send-push` → claim → push service → 404/410 cleanup → SW),
    `data-model.md`, `system-context.md`, `CONTEXT.md` (notification, reminder, push
    subscription). Regenerate `database.types.ts`.

### Task 11: Event notifications and the subscription RPC

New migration (`supabase migration new event_notifications`), TDD
(`supabase/tests/032_event_notifications.sql`).

1. `public.enqueue_notification(p_customer_id uuid, p_kind notification_kind, p_data jsonb,
   p_appointment_id uuid default null, p_transaction_id uuid default null) returns void` —
   granted to nobody. No config, or the recipient has no linked user or no subscription →
   return. Else insert `on conflict do nothing returning id` and `dispatch_notifications`.
   Wrapped in `begin … exception when others then raise warning; end`.
2. Trigger functions (security definer, granted to nobody) and triggers:
   - `after insert on appointments for each row when (new.source = 'self_booked')` → the
     trainer (`customers where role = 'trainer'`), `booking_created`, data `{customer_name,
     starts_at, timezone}`.
   - `after update of status on appointments for each row when (old.status = 'booked' and
     new.status in ('cancelled', 'cancelled_late'))` → the trainer, `booking_cancelled`,
     data `{customer_name, starts_at, late, timezone}`.
   - `after insert on credit_transactions for each row when (new.type in ('topup',
     'adjustment'))` → the customer, `credit_topup` / `credit_adjustment`, data `{amount,
     note, balance}` (balance from `customer_balances` after the insert).
3. `public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void`
   — linked customer or trainer only (`AMRAP_FORBIDDEN` otherwise); arguments required
   (`AMRAP_INVALID_ARGUMENT`); deletes any row with that endpoint, inserts it for
   `auth.uid()`. Granted to `authenticated`. Deleting stays a plain RLS delete of own rows.
4. Tests: a customer `book()` creates one `booking_created` row for the trainer and queues one
   request; a trainer `book()` and `materialize_recurring()` create none; a customer cancel
   (free and late) creates `booking_cancelled` with the right `late`; a trainer cancel and
   `charge_due_appointments()` create none; `top_up` / `adjust` create the customer row with
   the derived balance; refunds and charges create none; recipient without subscription or
   link → no row; without config → no row, the RPC still succeeds; **best effort**: inside the
   test transaction replace `dispatch_notifications` with a body that raises, then `book`,
   `cancel` and `top_up` still succeed and their rows exist; `save_push_subscription` moves an
   endpoint from one user to another, rejects an unlinked user and `anon`.
5. Docs: `docs/rpcs.md` (new functions, `AMRAP_*` reuse), `docs/schema.md` (migration,
   triggers), `docs/notifications.md` (event kinds and filters), `push-sequence.md` (trigger
   lane), `booking-sequence.md` / `charging-sequence.md` if they show the side effect. Types.

### Task 12: Edge function `send-push`, Deno tests, CI

1. `supabase/functions/send-push/` with `deno.json` (imports pinned: `npm:web-push@3.6.7`,
   `npm:@supabase/supabase-js@2.118.0`), `index.ts` (wiring only: env, client, `Deno.serve`),
   and small pure modules with injected dependencies so tests need no network:
   - `payload.ts`: `buildPush(row, now)` → `{body: JSON {kind, data, url}, ttl, urgency,
     topic?}`. URLs: reminder and credit kinds → customer routes (`/c`, `/c/zgodovina`),
     booking kinds → `/t`. Reminder TTL = seconds until `data.cutoff_at` (≥ 0), urgency
     `high`, topic derived from the appointment id (≤ 32 base64url chars); others TTL 86400,
     `normal`.
   - `handler.ts`: `handle(req, deps)` — 405 for non-POST; 401 when `x-amrap-push-secret`
     differs from `PUSH_SECRET` (constant-time compare); 503 with a log when VAPID secrets are
     missing; 400 for a body without an `ids` array; else `claim_notifications(ids)`, send each
     row's push, collect endpoints that returned 404/410 and delete them from
     `push_subscriptions` in one call; other send errors logged, never thrown; responds
     `{claimed, sent, failed, removed}`.
2. `supabase/config.toml`: `[functions.send-push] verify_jwt = false`.
   `supabase/functions/.env.example` (committed): `PUSH_SECRET=local-push-secret` (matches
   the seed), empty `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:…`, with
   the generation command (`npx web-push generate-vapid-keys`). `supabase/functions/.env`
   stays ignored (already covered by `.env` / `.env.*` in `.gitignore`; verify).
3. Deno tests `supabase/functions/send-push/*_test.ts`: payload per kind (url, TTL, urgency,
   topic, TTL never negative); handler 401 / 405 / 400 / 503; a fake sender rejecting with
   status 404 and 410 deletes exactly those endpoints; 500 or a network error keeps the
   subscription and still sends the others; nothing claimed → no sends.
   `scripts/test-functions.sh` (local `deno` or the pinned Docker image).
4. CI: new job `functions` (`denoland/setup-deno@v2`, `deno-version: 2.1.4`, `deno test
   --allow-env supabase/functions`); the `db` job keeps `-x …,edge-runtime`. Update the CI
   table in `docs/harness.md`.
5. Verify locally whether `supabase start` serves `supabase/functions/*` without a separate
   `supabase functions serve` (the CLI only listed it under `serve` in the Task 0 spike);
   document the working command. Check from the db container that pg_net reaches
   `host.docker.internal:54321` (`net._http_response` after a dispatch).
6. Docs: `docs/jobs.md` edge-function section (endpoint, auth, request/response, secrets,
   404/410), `docs/notifications.md` (payload contract and TTL/urgency), `docs/runbook.md`
   (hosted: generate VAPID pair, `supabase secrets set …`, `supabase functions deploy
   send-push` from `main` after merge, Vault inserts in the SQL editor, in that order, plus how
   to check `net._http_response` and the function logs), `README.md` local run steps.

### Task 13: App — service worker push handler and subscription UI

1. vite-plugin-pwa → `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`;
   add `workbox-precaching` (and `workbox-core` for `clientsClaim`) at versions matching the
   plugin. `src/sw.ts`: `precacheAndRoute(self.__WB_MANIFEST)`, `skipWaiting` + `clientsClaim`
   (keeps `autoUpdate` behaviour), `push` → parse `{kind, data, url}`, render title/body with
   a pure `renderNotification(kind, data)` in `src/push/render.ts` using `sl.push.*` and
   `lib/time.ts` formatting in `data.timezone`, `showNotification` with `tag` per appointment
   (a newer reminder replaces an older one); unknown kind → generic copy; `notificationclick`
   → focus an open client and navigate it to `url`, else `clients.openWindow(url)`. Typecheck
   the SW with the `webworker` lib (own tsconfig or reference), check the build still emits
   the manifest and the SW, and that the dev server still runs.
2. `src/push/`: `support.ts` (`pushSupport()` → `supported | needs-install` (iOS Safari not
   standalone) `| unsupported | no-key` (no `VITE_VAPID_PUBLIC_KEY`)), `subscribe.ts`
   (`enablePush(client)`: permission → `pushManager.subscribe({userVisibleOnly: true,
   applicationServerKey})` → `save_push_subscription`; `disablePush(client)`: unsubscribe +
   delete own row by endpoint; `currentSubscription()` via `navigator.serviceWorker.ready`,
   guarded so Vitest and browsers without SW do not throw). Data wrapper in `src/data/`.
3. `PushToggle` component (shared): state line (on / off / blocked by the browser /
   install hint / unavailable), on/off button, errors via `fromError`. Placed on customer
   Home and trainer Settings. `/logout` calls `disablePush` best effort before signing out.
4. `sl.ts`: `push.*` notification copy per kind (reminder with time and cutoff, booking
   created/cancelled with name, late flag, top-up/adjustment with amount and balance) and
   `pushToggle.*` UI copy; `app/.env.example` gains `VITE_VAPID_PUBLIC_KEY=` with a note.
5. Vitest: `renderNotification` per kind (derived from fixture data, DST date), support
   detection matrix, `enablePush` calls the RPC with the subscription keys, permission denied
   path, toggle states, logout removes the subscription; extend `fakeSupabase.ts` with
   `push_subscriptions` and `save_push_subscription`.
6. Docs: `docs/screens.md` (toggle on both screens, strings), `docs/notifications.md` (SW
   rendering, click handling, subscription lifecycle, iOS), `docs/app-structure.md`
   (`src/push/`, `sw.ts`), `docs/data-layer.md`, `docs/runbook.md` Cloudflare env var
   `VITE_VAPID_PUBLIC_KEY`.

### Task 14: Keep-alive, runbook, end-to-end check

1. Keep-alive: confirm `keepAlive()` runs once per signed-in load (existing test in
   `keepAlive.test.ts` / auth tests; add one if the "once per user, not on token refresh"
   rule is not covered) and that docs match.
2. `docs/runbook.md` unpause section: verify against current Supabase docs (Context7) and
   extend: after a restore check `cron.job` and the last `cron.job_run_details`, the Vault rows
   and the function secrets survive, run `select public.charge_due_appointments();` and
   `select public.materialize_recurring();` once to catch up, reminders missed during the
   pause are not sent afterwards (their window has passed).
3. Manual check against the local stack in a desktop browser (Chrome): VAPID pair in
   `supabase/functions/.env` and `app/.env.local`, enable push as `ana@amrap.local` and as the
   trainer, then (a) a fixture appointment with its cutoff ~1 h away + `select
   public.send_cutoff_reminders();` → reminder shown, second call → nothing; (b) ana books in
   the app → trainer notification; (c) trainer top-up → ana notification; (d) a stale
   subscription (unsubscribed in the browser) is deleted after the next send. Record the
   results in the task report.
4. Stage 3 status, Handoff state, `docs/README.md` index. Owner actions consolidated
   (hosted secrets, deploy, Vault rows, Pages variable, real phones).

## Stage 4 tasks

Branch `stage-4-pilot` off `main` (Stage 3 merged as #4). Rulings proposed for this stage
(the orchestrator approves or corrects them before Task 15):
- **No DB change.** Nothing below needs a migration. If one turns out to be needed, stop and
  report before writing it (then the `new-migration` skill applies). Pre-commit gate for an app
  commit: `npm run lint && npm run typecheck && npm test -- --run && npm run build` in `app/`,
  plus `bash scripts/check-docs.sh`; a docs-only commit runs `check-docs.sh`. The DB gate
  (`supabase test db`, `supabase db lint`, types diff, `scripts/test-functions.sh`) runs once
  per task anyway, since the local stack is up for the browser check.
- **Form of address: formal "vi".** Every existing message already uses it ("boste",
  "Preverite", "Obrnite se", "Vpišite"). Buttons keep the short imperative/infinitive style they
  have now ("Rezerviraj", "Kopiraj", "Poskusi znova"); whether buttons should be formal too
  ("Poskusite znova") goes into the copy review as a question, not a change.
- **Plurals.** A `Plural = { one, two, few, other }` type and `plural(forms, n)` in
  `i18n/fill.ts` using `Intl.PluralRules('sl')` (`one` 1, 101; `two` 2, 102; `few` 3-4, 103-104;
  `other` 0, 5-100), each form a `fill` template with `{count}`. Only strings that put a noun
  after a count need it. Today that is `settings.templateLine` (`{capacity} mest` is wrong for
  1-4: "1 mesto, 2 mesti, 3 mesta, 5 mest"); the others sidestep it with a label and colon
  ("Novih terminov: {count}", "Prosta mesta: {free} od {capacity}"), abbreviations
  (`{minutes} min`, `time.*`) or fixed numbers ("1 kredit", "zadnjih 30 dni"). New strings that
  count something (install card, starting balances) use `plural`.
- **Install card is one shared component in `AppShell`,** so both roles see it on every screen
  until it is dismissed or the app runs standalone, including the first screen after
  `accept_invite` (which navigates to `/`, then `/c`). It reuses `PushEnvironment` (`ios`,
  `standalone`) from `push/browser.ts` and adds only an `android` flag beside them. On iOS,
  `PushToggle`'s `needs-install` state points at the card while it is showing instead of
  repeating the steps (Task 15 item 3).
- **Dismissal is per device in `localStorage`** (key `amrap.install.dismissed`), every access in
  try/catch; storage that throws or is empty means "not dismissed" and the card still works.
  This is a per-device convenience, not state that must survive.
- **Copy review lifecycle** (Task 16 review): `docs/copy-review.md` mirrors `sl.ts` by hand
  until the trainer signs it off. Until then every commit that changes `sl.ts` updates its
  rows in the same commit (Tasks 17 and 18 included). The sign-off commit applies the answers
  to `sl.ts`, moves lasting decisions into `docs/app-structure.md` (i18n rule) and deletes
  `copy-review.md` with its README entry and every mention: `.claude/agents/reviewer.md` item 5
  and the reviewer gate in `docs/harness.md`.
- **Starting balances from the paper sheet** are ledger rows with a fixed note
  (`sl.customerDetail.startingNote`, "Začetno stanje (papir)"): a positive balance is a top-up,
  a negative one an adjustment (`top_up` rejects ≤ 0), zero needs nothing. No bulk import: the
  gym has a few dozen customers at most.
- **Owner actions known up front** (the orchestrator files them): the trainer signs off
  `docs/copy-review.md`; real-phone install checks (Android Chrome prompt, iPhone Safari Add to
  Home Screen, then push from the installed app); the trial week itself. The pilot also depends
  on Stage 3 owner actions 1-8 (hosted push turned on and checked on a phone): without them
  there are no reminders, and the reminder is the customer's only warning before a charge.
- Browser checks use `agent-browser` with headless Google Chrome at 360×800 against the local
  stack and a production build (`npm run build && npm run preview`), as in Stage 3. Headless
  Chrome will probably never fire `beforeinstallprompt` (it needs an engagement heuristic and a
  real install surface), so the prompt path is covered by unit tests and an injected event, and
  the real prompt is an owner action. This worktree is the only one running the local stack;
  `supabase stop` at the end of each task that started it.

### Task 15: Install onboarding

1. `src/install/`:
   - `capture.ts`: `listenForInstallPrompt(win)` registers `beforeinstallprompt`
     (`preventDefault()`, keep the event) and `appinstalled` (drop the event, remember
     "installed") at module load, called from `main.tsx` before React mounts, because Chrome can
     fire the event before the first render. A tiny store with `subscribe` / `snapshot` so the
     card re-renders when the event arrives (`useSyncExternalStore`). `BeforeInstallPromptEvent`
     is not in `lib.dom`: declare the type locally (`prompt()`, `userChoice`).
   - `mode.ts`: pure `installMode({ standalone, ios, installed, hasPrompt, android })` →
     `hidden` (standalone or installed) `| prompt` (a captured event) `| ios` (iOS, not
     standalone) `| android-manual` (Android, no event: browser menu instructions) `| none`
     (desktop or other browsers without an event: show nothing).
   - `dismissed.ts`: `isInstallDismissed(storage)` / `dismissInstall(storage)`, try/catch around
     every `localStorage` access.
   - `installPlatform` object (environment, prompt store, storage) with a fake in
     `src/test/fakeInstall.ts`, injected like `fakePush.ts`.
2. `pages/shared/InstallCard.tsx` in `AppShell` above `<Outlet />`: title, one line on why
   (reminders arrive only with notifications on; on iPhone only from the installed app), then
   per mode: **Namesti aplikacijo** (calls `prompt()`, then hides on `accepted`, keeps the card
   on `dismissed` but drops the used event), the iOS steps (Safari: **Deli** → **Dodaj na
   začetni zaslon** → open AMRAP from the home screen, with a note that other iOS browsers use
   the same Share menu), or the Android menu steps (⋮ → **Namesti aplikacijo** / **Dodaj na
   začetni zaslon**). **Ne zdaj** dismisses it on this device. A `region` with a heading so
   screen readers can find and skip it.
3. `PushToggle` `needs-install`: while the install card is showing, the toggle says only that
   notifications need the installed app and that the steps are in the card
   (`pushToggle.needsInstallSeeCard`); once the card is dismissed, the toggle shows the current
   one-sentence steps (`pushToggle.needsInstall`), so iOS users always have the steps exactly
   once on screen. Both paths tested.
4. `sl.ts`: `install.*` (title, why, button, not now, iOS steps, Android steps, installed).
5. Vitest: `installMode` matrix (standalone, installed, event present/absent, iOS, Android,
   desktop); `capture` keeps the event, calls `preventDefault`, clears it on `appinstalled`;
   `dismissed` with working, empty and throwing storage; the card: hidden when standalone or
   dismissed, **Namesti aplikacijo** calls `prompt()` and hides on `accepted`, **Ne zdaj**
   persists and hides, an event arriving after mount shows the button; routes test: the card
   is on `/c` right after an invite sign-up and on `/t`; `PushToggle` `needs-install` copy in
   both cases.
6. Docs: `docs/screens.md` (new "Install card" section, `install` in the Strings column of `/c`
   and `/t`, shared behaviour), `docs/app-structure.md` (`src/install/`, `fakeInstall.ts`),
   `docs/notifications.md` (iOS: install first, link to the card), `docs/auth.md` if the invite
   section mentions the first screen.
7. Browser check at 360×800 (production build): the card on `/c` after a fresh invite sign-up
   and on `/t`; **Ne zdaj** survives a reload; an iOS user agent (`agent-browser` UA override)
   shows the iOS steps and the shortened toggle line; a dispatched synthetic
   `beforeinstallprompt` (DevTools `Runtime.evaluate` before load) shows the button. Not
   verifiable here: the real Chrome prompt and real iOS standalone mode (owner action).

### Task 16: Slovenian copy pass and plurals

1. `plural(forms, n)` and the `Plural` type (ruling above); `settings.templateLine` split so
   the capacity uses `settings.places` (`{count} mesto / mesti / mesta / mest`). Any other
   string the pass rewrites to put a noun after a count uses `plural` too (for example the push
   top-up body "Dodani so 3 krediti", if the pass changes it; the service worker shares
   `sl.ts`, so `push/render.ts` uses the same helper).
2. Review every key in `sl.ts` against `CONTEXT.md` and fix what is clearly wrong: grammar,
   case after prepositions, formal "vi" in messages, one term per concept (termin vs vadba vs
   rezervacija, kredit, polnitev vs nakup, odpoved, rok za brezplačno odpoved, stalni termin,
   zaprto obdobje), punctuation (`…` with a space, en dash ranges, `»«` quotes), and no English
   in user-visible copy (`customerDetail.relinkHint` names `docs/runbook.md` and an English
   section title: replace with plain Slovenian, the runbook link stays in the docs).
3. Dates and times: confirm `formatDay` / `formatLongDay` / `formatDate` output against
   Slovenian conventions (`pon., 26. 10.`, `ponedeljek, 26. oktober`, `26. 10. 2026`, 24-hour
   `07:00`) and the "{day} ob {time}" pattern; fix only clear errors (tests in `time.test.ts`
   already pin the outputs, update them with the change).
4. `docs/copy-review.md` (new, English frame, Slovenian copy): screen by screen (login, invite,
   state pages, customer Home / Calendar / History / cancel dialog, trainer Today / Calendar /
   Customers / detail / Settings, notifications and their toggle, install card, errors), a table
   per screen `key → current text → question` (empty when there is none), the changes this task
   made (old → new), and an open-questions list for the trainer: formal "vi" vs informal "ti";
   gendered `customers.inviteStatus` (`Povezan račun` / `Povabljen` for women); `Vadba` vs
   `Termin` for the session ledger row; `Opravljeno` for a charged appointment the customer did
   not attend; `Pozna odpoved` wording; whether buttons stay infinitive-style. How to answer
   (comment per row or a marked-up copy) and that sign-off is the trainer's (owner action).
5. Tests: `sl.test.ts` checks every `Plural` object has four non-empty forms and that each
   form contains `{count}`; `fill.test.ts` `plural` for 1, 2, 3, 4, 5, 0, 101, 102, 103, 105
   (expected forms derived from `Intl.PluralRules`, not hardcoded categories); screen tests that
   assert on changed copy read it from `t`, so only tests with literal strings change.
6. Docs: `docs/app-structure.md` i18n rule (plurals, form of address), `docs/time.md` if the
   formats change, `docs/screens.md` for renamed keys or changed quoted copy, `docs/README.md`
   index entry for `copy-review.md`.

### Task 17: UI polish and accessibility at phone width

1. Run the `web-design-guidelines` skill over `app/src/pages/**`, `AppShell`, `styles.css` and
   `index.html`; write the findings into the task report with a fix / won't-fix decision each.
2. Accessibility basics on every customer and trainer screen, including login, invite and the
   state pages: every input has a visible label; visible `:focus-visible` outlines; colour
   contrast ≥ 4.5:1 for text (check the teal, the red debt colour and greyed rows against their
   backgrounds, numbers in the report); tap targets ≥ 44 × 44 px (bottom nav links, **Odpovej**,
   `‹` / `›`, inline **Uredi** / **Izbriši**, the copy button, the card's buttons); errors in
   `role="alert"`, results in `role="status"`; dialog focus return; `prefers-reduced-motion` if
   anything animates; safe-area insets for the fixed bottom bar (`viewport-fit=cover` is set).
3. Layout at 360 × 800: no horizontal scroll on any screen (long names, long notes, the
   invite link field, week range, settings forms); the fixed bottom nav never covers the last
   item; inputs at least 16 px so iOS does not zoom on focus; numeric inputs use
   `inputmode="numeric"`.
4. Fix the findings that matter for a phone-first pilot, plain CSS only, no new dependency. A
   change to markup that tests assert on updates those tests; no new copy outside `sl.ts`.
5. Browser check at 360 × 800 on every route as ana and as the trainer (screenshots kept in
   the scratchpad, not committed): `document.documentElement.scrollWidth <= 360` per route,
   keyboard tab order through each screen, tap-target sizes measured with
   `getBoundingClientRect`. Record verified vs not.
6. Docs: `docs/screens.md` "Behaviour shared by all screens" gains the accessibility and layout
   rules the app now follows (so later screens keep them); `docs/harness.md` reviewer checklist
   item if a rule is worth enforcing (for example "tap targets ≥ 44 px, no horizontal scroll at
   360 px"); `.claude/agents/reviewer.md` likewise.

### Task 18: Pilot guide, starting balances, release checklist skill

1. Starting balance on **Nova stranka** (`/t/stranke`): an optional whole-number field
   `customers.startingBalance` ("Začetno stanje kreditov (s papirja)"). After `createCustomer`
   succeeds: a positive value calls `top_up`, a negative one `adjust`, both with
   `customerDetail.startingNote`; empty or 0 does nothing. If the credit call fails, the detail
   page opens anyway and shows the error, so nothing is created twice (the trainer enters it in
   **Krediti** there). Also prefill the note field on the customer detail with `startingNote`
   while the customer's ledger is empty. Vitest: positive → one `topup` row with the note,
   negative → one `adjustment`, 0 / empty → none, invalid input → `customers.startingInvalid`,
   credit failure → detail page with the error and the customer created once. Docs:
   `docs/screens.md` (Customers and detail), `docs/data-layer.md` if a wrapper is added.
   If the orchestrator prefers no UI change here, drop this item and keep only the note
   convention in the pilot guide.
2. `docs/pilot.md` (English frame, trainer-facing steps in Slovenian):
   - **Before day one (owner):** Stage 3 owner actions 1-8 done (push on, checked on a phone),
     Pages deploy of `main`, trainer account bootstrapped (runbook), the trainer's phone has the
     app installed with notifications on.
   - **First-day setup (trainer, Slovenian):** cutoff hours, slot templates (weekday, time,
     duration, capacity), blocked periods already known, each customer from the paper sheet
     (name, phone, starting balance with the note convention: top-up for positive, adjustment
     for negative, nothing for zero), recurring rules per customer (and how many instances that
     created), an invite per customer who will use the app (copy the link, send it by text, it
     expires in 7 days and a new one replaces the old), customers without the app stay on
     trainer-managed bookings.
   - **What customers do (Slovenian, forwardable text):** open the invite link, create the
     account, install on the home screen (install card), turn on notifications, book / cancel,
     the cutoff rule and the reminder.
   - **During the trial week:** daily checklist (Today's debtors strip, today's roster vs who
     came, late cancels, any "Termini zunaj urnika"), what to watch on the owner side (charges
     appearing at session start: `cron.job_run_details` for `charge_due_appointments`; reminders
     and pushes: `notifications` and `net._http_response`; the keep-alive and the pause risk),
     how to fix mistakes (trainer cancel with refund, adjustment with a note, waiving a late
     cancel with +1), and the paper sheet kept in parallel for the first days only as a backup.
   - **Reporting problems:** what to send (screen, time, customer, what was expected,
     screenshot) and to whom; the owner's triage pointers into the runbook.
   - **End of the week:** the success criterion (a full week without the paper sheet), the
     questions to answer (copy sign-off, open product questions), and where the results are
     recorded.
3. `.claude/skills/release-checklist/SKILL.md` (frontmatter `name: release-checklist`,
   `description`): the post-merge release from `main` only: confirm the merge and CI on `main`
   (`git fetch`, `git checkout main && git pull`); `supabase db push` (list the migrations it
   will apply first, `supabase migration list`); verify in the SQL editor: migrations listed,
   `cron.job` schedules, pg_net in `extensions`, any objects the release added; `supabase
   functions deploy send-push --no-verify-jwt` only when `supabase/functions/` changed in the
   range; Cloudflare Pages production deploy of the merge commit finished and serving (the
   built `sw.js` changed, the app loads); smoke test both roles on a phone or at phone width
   (sign in, a booking and a cancel as a test customer, a top-up of +1 and an adjustment of -1
   by the trainer, notifications received); record the release (date, merge commit, migrations,
   function deployed or not, smoke result) in the stage's PR or issue. It repeats per stage
   (three post-merge `db push` runs so far), which satisfies the "second time" rule. No separate
   `deploy-functions` skill: deploying `send-push` is one step of this checklist and of the
   runbook, not a task on its own.
4. Docs: `docs/harness.md` Skills table (`release-checklist`) and the skill rule's candidate
   list; `docs/runbook.md` "Deploy migrations after merge" points to the skill; `docs/README.md`
   index gains `pilot.md`.

### Task 19: Stage 4 close: end-to-end check, handoff, owner actions

1. Browser end-to-end at 360 × 800 on a fresh `supabase db reset` and a production build,
   following `docs/pilot.md` literally: the trainer sets up a template, a customer with a
   starting balance, a recurring rule and an invite; the customer signs up from the link, sees
   the install card, enables notifications, books and cancels (free and late); the trainer sees
   the booking, tops up, cancels with refund; the charge job and the reminder job run by hand
   (`select public.charge_due_appointments();`, `select public.send_cutoff_reminders();`) with
   fixture times. Record verified vs not; anything the guide gets wrong is fixed in the guide.
2. `IMPLEMENTATION_PLAN.md`: Handoff state, Stage 4 status "Complete (PR open; trial week
   pending)"; the file stays (the trial week is open).
3. Consolidated "Stage 4 owner actions": copy sign-off; Android and iPhone install and push from
   the installed app; on the trainer's phone, that the customer and blocked-period forms do not
   offer the trainer's own name, phone or email (autofill is turned off best effort); on an
   iPhone, that the page behind the open cancel dialog does not scroll; the trial
   week with the pilot guide; Stage 3 owner actions still open.
4. Open product questions for the owner (not decided here): should a trainer cancel notify the
   customer; does the trainer want a veto over self-bookings (`PLAN.md` open question 1); should
   adding a blocked period cancel the live bookings inside it (`cancelled_by_trainer`, refund if
   charged) instead of only warning; any copy question the trainer leaves open.
5. `supabase stop`.

## UI refresh (Stages 5-7, from 2026-10-24)

The owner tested the app on a laptop and found it hard to use: the bottom navigation looks
odd on a wide screen, Nastavitve puts everything on one page, and the spacing is off in many
places. An audit at 1440, 768 and 390 px with demo data confirmed it; the findings are the
Stage 5 tasks. Owner rulings (2026-10-24): responsive navigation (top bar from tablet width,
bottom tabs on phones); sub-tabs in Nastavitve and every "new X" form on demand; black, white
and grey with red only for debt and late cancel and a muted green only for "opravljeno" and
added credits; light by default following the system, with a switch; three stacked PRs.

PRs stay open for the owner to look at (this is visual work); they merge in order.

### Design system

**Colour.** From the logo (white on black, grey tagline). Pure black is the brand ink; no
tinted near-black stands in for it.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#ffffff` | `#000000` | page background, top bar, dialog |
| `--surface` | `#f3f3f3` | `#161616` | quiet panels, secondary buttons, open forms |
| `--ink` | `#000000` | `#ffffff` | headings, primary buttons (text in `--paper`), active nav, the frame |
| `--text` | `#1c1c1c` | `#ededed` | body text |
| `--muted` | `#5f5f5f` | `#a3a3a3` | secondary text, greyed rows (≥ 4.5:1 on paper and surface) |
| `--line` | `#dcdcdc` | `#2b2b2b` | row dividers, card edges |
| `--control-line` | `#858585` | `#737373` | input and select borders (≥ 3:1) |
| `--debt` / `--debt-bg` | `#c01b2c` / `#fdecee` | `#ff7a7a` / `#3a1418` | negative balance, debt, late cancel, destructive buttons |
| `--done` / `--done-bg` | `#1d7a46` / `#e5f3ea` | `#62c98d` / `#10291b` | opravljeno, added credits, saved notices |

**Type.** One family: Archivo (variable, `wdth` 62-125 and `wght`), self-hosted from
`@fontsource-variable/archivo` so it works offline and has č, š, ž. Display: width 75,
weight 800, sentence case, for page titles, the balance number and slot times; it echoes the
heavy condensed wordmark. Body: width 100, weight 400, 600 for emphasis. Scale: 0.8125,
0.875, 1, 1.25, 1.75 rem (h1 2 rem from 768 px), balance 3.5 rem. Tabular figures for
numbers and times. No all-caps labels, no letter-spaced eyebrows.

**Shape.** The logo's rectangular frame (2 px `--ink`, square corners) is the one strong
element: the wordmark in the top bar and the balance on customer Home and customer detail.
Everything else is quiet: controls and panels 6 px radius, no shadows except the dialog, no
gradients.

**Layout.** Content column `--content` 46 rem, the top bar uses the same column so its left
edge lines up with the page. Spacing scale 4/8/12/16/24/32/48 px (`--space-1..7`); sections
are separated by `--space-6` and their headings sit `--space-3` above their content. Text is
left aligned; row actions align right.

```
 ≥ 768 px                                          < 768 px
 ┌[AMRAP]  Danes  Koledar  Stranke  Nastavitve   (•)┐   ┌[AMRAP]                (•)┐
 │──────                                            │   │ Nastavitve                │
 │ Nastavitve                                       │   │ Urnik  Odpoved  Zaprto …  │
 │ Urnik   Odpoved   Zaprta obdobja   Obvestila     │   │ …                         │
 │ ─────                                            │   │                           │
 │ pon 07:00   60 min · 5 mest              Uredi   │   ├───────────────────────────┤
 │ …                               [+ Nov termin]   │   │ Danes Koledar Stranke Nas │
 └──────────────────────────────────────────────────┘   └───────────────────────────┘
 (•) account menu: Videz (Sistem / Svetlo / Temno), Odjava
```

### Stage 5 tasks

Each item was seen in the 2026-10-24 audit. Keep the current colours; Stage 6 replaces them.

1. `.back-link` ("Nazaj na stranke") shows the browser's default blue: give links a defined
   colour.
2. A balance of `0` is coloured like a positive balance on Stranke (and anywhere `.amount`
   is used): zero is neutral.
3. Customer detail, "Opravljeni termini": charged sessions have **Odpovej**, but the action
   cancels with a refund. Give it its own label (for example **Vrni kredit**), add it to
   `sl.ts` and `docs/copy-review.md`.
4. Debtor chips on Danes show `-3` with a hyphen; the ledger shows `−1` (U+2212). Use one
   signed-number formatter for both.
5. The cancel dialog is a bottom sheet at every width. From 768 px: centred, all corners
   rounded, a margin from the edges. Phone stays a bottom sheet.
6. Disabled buttons look like faded primary buttons, so a slot with free places looks the
   same as a full one (every **Dodaj** in the trainer calendar is disabled until a customer is
   picked). Disabled = neutral (surface background, muted text, no opacity).
7. Week navigation: the disabled `‹` looks the same as the enabled `›`.
8. Sign-in: the page says "Prijava" twice (heading and button). Keep the heading; the
   button says **Prijavi se**. Check the invite page for the same.
9. Calendar rows at 390 px wrap "Prosta mesta: 5 od 5" in the middle; keep duration and
   places as unbreakable parts that wrap between each other, not inside.
10. Blocked periods at 390 px stack **Uredi** and **Izbriši** vertically, out of line with the
    text; keep row actions on one line and let the text wrap.
11. Template rows: the "neaktiven" tag floats in the middle of the row; it belongs next to
    the text.
12. Balance card (customer detail): the account tag sits beside the big number at its
    mid-height; put it on the label line.
13. Stranke: "Povezan račun" is the normal end state; show a tag only for "Brez računa" and
    "Povabilo čaka".
14. Spacing: introduce the spacing scale from "Design system" and use it for section gaps,
    heading gaps, list and card margins (today `.list` ends 1.5 rem, `.card` 1 rem, `h1`→`h2`
    has no gap on Nastavitve); one rule for submit buttons (full width below 480 px, natural
    width above) instead of a mix per form.
15. `docs/screens.md`: update the shared behaviour section and every screen whose labels or
    states changed.

### Stage 6 tasks

1. Tokens from "Design system" on `:root`; dark values under
   `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])` and under
   `:root[data-theme="dark"]`; `color-scheme` follows. Replace every hardcoded colour
   (`#ccfbf1`, `#fee2e2`, `#ffffff` on buttons, the overlay) with tokens.
2. Theme preference per device: `amrap.theme` = `system | light | dark` in localStorage,
   every access in try/catch (like `install/flags.ts`); applied to `<html data-theme>` by a
   small inline script in `index.html` before first paint, and by the app when it changes.
3. Account menu in the top bar (both roles): a button that opens a small menu with
   "Videz" (Sistem / Svetlo / Temno, a radio group) and **Odjava** (replaces the bare sign-out
   link). Keyboard: opens with Enter/Space, Escape closes, focus returns to the button.
4. Logo: crop the framed wordmark from `app/public/logo.png` with `sips` (no new tools) into
   `public/brand-mark.png` (white on black). Light theme shows it with `filter: invert(1)`
   on `--paper` white; dark shows it as is. Top bar and sign-in/invite pages; alt text
   "AMRAP" from `sl.ts`.
5. PWA icons: replace the placeholder "A" with the framed wordmark on black, inside the
   maskable safe zone (`sips` crop + pad); `theme_color` / `background_color` in
   `vite.config.ts` and `<meta name="theme-color">` (one per colour scheme) to the new
   paper and ink. Retire or rewrite `scripts/generate-icons.mjs` and its docs.
6. Archivo via `@fontsource-variable/archivo` (pinned), Latin and Latin Extended only;
   precached by the service worker.
7. Type scale, display treatment and the frame on the balance per "Design system".
8. ADR 0010 "Visual identity and themes" (palette from the logo, two themes, one typeface,
   no new image tools) and its README index row; `docs/app-structure.md` (theme store,
   assets) and `docs/screens.md` (contrast values in the shared rules, account menu).

### Stage 7 tasks

1. Top-bar navigation from 768 px: wordmark, nav links, account menu on one line; active
   link marked with a 2 px `--ink` underline; the bottom bar is hidden from 768 px and the
   page bottom padding follows. Below 768 px: bottom tabs as today, restyled to the tokens,
   active tab marked by a bar on top.
2. Nastavitve sub-routes: `/t/nastavitve/urnik` (slot templates), `/t/nastavitve/odpoved`
   (cutoff), `/t/nastavitve/zaprto` (blocked periods), `/t/nastavitve/obvestila`
   (notifications); `/t/nastavitve` redirects to `urnik`; sub-tabs as a nav under the title.
3. Forms on demand: **Nov termin** (templates), **Novo zaprto obdobje**, **Nova stranka**
   (a button in the Stranke page header), **Nov termin po dogovoru** (calendar), **Dodaj
   stalni termin** and **Uredi podatke** (customer detail). Each opens in place with
   **Prekliči**; after a successful save it closes and the result notice shows.
4. Trainer calendar: each occurrence shows its roster and one small **Dodaj stranko**
   button; the customer select and **Dodaj** appear only after it is pressed (one open at a
   time). Disabled with the reason ("Polno", "Zaprto") when the slot cannot take more.
5. Customer detail order: name, framed balance with the credits form beside it from 768 px,
   then upcoming, recurring, recent, ledger; invite and details lower down.
6. ADR 0011 "Responsive navigation and on-demand forms"; `docs/screens.md` route table
   (settings sub-routes) and every changed screen; `docs/app-structure.md` (shell).
