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

A lightweight CI check (`scripts/check-docs.sh`, CI added in Task 5) verifies that every migration file and every
RPC name appears in the schema and RPC reference docs.

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
