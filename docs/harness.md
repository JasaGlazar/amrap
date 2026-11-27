# Harness conventions

The harness is a small set of repo conventions and review gates that keep AI-assisted work
consistent. It is not tooling for its own sake; if a rule stops paying for itself, change it
with an ADR.

## Binding constraints

These constraints bind every task and are what the reviewer checks against (alongside `PLAN.md`).

- Supabase Free Plan and Cloudflare Workers Free plan only. No paid add-ons, no custom SMTP.
- Ledger-first: no mutable balance column; balance = `SUM(credit_transactions.amount)`.
- All credit and capacity mutations go through `SECURITY DEFINER` RPCs with explicit role checks.
- Partial unique index on `credit_transactions(appointment_id) WHERE type IN ('session','late_cancel')`.
- Appointment status enum: `booked | charged | cancelled | cancelled_late | cancelled_by_trainer`.
- Transaction type enum: `topup | session | late_cancel | refund | adjustment`.
- Defaults: cutoff 8 h, slot 60 min, capacity 5, gym timezone `Europe/Ljubljana`.
- Slovenian UI; every user-visible string lives in `app/src/i18n/sl.ts`. No hardcoded UI strings.
- Docs 1:1 (below), no generated artifacts except the DB types, tests derive counts, no
  blocking hooks (all below).
- Auth: email/password with email confirmations disabled. Customers join in one of two ways:
  the trainer invite (`create_invite` / `accept_invite`) or registration with the gym code
  (`register_customer`, ADR 0021). Magic links and OTP are not used.
