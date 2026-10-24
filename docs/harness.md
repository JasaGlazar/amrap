# Harness conventions

The harness is a small set of repo conventions and review gates that keep AI-assisted work
consistent. It is not tooling for its own sake; if a rule stops paying for itself, change it
with an ADR.

## Binding constraints

These constraints bind every task and are what the reviewer checks against (alongside `PLAN.md`).

- Supabase Free Plan and Cloudflare Pages free tier only. No paid add-ons, no custom SMTP.
- Ledger-first: no mutable balance column; balance = `SUM(credit_transactions.amount)`.
- All credit and capacity mutations go through `SECURITY DEFINER` RPCs with explicit role checks.
- Partial unique index on `credit_transactions(appointment_id) WHERE type IN ('session','late_cancel')`.
- Appointment status enum: `booked | charged | cancelled | cancelled_late | cancelled_by_trainer`.
- Transaction type enum: `topup | session | late_cancel | refund | adjustment`.
- Defaults: cutoff 5 h, slot 60 min, capacity 5, gym timezone `Europe/Ljubljana`.
- Slovenian UI; every user-visible string lives in `app/src/i18n/sl.ts`. No hardcoded UI strings.
- Docs 1:1 (below), no generated artifacts except the DB types, tests derive counts, no
  blocking hooks (all below).
- Auth: email/password with email confirmations disabled. Customers join only via trainer
  invite token (`create_invite` / `accept_invite`). Magic links and OTP are not used.
- Tests: pgTAP via `supabase test db` (`supabase/tests/*.sql`); frontend logic tests with Vitest;
  edge function tests with Deno (`scripts/test-functions.sh`).
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

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, as four
independent jobs:

| Job | What it runs |
|---|---|
| `db` | `supabase/setup-cli@v1`, then `supabase start -x studio,imgproxy,logflare,vector,edge-runtime` (applies the migrations and the seeds in `config.toml` `[db.seed]`), `supabase test db`, `supabase db lint`, and a check that `app/src/lib/database.types.ts` equals the output of `supabase gen types typescript --local`. |
| `app` | In `app/` with the Node version from `app/.node-version`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build`. |
| `functions` | `denoland/setup-deno@v2` with Deno 2.1.4 (what the local edge runtime 1.74.3 is compatible with), then `bash scripts/test-functions.sh`. |
| `docs` | `bash scripts/check-docs.sh`. |

`scripts/check-docs.sh` also runs locally from any directory and lists everything it finds
missing before exiting non-zero. It enforces two things, reading `supabase/migrations/*.sql`
only (not tests or seeds):

- every migration file name appears in `docs/schema.md`;
- every function declared by `create [or replace] function public.<name>` appears in
  `docs/rpcs.md`, either as a `## <name>` heading or in backticks (`` `name` `` or
  `` `public.name(` ``). The role helpers `current_customer_id` and `is_trainer` live in its
  "Helpers" section.

The Supabase CLI is pinned in `ci.yml` (`version: 2.117.0`, the version the committed types were
generated with); bumping it means regenerating `database.types.ts` in the same PR.

A stale generated-types failure is fixed by running
`supabase gen types typescript --local > app/src/lib/database.types.ts` and committing the result.

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
marked `Superseded by NNNN`. Add the ADR to the index in `docs/adr/README.md`.

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
| `release-checklist` | After a stage PR is merged to `main`: confirm the merge and CI, `supabase db push` from `main`, verify migrations, `cron.job` and pg_net, deploy `send-push` only when `supabase/functions/` changed, check the Pages deploy, smoke-test both roles at phone width, record the release on the PR. The steps' details stay in `docs/runbook.md`. |

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
   fixture slots must be bookable deletes `blocked_periods` first (`021`, `032`): a dev
   database's blocked periods would block them, and the rollback restores them.
4. Assert failures by SQLSTATE: `throws_ok(sql, '42501', null, ...)` for privilege and RLS
   insert violations, `'23505'` for unique, `'23514'` for check constraints. An update or
   delete blocked by RLS affects zero rows instead of failing: assert it with
   `is_empty('update … returning id')`.
5. Call `tests.clear_authentication()` before going back to superuser fixtures.
6. Write the test first and watch it fail, then write the migration; run
   `supabase db reset && supabase test db` until the output is green with no notices.
