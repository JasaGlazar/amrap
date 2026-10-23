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
**Status**: Complete (PR open; remote `db push` and owner steps in docs/runbook.md pending)

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
add a sign-out link to both shells; add an automated two-session test for `accept_invite` if a
harness allows it.
The customer calendar must show remaining capacity per slot while RLS hides other customers'
appointments: add a `SECURITY DEFINER` counting RPC or view (e.g. `slot_occupancy`). Route the
not-linked and lookup-failed sign-out buttons through `/logout` so failures surface.
**Status**: In Progress

## Stage 3: Automation & notifications
**Goal**: Web push (VAPID) via edge function + pg_net, `push_subscriptions` UI, pre-cutoff
reminder job (~1 h before cutoff, required before pilot), trainer booking/cancel
notifications, keep-alive read on app load, unpause runbook verified. Branch
`stage-3-notifications`.
**Success Criteria**: Reminder arrives on Android and iOS (home-screen install) before the
cutoff; no duplicate reminders.
**Tests**: reminder selection query idempotency with fixture dates; edge function unit tests.
**Status**: Not Started

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
  `time.md`, `screens.md`. Manually checked in a browser as ana. Next: Task 8.

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