- Tests: pgTAP via `supabase test db` (`supabase/tests/*.sql`); frontend logic tests with Vitest;
  edge function tests with Deno (`scripts/test-functions.sh`); browser tests with Playwright
  (`app/e2e/`, see [Browser tests](#browser-tests)).
- Never `supabase db push` to the remote from a feature branch (see `docs/runbook.md`).

## Docs 1:1 rule

Every diff that touches schema, RPCs, jobs or screens must also touch the matching doc and
diagram in the same commit:

| Change | Doc | Diagram |
|---|---|---|
| Tables, columns, RLS, views | `docs/schema.md` | `docs/architecture/data-model.md` |
| RPCs | `docs/rpcs.md` | the relevant sequence or state diagram |
| pg_cron jobs, edge functions | `docs/jobs.md` | `docs/architecture/charging-sequence.md` or system context |
| Screens | `docs/screens.md` | - |
| Auth flow, app structure | `docs/auth.md`, `docs/app-structure.md` | `docs/architecture/auth-invite-flow.md` (invite flow) |

A lightweight check (`scripts/check-docs.sh`, run by the `docs` CI job) verifies that every migration file and every
function name appears in the schema and RPC reference docs (see [CI](#ci)).

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, as five
independent jobs:

| Job | What it runs |
|---|---|
| `db` | `supabase/setup-cli@v1`, then `supabase start -x studio,imgproxy,logflare,vector,edge-runtime` (applies the migrations and the seeds in `config.toml` `[db.seed]`), `supabase test db`, `supabase db lint`, and a check that `app/src/lib/database.types.ts` equals the output of `supabase gen types typescript --local`. |
| `app` | In `app/` with the Node version from `app/.node-version`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build`. |
| `functions` | `denoland/setup-deno@v2` with Deno 2.1.4 (what the local edge runtime 1.74.3 is compatible with), then `bash scripts/test-functions.sh`. |
| `docs` | `bash scripts/check-docs.sh`. |
| `e2e` | The browser tests (see "Browser tests" below). It starts the stack like `db`: the same pinned CLI and the same `supabase start` line. Then, in `app/`, it runs `npm ci` and installs Chromium. It sets the test environment from `supabase status -o env` and runs `npm run e2e`. The timeout is 15 minutes. |

`scripts/check-docs.sh` also runs locally from any directory and lists everything it finds
missing before exiting non-zero. It enforces two things, reading `supabase/migrations/*.sql`
only (not tests or seeds):

- every migration file name appears in `docs/schema.md`;
- every function declared by `create [or replace] function public.<name>` appears in
  `docs/rpcs.md`, either as a `## <name>` heading or in backticks (`` `name` `` or
  `` `public.name(` ``). The role helpers `current_customer_id` and `is_trainer` live in its
  "Helpers" section.

The Supabase CLI is pinned once in `ci.yml`, in the workflow-level `SUPABASE_CLI_VERSION` value
(2.117.0, the version the committed types were generated with). Both the `db` and the `e2e` job
read it. Bumping it means regenerating `database.types.ts` in the same PR.

A stale generated-types failure is fixed by running
`supabase gen types typescript --local > app/src/lib/database.types.ts` and committing the result.

Details of the `e2e` job:

- Chromium comes from a cache of `~/.cache/ms-playwright`. The cache key is the runner OS and
  the `@playwright/test` version in `app/package-lock.json`. On a cache miss the job runs
  `npx playwright install --with-deps chromium`. On a hit it runs only
  `npx playwright install-deps chromium` for the system packages.
- `supabase status -o env` prints `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY`. The job writes
  them to `$GITHUB_ENV` as `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
  When one of the three names is missing, the step fails. The tests never fall back to the
  demo values in CI.

When `e2e` fails, it uploads one artifact named `playwright-report`. It holds
`app/playwright-report/` and `app/test-results/` and is kept for 7 days. A cancelled run
uploads nothing. To read it:

1. Open the failed run in the GitHub "Actions" tab and download `playwright-report` from the
   "Artifacts" list at the bottom of the run's summary page.
2. Unzip it. Run `npx playwright show-report <folder>/playwright-report` in `app/` to open
   the HTML report.
3. Open a trace from the report, or run `npx playwright show-trace <zip>` with a `trace.zip`
   from `<folder>/test-results/`. CI retries a failed test once and records a trace on that
   retry (`trace: 'on-first-retry'` in `app/playwright.config.ts`). A test that fails and then
   passes on the retry is flaky. It fails the job (`failOnFlakyTests`), so the report is
   uploaded and holds the trace of the retry.

Owner action: after the first green run on `main`, turn on branch protection for `main`. In
GitHub, go to Settings > Branches > "Add branch protection rule" (or Settings > Rules >
Rulesets) for `main`. Turn on "Require status checks to pass before merging" and require the
jobs `db`, `app`, `functions`, `docs` and `e2e`. Also turn on "Require branches to be up to
date before merging".

## Code comments

No explanatory comments: a comment is at most one line giving a non-obvious *why* (a
constraint, a race, a workaround). What a layer does is documented in its layer doc, not in
the code:

| Layer | Doc |
|---|---|
| Sign-in, customer lookup, role gating, invite acceptance, keep-alive | `docs/auth.md` |
| App folders, install onboarding, i18n rule, data layer contract, testing with the fake client | `docs/app-structure.md` |
| App reads and RPC wrappers (`app/src/data/`) | `docs/data-layer.md` |
| Dates, weeks, DST, cutoff, formatting in the app | `docs/time.md` |
| Tables, views, RLS, grants, seeds | `docs/schema.md` |
| RPCs and helpers | `docs/rpcs.md` |
| Scheduled jobs | `docs/jobs.md` |
| Web push: notification log, dispatch, edge function, service worker | `docs/notifications.md` |

A migration starts with one line pointing at its reference docs; section divider lines
(`-- Name ----`) are fine. A migration already on `main` is never edited, except for its
comments: its SQL statements stay byte-identical.

## ADR rule

One ADR per decision, in `docs/adr/NNNN-kebab-title.md`, with Status, Date, Context, Decision
and Consequences. An ADR is never deleted: a changed decision gets a new ADR and the old one is
marked `Superseded by NNNN` (`Superseded in part by NNNN` when only part changes). Add the ADR
to the index in `docs/adr/README.md`.

## Diagram rule

Diagrams are hand-authored Mermaid in `docs/architecture/*.md`, one diagram per file with a
one-paragraph intro. Use the common subset only: flowchart, erDiagram, stateDiagram-v2,
sequenceDiagram. Quote labels that contain parentheses or special characters.

## Skill rule

A project skill in `.claude/skills/` is added the second time a task repeats, not before.
Added so far: new-migration (Stage 1), release-checklist (Stage 4, after three post-merge
releases). Deploying `send-push` is one step of release-checklist rather than its own
deploy-functions skill; generate-types is one step of new-migration.

## Skills

Project skills live in `.claude/skills/<name>/SKILL.md`.

| Skill | Use when |
|---|---|
| `new-migration` | Any change under `supabase/migrations/`: create the file with `supabase migration new`, failing pgTAP test first, `supabase db reset` + `supabase test db` + `supabase db lint`, update `docs/schema.md` / `docs/rpcs.md` / `docs/jobs.md` and the affected diagram, regenerate `app/src/lib/database.types.ts`, commit together. |
| `release-checklist` | After a stage PR is merged to `main`: confirm the merge and CI, `supabase db push` from `main`, verify migrations, `cron.job` and pg_net, deploy `send-push` only when `supabase/functions/` changed, deploy and check the app on Cloudflare Workers, smoke-test both roles at phone width, record the release on the PR. The steps' details stay in `docs/runbook.md`. |

## Reviewer gate

Every task is reviewed by the `reviewer` agent (`.claude/agents/reviewer.md`) against
`PLAN.md` and this checklist before it counts as done. Critical and Important findings are
fixed before merge. Since Stage 4 the checklist also covers the phone UI rules in
[screens.md](screens.md#behaviour-shared-by-all-screens) and keeping `docs/copy-review.md` in
step with `sl.ts` until the trainer's sign-off.

## No blocking hooks

No git hooks and no Claude hooks that block mid-turn. Checks run in CI and in the reviewer
gate instead. This is a lesson from a previous harness.

## No regenerated artifacts

Do not commit regenerated artifacts (reports, snapshots with hardcoded counts); they
concentrate merge conflicts and hide silent auto-merge defects. The only generated file
committed is `app/src/lib/database.types.ts` (Supabase types, generated in Task 2).

## Tests derive counts

Tests compute expected counts and balances from the data they insert. No hardcoded totals
that break when fixtures change.

## Testing

Edge functions are tested with Deno: `scripts/test-functions.sh` runs, in every
`supabase/functions/<name>/` with a `deno.json`, `deno fmt --check`, `deno lint`, `deno check
index.ts` and `deno test --allow-env`. It uses a local `deno` when one is installed and
otherwise the `denoland/deno:2.1.4` Docker image (Deno is not required on the host). Tests sit
next to the code (`*_test.ts`) and inject fakes for the database and the push service, so they
need no network beyond fetching their imports. Each function's `deno.json` pins its imports and
sets `"lock": false`, so no lockfile is generated.

Database tests are pgTAP files in `supabase/tests/`, run by `supabase test db` against the
local stack after `supabase db reset` (which applies the migrations, then the seeds listed in
`supabase/config.toml` `[db.seed] sql_paths`). The CLI enables the `pgtap` extension for the
run, so test files do not create it.

| File | Covers |
|---|---|
| `001_schema.sql` | tables, enums, keys, indexes, check constraints, the one-charge index, default privileges, `customer_balances` |
| `002_rls.sql` | what a customer, the trainer, an unlinked auth user, `anon` and `service_role` can read and write directly |
| `010_book.sql` | `book`: own-only for customers, template/weekday/time/future rules, blocked periods (start inside, overlap, adjacent end), capacity at the boundary, duplicates, trainer and ad-hoc bookings |
| `011_cancel.sql` | `cancel`: the one signature with its optional reason, the cutoff boundary ±1 min, started/charged/cancelled rejections, negative balance, trainer cancel and refund, the reason (trimmed, blank, 200 and 201 characters, refused for a customer, the table's check), a cancel freeing a full slot |
| `012_credits.sql` | `top_up` and `adjust`: trainer only, amount rules, ledger rows and balances |
| `013_charge_job.sql` | `charge_due_appointments`: due rows charged once, idempotent second run, grants, charge vs late cancel |
| `014_invites.sql` | `create_invite` and `accept_invite`: token format and expiry, single use, expired/superseded/unknown tokens, already linked users and records |
| `020_materialize.sql` | `materialize_recurring` and the `materialize_rule` helper: grants and role check, derived instance set over the window, skips (past, blocked overlap, cancelled instance, live booking, full slot, inactive rule/template), book()'s advisory lock, DST wall-clock, idempotent second run, trainer path, missing settings |
| `021_rules_and_jobs.sql` | `activate_rule` / `deactivate_rule`: trainer only, unknown rule, future booked instances cancelled and the rest untouched, immediate materialization, no recreation after reactivating, the any-status rule index; `slot_occupancy`: columns, owner-run, grants, counts for customer and trainer, nothing for an unlinked user or anon; pg_cron: both jobs in `cron.job`, materialization without a JWT |
| `030_notifications.sql` | pg_net in `extensions`, the `notifications` table (unique per kind and appointment, closed to the API), push function grants, `push_config`, the queued `send-push` request, no request without ids or config, a failing pg_net call caught, `claim_notifications` once per notification and subscription |
| `031_reminders.sql` | `send_cutoff_reminders`: the 45/75-minute window boundaries, statuses, unlinked and unsubscribed customers, one row per appointment, the request and its ids, second and overlapping runs, a late subscriber, a 0-hour cutoff, pruning, no config, no settings, grants, the schedule |
| `032_event_notifications.sql` | the notification triggers: a customer booking and cancel notify the trainer (with `late`), a trainer cancel notifies the customer (with `refunded` and the reason, and `deactivate_rule` once per instance), top-up and adjustment notify the customer (with the balance); trainer bookings, materialization, charges and refunds do not; one recipient with two trainers; no device, no account or no config records nothing; actions succeed and take effect when the notification fails (a failing `enqueue_notification`, a failed pg_net call that keeps the row undispatched, a direct failure inside `enqueue_notification`); `save_push_subscription` (move between accounts, forbidden, invalid, non-https, anon), the https-only endpoint constraint; function grants and the triggers |
| `033_retention.sql` | `prune_cron_history`: the daily schedule, grants, cron runs 13 and 15 days old, one exactly 14 days old (kept), runs that never ended (by start), the returned count, a second run |
| `034_cancel_occurrence.sql` | `cancel_occurrence`: definition and grants, a customer and anon refused, unknown/inactive template, wrong weekday or time, missing arguments, a long reason; every live booking cancelled with the trimmed reason and charged ones refunded (balances from the fixture), other occurrences, earlier cancels and ad-hoc appointments untouched, the blocked period of the template's duration, `book()`'s lock held and taken before the blocked check (also in `book` and `materialize_rule`), `book()` and a second call then rejected, past and empty occurrences, materialization skipping the closed occurrence, one notification per customer with a device, a failing notification, missing settings |
| `035_booking_switch.sql` | the cutoff (8 hours in the row and as the default), `customer_booking_enabled` (default false, not null); a customer `book()` refused while it is false, the trainer's `book()` and `materialize_recurring` still booking, a customer `book()` once it is true, a missing settings row |
| `036_undo_cancel.sql` | `undo_cancel`: definition and grants, `book()`'s lock held and taken before the blocked check; a customer's own free cancel restored with no ledger row and later charged once by the charge job; another customer, the trainer, an unlinked user and anon refused; unknown and null id; `booked`, `charged`, `cancelled_late` and `cancelled_by_trainer` refused; exactly at the cutoff refused and one second before it allowed; blocked period, full slot (count stays at capacity), inactive template, another live booking at the same start, inactive and active recurring rule, ad-hoc appointment; missing settings |
| `037_booking_restored.sql` | the `booking_restored` notification: definition and grants, the enum value; a customer's undo notifies the trainer with the name, start and timezone and queues its request; the customer gets nothing; `cancelled_late` → `booked` notifies nobody; no trainer device records nothing and the undo still succeeds; cancel, undo, cancel, undo on one appointment writes a new undispatched row of the step's kind each time and queues each one; a status change succeeds when its push request cannot be queued or its notification fails |
| `038_registration.sql` | `register_customer` and `set_registration_code`: definitions and grants, `registration_settings` shape, default row and table grants, `customers.registered_at`; signed out and no user refused; closed, wrong and null code refused with one token, also with invalid fields; name and phone bounds, spaces and null; the new record (role, trimmed fields, auth email, link, `registered_at`); a second call, a linked customer and the trainer refused with exactly one record kept; who can read and write `registration_settings`; the trainer sets, refuses a 7-character code, replaces and clears the code; a replaced code is refused and, after the clear, the old code is refused; a missing settings row fails closed. The two-tabs-at-once path of `register_customer` (a `unique_violation` turned into `AMRAP_ALREADY_LINKED`) has no test; it is checked by reading the code |
| `039_customer_registered.sql` | the `customer_registered` notification: definition and grants, the enum value, the trigger on `customers`; a registration notifies the trainer with the customer's id and name and queues its request; the new customer gets nothing; a record the trainer creates notifies nobody; two registrations write two rows; no trainer device records nothing and the registration still succeeds; a registration succeeds when its push request cannot be queued (the row stays undispatched) or its notification fails (nothing recorded) |
| `040_delete_customer.sql` | `delete_customer()`: definition and grants; a customer is refused, a null id and an unknown id are refused; a record with an appointment (here a future cancelled one), a credit transaction or an inactive rule is refused, and so is a trainer record, and each refused record keeps its rows; a record with no history is deleted, its notifications go with it, its auth user stays; a second delete finds nothing |

Helpers in `supabase/seeds/test_helpers.sql` (schema `tests`, local only):

- `tests.create_user(email text, password text default 'password') returns uuid` — a confirmed
  email/password auth user (rows in `auth.users` and `auth.identities`) that can also sign in
  through the API. Executable by the test superuser only.
- `tests.authenticate_as(user_id uuid)` — until the end of the transaction, act as that user:
  role `authenticated` and `request.jwt.claims` with `sub` and `role`, so `auth.uid()` and
  RLS behave as for a real request.
- `tests.authenticate_as_service_role()` — act as `service_role` (bypasses RLS).
- `tests.clear_authentication()` — drop the claims and return to the test superuser
  (`postgres`, which bypasses RLS). To test `anon`, use `set local role anon;` directly.

How to write a test:

1. One file per area, numbered (`0NN_name.sql`). Wrap it in `begin;` … `rollback;` so fixtures
   never leak, and start with `select plan(N);` where N is the exact number of assertions;
   end with `select * from finish();`.
2. Insert fixtures as the superuser first (RLS does not apply). Create users with
   `tests.create_user` and link them through `customers.auth_user_id`.
3. Compute expected rows, counts and balances from the fixtures before switching roles (for
   example into a temp table, `grant select` on it to `authenticated`), then switch with
   `tests.authenticate_as(...)` and compare (`set_eq`, `is`, `results_eq`). Never hardcode a
   total: the dev seed data is present in the database while tests run. A test whose
   fixture slots must be bookable deletes `blocked_periods` first (`021`, `032`, `034`, `036`): a dev
   database's blocked periods would block them, and the rollback restores them.
4. Assert failures by SQLSTATE: `throws_ok(sql, '42501', null, ...)` for privilege and RLS
   insert violations, `'23505'` for unique, `'23514'` for check constraints. An update or
   delete blocked by RLS affects zero rows instead of failing: assert it with
   `is_empty('update … returning id')`.
5. Call `tests.clear_authentication()` before going back to superuser fixtures.
6. Write the test first and watch it fail, then write the migration; run
   `supabase db reset && supabase test db` until the output is green with no notices.

### App tests

Vitest tests sit next to the code in `app/src/` (`*.test.ts`, `*.test.tsx`) and run with
`npm test` in `app/`. Page tests use the fake Supabase client in `app/src/test/fakeSupabase.ts`
([app-structure.md](app-structure.md#testing-with-the-fake-client)). The table below is not a
full list of the files.

| File | Covers |
|---|---|
| `app/src/pages/register.test.tsx` | the registration page: no code shows the scan-the-QR copy and no form, signed out and signed in without a record; the fields signed out (all required, the phone keyboard, autofill hints) and signed in without a record (name and phone only); name, phone and password checks before any request, with the trimmed bounds; sign-up, `register_customer` with the trimmed fields and the code, then the customer Home; a sign-up with no session; an existing account with the right password (registered), with the wrong password (a link to sign in) and with a record already (ends on Home); other sign-up and sign-in errors; a refused code shows the closed copy and the short form, and a retry calls `register_customer` again with no new sign-up; a failed customer lookup shows the lookup-failed page and no form; a linked user sent to the customer Home |

### Browser tests

Playwright tests in `app/e2e/` run the main flows in Chromium with the "Pixel 7" phone profile.
They run against the production build of the app and the local Supabase stack (ADR 0020).

They cover sign-in, routing by role and the screens working with the real database. They do
not cover rules about time (the cutoff, charging, materialization): those stay in pgTAP, where
time can be controlled. Push delivery stays a manual check on a phone.

How to run, in `app/`:

1. Start the local stack: `supabase start`.
2. Install Chromium once: `npx playwright install chromium`.
3. Run `npm run e2e`. `npm run e2e:ui` opens Playwright's UI.

`npm run e2e` builds the app with `vite build --mode e2e` into `app/dist-e2e`, serves it with
`vite preview` on port 4173 and runs the tests. Its own output folder keeps a production build
in `app/dist` safe. The build gets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as process
environment variables. Mode `e2e` keeps `app/.env.production.local` (the hosted project) out.
In mode `e2e`, `app/vite.config.ts` also sets `envDir: false`, so the build reads no `.env`
file at all, not even `app/.env.local`. `app/dist-e2e` is ignored by git. The HTML report
goes to `app/playwright-report/` (open it with `npx playwright show-report`); traces and other
output go to `app/test-results/`. Both are ignored by git.

`app/e2e/env.ts` reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. It
uses the local stack's demo values when they are not set. It throws when the URL's host is not
`127.0.0.1` or `localhost`. A global setup (`app/e2e/global-setup.ts`) calls the local REST
endpoint once and stops the run with `Local Supabase is not running. Run "supabase start"
first.` when nothing answers or the endpoint answers with status 500 or higher.

Every browser context in a test blocks requests to hosts other than `127.0.0.1` and
`localhost` (`LOCAL_HOSTS` in `app/e2e/env.ts`). The fixtures abort such a request and record
its host. After the test, the test fails with a message that lists the hosts. The default
`page` gets this through the fixtures. For a second user in the same test, use
`newGuardedPage()` from the fixtures. A lint rule stops a spec from calling
`browser.newContext()` or `browser.newPage()`.

The guard covers HTTP requests from the pages (`context.route`) and WebSockets
(`context.routeWebSocket`). A WebSocket to another host is recorded in the same list and
closed. The guard relies on one thing: the app's service worker only handles same-origin
requests. Playwright does not route requests that a service worker makes itself, so a service
worker that fetched from another host would not be seen.

How the fixtures in `app/e2e/fixtures.ts` make data:

- `customer`: a new auth user (admin API, email confirmed) and its linked `customers` row,
  with a unique email `e2e-<random>@test.local`. After the test the fixture deletes the
  customer's credit transactions, appointments and recurring rules (in that order, because of
  the foreign keys), then the row and the auth user. A charge job can add a credit transaction
  after the transactions are deleted, and then the appointments delete fails. In that case the
  fixture deletes the transactions and the appointments again, up to 3 times in total.
- `slotTemplate`: a new active slot template, made as the trainer: Thursday (weekday 3),
  capacity 5 (given to the test as `capacity`), start time 12:00 plus a random minute (12:00 to
  12:59). The random minute keeps sessions of tests that run at the same time apart on screen.
  After the test the fixture deletes the credit transactions of the template's appointments and
  the appointments (again up to 3 times, like `customer`), then the recurring rules and then the
  template. When the template delete fails, it deactivates the template instead.
- `fixedAppointment`: a recurring rule for `customer` on `slotTemplate`, made as the trainer
  with the same calls as `addRule` in `app/src/data/rules.ts` (insert the rule, then
  `activate_rule`). It fails when `activate_rule` creates fewer than 3 appointments; a blocked
  period in the local database is the likely cause. It gives the template id, the rule id, the
  start time and the capacity.
- `registrationCode`: sets a fresh gym code `e2e-<random>` on the one row of
  `registration_settings`, through the service-role client (it bypasses RLS;
  `set_registration_code` accepts only the trainer). It fails when the row (id 1) is missing.
  After the test it sets the code back to null.
- `registrant`: a unique email `e2e-<random>@test.local`, a password, a name and a phone for a
  person who signs up through the app. It makes no data itself. After the test it finds the
  auth user by the email (it reads every page of the admin user list). When a customer row is
  linked to that user, it first deletes the trainer's `customer_registered` notification for
  that customer (`data->>'customer_id'`). The trigger writes it only when push is set up locally
  and the trainer has a device, and it does not cascade. Then it deletes the row's credit transactions, appointments, recurring
  rules and the row, the same way and with the same retry as `customer`. Then it deletes the
  auth user. This runs even when the test fails part way.
- `signIn(page, who)`: fills the real login page and waits for the role's home (`/t` or `/c`).
- `TRAINER`: the seeded `trainer@amrap.local` from `supabase/seeds/dev.sql`.

The trainer signs in through the API once per worker. Each test also signs in through the
login page, once or twice. The local stack allows 1000 sign-ins and sign-ups per 5 minutes per
IP address (`[auth.rate_limit] sign_in_sign_ups` in `supabase/config.toml`), raised from 30
for these tests. After you change that value, restart the stack (`supabase stop`, then
`supabase start`). The hosted project does not read this file, so its limit stays as it is.
`supabase config push` would send it to the hosted project; this project never runs that
command.

Rules that keep the tests stable:

- Find elements by role and accessible name. Import the names from `app/src/i18n/sl.ts`; never
  type UI copy in a test.
- No fixed waits (`waitForTimeout`). Use Playwright's waiting on elements and URLs.
- Each test makes its own data. Tests do not depend on each other, on their order, on the
  weekday or on the time of day.
- One retry in CI, none locally. A trace is recorded on the retry. In CI a flaky test, one that
  fails and then passes on the retry, fails the job, and the report has the trace of the retry.
- Tests run in parallel locally and with two workers in CI.
- A test that fails only sometimes is fixed or its cause is reported. It is never skipped.
- The tests assume the local database is at seed defaults: `customer_booking_enabled` is false,
  the cutoff is the default and no blocked period falls in the next four weeks. CI always
  starts from seed defaults.
- The gym code is one shared row. Tests that use `registrationCode` sit in a describe block
  with Playwright's test lock `registration-code` (`{ lock: 'registration-code' }`). Tests
  that share a lock never run at the same time, on any worker. They also run in serial mode.
  Serial mode is not enough on its own: with `--repeat-each`, each repeat of a serial block is
  its own group, and the groups run on different workers at the same time. The lock lives in
  the Playwright runner, so it guards one run only. Two runs at once cannot happen locally:
  with `reuseExistingServer: false`, Playwright stops the second run because
  `http://localhost:4173` is already used. No other spec reads or sets the gym code.

| File | Covers |
|---|---|
| `auth.spec.ts` | the trainer lands on `/t` and a customer on `/c` after sign-in; a wrong password shows the invalid-credentials error; a customer who opens `/t` is sent to `/c`; during a customer sign-in the app sends at least one auth and one REST request, all to `127.0.0.1` or `localhost` |
| `customer.spec.ts` | a customer with a fixed appointment sees at least three upcoming rows on Home; they cancel the last one, it moves to the cancelled list, they undo it and it is back in the upcoming list with the "restored" status; next week's calendar shows free places on their session and no book button |
| `trainer.spec.ts` | the trainer adds a fixed appointment on the customer's page, then the customer (in a second browser context) sees it on Home; the trainer cancels the customer's last upcoming appointment with a reason, then the customer sees it in History as cancelled by the trainer, with the reason |
| `registration.spec.ts` | a person opens the registration link with the gym code, signs up and lands on `/c` with the empty-Home copy; the trainer finds them in the customer list with the "Nov" tag and adds a fixed appointment on their page; the person reloads Home and sees an upcoming appointment. A wrong code shows the registration-closed copy and stays on `/registracija`. The link without a code shows no form |
