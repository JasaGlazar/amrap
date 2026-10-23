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
**Status**: In Progress (plan approved; Task 15 done, Tasks 16-19 not started)

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
  a request made within the same second the token was issued is sometimes rejected with 401.
  Seen three times in this check: `accept_invite` right after an invite sign-up (the page
  showed `genericError`; the 79-byte 401 body matches PGRST303 exactly), the customer lookup
  right after sign-in (the "Podatkov ni mogoče naložiti" page), and the keep-alive (logged
  only). Captured with a fetch logger injected at document start. Each recovers on retry
  (the invite link again, **Poskusi znova**). Whether the hosted project shows it is unknown.
  Fixed after Task 15 (orchestrator ruling): `retryIssuedAtFuture` in `lib/supabase.ts` retries
  a 401 `PGRST303` once after one second, nothing else ([auth.md](docs/auth.md)).

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
   the installed app; the trial week with the pilot guide; Stage 3 owner actions still open.
4. Open product questions for the owner (not decided here): should a trainer cancel notify the
   customer; does the trainer want a veto over self-bookings (`PLAN.md` open question 1); any
   copy question the trainer leaves open.
5. `supabase stop`.
