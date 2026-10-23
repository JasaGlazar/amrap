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
- Tests: pgTAP via `supabase test db` (`supabase/tests/*.sql`); frontend logic tests with Vitest.
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

A lightweight check (`scripts/check-docs.sh`, run by the `docs` CI job) verifies that every migration file and every
function name appears in the schema and RPC reference docs (see [CI](#ci)).

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`, as three
independent jobs:

| Job | What it runs |
|---|---|
| `db` | `supabase/setup-cli@v1`, then `supabase start -x studio,imgproxy,logflare,vector,edge-runtime` (applies the migrations and the seeds in `config.toml` `[db.seed]`), `supabase test db`, `supabase db lint`, and a check that `app/src/lib/database.types.ts` equals the output of `supabase gen types typescript --local`. |
| `app` | In `app/` with the Node version from `app/.node-version`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test -- --run`, `npm run build`. |
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
Expected candidates: new-migration, deploy-functions, generate-types, release-checklist.

## Skills

Project skills live in `.claude/skills/<name>/SKILL.md`.

| Skill | Use when |
|---|---|
| `new-migration` | Any change under `supabase/migrations/`: create the file with `supabase migration new`, failing pgTAP test first, `supabase db reset` + `supabase test db` + `supabase db lint`, update `docs/schema.md` / `docs/rpcs.md` / `docs/jobs.md` and the affected diagram, regenerate `app/src/lib/database.types.ts`, commit together. |

## Reviewer gate

Every task is reviewed by the `reviewer` agent (`.claude/agents/reviewer.md`) against
`PLAN.md` and this checklist before it counts as done. Critical and Important findings are
fixed before merge.

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

Database tests are pgTAP files in `supabase/tests/`, run by `supabase test db` against the
local stack after `supabase db reset` (which applies the migrations, then the seeds listed in
`supabase/config.toml` `[db.seed] sql_paths`). The CLI enables the `pgtap` extension for the
run, so test files do not create it.

| File | Covers |
|---|---|
| `001_schema.sql` | tables, enums, keys, indexes, check constraints, the one-charge index, default privileges, `customer_balances` |
| `002_rls.sql` | what a customer, the trainer, an unlinked auth user, `anon` and `service_role` can read and write directly |
| `010_book.sql` | `book`: own-only for customers, template/weekday/time/future rules, blocked periods (start inside, overlap, adjacent end), capacity at the boundary, duplicates, trainer and ad-hoc bookings |
| `011_cancel.sql` | `cancel`: the cutoff boundary ±1 min, started/charged/cancelled rejections, negative balance, trainer cancel and refund, a cancel freeing a full slot |
| `012_credits.sql` | `top_up` and `adjust`: trainer only, amount rules, ledger rows and balances |
| `013_charge_job.sql` | `charge_due_appointments`: due rows charged once, idempotent second run, grants, charge vs late cancel |
| `014_invites.sql` | `create_invite` and `accept_invite`: token format and expiry, single use, expired/superseded/unknown tokens, already linked users and records |
| `020_materialize.sql` | `materialize_recurring` and the `materialize_rule` helper: grants and role check, derived instance set over the window, skips (past, blocked overlap, cancelled instance, live booking, full slot, inactive rule/template), book()'s advisory lock, DST wall-clock, idempotent second run, trainer path, missing settings |
| `021_rules_and_jobs.sql` | `activate_rule` / `deactivate_rule`: trainer only, unknown rule, future booked instances cancelled and the rest untouched, immediate materialization, no recreation after reactivating, the any-status rule index; `slot_occupancy`: columns, owner-run, grants, counts for customer and trainer, nothing for an unlinked user or anon |

Helpers in `supabase/seeds/test_helpers.sql` (schema `tests`, local only):

- `tests.create_user(email text, password text default 'password') returns uuid` — a confirmed
  email/password auth user (rows in `auth.users` and `auth.identities`) that can also sign in
  through the API.
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
   total: the dev seed data is present in the database while tests run.
4. Assert failures by SQLSTATE: `throws_ok(sql, '42501', null, ...)` for privilege and RLS
   insert violations, `'23505'` for unique, `'23514'` for check constraints. An update or
   delete blocked by RLS affects zero rows instead of failing: assert it with
   `is_empty('update … returning id')`.
5. Call `tests.clear_authentication()` before going back to superuser fixtures.
6. Write the test first and watch it fail, then write the migration; run
   `supabase db reset && supabase test db` until the output is green with no notices.
