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
**Status**: In Progress (plan and ADR 0009 written; Tasks 10–14 below)

## Stage 4: Polish & pilot
**Goal**: Install onboarding, Slovenian copy review with the trainer, real trial, release
checklist skill. Branch `stage-4-pilot`.
**Success Criteria**: Trainer runs one full week on AMRAP without the paper sheet.
**Tests**: manual E2E on both roles on real phones.
**Status**: Not Started

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
