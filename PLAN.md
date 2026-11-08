# AMRAP — Design & Plan

## Context

A personal trainer runs a small non-commercial gym. Customers pre-pay for session packs
(typically 8) tracked today on paper wall sheets; appointments (mostly fixed weekly slots,
plus ad-hoc ones negotiated by text) live on a whiteboard. The system runs on trust; some
sessions go unlogged, and cancellations/bookings generate constant texting. The goal is a
free-to-run PWA that digitizes credits and appointments without becoming stricter than the
trust-based reality it replaces.

This plan was first produced through a full brainstorming/grilling session (2026-08-25). It
was revised on 2026-10-23 after a second decision round; the project is now called AMRAP.
Every decision below was explicitly confirmed.

Main change of the second round: **QR / check-in is removed entirely.** There is no
attendance event anymore; every booked session is charged the same way (see Charging).

## Confirmed decisions

| Decision | Choice |
|---|---|
| Credit authority | Automatic charge at session start (pg_cron) plus trainer top-ups/adjustments. Nobody has to "log" a session. |
| Charging | A credit is deducted when a `booked` appointment reaches its start time without having been cancelled before the cutoff. Cron every 15 min: `booked` and `starts_at <= now()` → `charged`, one `session` transaction (−1). Customer cancels before cutoff → `cancelled`, free. Customer cancels after cutoff → `cancelled_late`, charged immediately at cancel time (`late_cancel`, −1). Trainer may cancel anything at any time → `cancelled_by_trainer`, never charges; if a charge already exists, a `refund` (+1) is inserted. One charge per appointment is DB-enforced. |
| Zero credits | Negative balances allowed; shown in red; trainer dashboard lists debtors. No blocking. |
| Recurrence | Recurring rules reference a slot template and materialize concrete appointment instances ~4 weeks ahead via a scheduled job. Trainer owns rules; customers book one-offs. |
| Slots | The trainer defines the weekly grid as slot templates: weekday, start time, duration (default 60 min, any value allowed), capacity (default 5). Duration and capacity are configurable per slot. |
| Booking model | Customers self-book open slots against the slot's own capacity and cancel in-app (cutoff default 5 h, configurable). No rescheduling after the cutoff: before it, reschedule = free cancel + new booking; after it, the cancel is late (charged) and any new booking is separate. Trainer has blackout/block tools. |
| Onboarding | Trainer-invite only (single-use expiring links). Customer records can exist without an app account (trainer tracks them manually). |
| Notifications | Best-effort web push (VAPID). Trainer: bookings/cancellations. Customer: pre-cutoff reminder (their only warning before a charge), top-ups, adjustments. Home-screen install is part of onboarding (required for iOS push). |
| Backend | Supabase free tier: Postgres, Auth, RLS, edge functions, pg_cron. (Firebase rejected: scheduled functions need paid Blaze plan; Firestore fits the transactional ledger poorly.) |
| Frontend | Vite + React + TypeScript SPA, vite-plugin-pwa, React Router, Supabase JS. Hosted on Cloudflare Pages free tier. Trainer/customer views role-gated in one app. |
| Language | Slovenian UI, all strings centralized in one module. |
| Cost | €0 hosting (optional custom domain ~€10/yr). Payments/Stripe and door hardware explicitly out of scope. |

### Infrastructure

- GitHub: https://github.com/JasaGlazar/amrap (private, personal account).
- Supabase project "AMRAP", ref `etzkbwqgjuipihypokjp`, eu-central-1, Postgres 17, Free Plan.
  Local dev via `supabase start` (needs Docker).
- Hosting: Cloudflare Pages free tier.

## Data model (Postgres, all tables under RLS)

Ledger-first: **no mutable balance column anywhere**; balance = `SUM(credit_transactions.amount)`.

- `customers` — name, phone, email, invite status/token, nullable `auth_user_id`, `role`
  ('trainer' | 'customer').
- `slot_templates` — weekday, start_time, duration_minutes (default 60), capacity
  (default 5), active. The trainer's weekly grid; each slot has its own capacity.
- `recurring_rules` — customer_id, slot_template_id, active.
- `appointments` — customer_id, nullable slot_template_id (null for trainer-created
  ad-hoc), starts_at, ends_at, status, source ('recurring' | 'self_booked' | 'trainer'),
  nullable rule_id, cancelled_at.
  Status: `booked → charged | cancelled | cancelled_late | cancelled_by_trainer`.
- `credit_transactions` — customer_id, amount, type, nullable appointment_id, created_by,
  note, created_at.
  Type: `topup` (+n) | `session` (−1) | `late_cancel` (−1) | `refund` (+1) | `adjustment` (±n).
  **Partial unique index on `credit_transactions(appointment_id) WHERE type IN ('session',
  'late_cancel')`** ⇒ DB-enforced "one charge per appointment" regardless of cron-vs-cancel
  races. `refund` is excluded so a trainer refund of an already-charged appointment is allowed.
- `blocked_periods`, `settings` (`late_cancel_hours` default 5).
- `push_subscriptions` — user_id, endpoint, keys.

All credit/capacity mutations go through `SECURITY DEFINER` Postgres RPCs, each one
transaction with explicit role checks:

- `book()` — lock, count non-cancelled appointments (`booked` + `charged`) in that slot vs
  the template's capacity, insert.
- `cancel()` — customer: before cutoff → free (`cancelled`); after cutoff → `cancelled_late`
  + `late_cancel` charge at cancel time. Trainer: always free (`cancelled_by_trainer`), plus a
  `refund` if a charge exists. Locks the appointment row, so a cancel racing the charge job
  ends with exactly one charge. Customer cancel is only allowed while status is `booked`; once the
  appointment has started (and is `charged`) the RPC rejects it with a descriptive error. Only
  the trainer can act on a charged appointment (cancel-with-refund).
- `top_up()` / `adjust()` — trainer only.
- `charge_due_appointments()` — called by cron; idempotent (running twice yields one charge).

## Screens

Customer: **Home** (balance, red if negative; next appointment; upcoming list),
**Calendar** (book open slots with remaining capacity; cancel with an explicit free/late
warning showing the cutoff time), **History** (past appointments with their status +
readable ledger).

Trainer: **Today** (today's slots with booked customers; debtors strip), **Calendar** (week
view of all customers, remaining capacity per slot, manage appointments + recurring rules),
**Customers** (balances; detail = ledger, top-up, adjust, cancel-with-refund, invite link,
edit), **Settings** (slot templates with per-slot capacity/duration, cutoff hours, blocked
periods).

## Jobs (pg_cron; edge functions via pg_net where push is sent)

- Nightly: materialize recurring instances 4 weeks ahead (idempotent).
- Every 15 min: `charge_due_appointments()`.
- Every 15 min: push reminder to customers whose cancellation cutoff is ~1h away. The
  pre-cutoff reminder is now the customer's only warning before a charge, so it is
  **required before pilot**, not optional.
- Keep-alive: Supabase Free Plan pauses projects after ~7 days of low user-database activity
  and goes read-only above 500 MB database size (checked against Supabase docs 2026-10-23).
  Mitigation: the frontend does a lightweight authenticated read on every load, and the docs
  record how to unpause from the dashboard. Unverified: whether pg_cron activity alone counts
  as user activity, so we do not rely on it.

## Build stages (each shippable)

1. **Foundation** — harness scaffolding (see AI harness), Supabase schema + RLS + RPCs with
   integration tests, Vite PWA shell, auth, invite flow.
2. **Credits & appointments core** — ledger, slot templates, recurring rules +
   materialization, booking/cancel with capacity + cutoff, charge job, trainer
   top-up/adjust/refund, both calendars, history. *Replaces the paper sheet and the
   whiteboard — pilot-ready here.*
3. **Automation & notifications** — pre-cutoff reminders, web push, keep-alive.
4. **Polish & pilot** — install onboarding, Slovenian copy review with trainer, real trial.

Each stage was planned in detail at implementation time; TDD for RPCs and logic.

## AI harness (built alongside the product)

A set of repo conventions and gates, not tooling for its own sake.

- **Layout**
  - `CONTEXT.md` — domain language: credit, charge, cutoff, slot template, recurring rule,
    late cancel, etc.
  - `docs/adr/NNNN-kebab-title.md` — one ADR per decision; status Accepted/Superseded;
    sections context/decision/consequences.
  - `docs/architecture/` — Mermaid diagrams committed as `.md`/`.mmd`: system context, data
    model ERD, appointment state machine, charging sequence, booking sequence, auth/invite
    flow.
  - `docs/` — per-component docs: schema & RPC reference, jobs, screens.
  - `.claude/skills/` — project-local skills.
- **First ADRs**, written in Stage 1 before code:
  - 0001 remove QR check-in in favour of cutoff-based charging
  - 0002 charge timing (session start via 15-min job; late cancel at cancel time)
  - 0003 ledger-only balance + partial unique index on charges
  - 0004 slot templates with per-slot capacity
  - 0005 Supabase free tier + Cloudflare Pages, with the pausing/keep-alive consequence
- **Docs 1:1 rule**: every task's diff that touches schema, RPCs, jobs, or screens must also
  touch the matching doc and diagram in the same commit. Enforced by (a) a reviewer agent
  gate on every task and (b) a lightweight CI check that every migration file and every RPC
  name appears in the schema/RPC reference doc. No hooks that block mid-turn (a logged pain
  point of a previous harness).
- **Skills**: added the second time a task repeats. Expected candidates: new-migration
  (migration + RPC test + docs + ADR touch), deploy-functions, generate-types,
  release-checklist.
- **Lesson carried over from a previous harness (reporting-api)**: do not commit regenerated
  artifacts (reports, snapshots with hardcoded counts) — they concentrate merge conflicts and
  hide silent auto-merge defects. Diagrams and docs are hand-authored; generated DB types are
  the only generated file committed, and tests derive counts instead of hardcoding them.

## Verification

- Supabase CLI local stack (`supabase start`); RPC integration tests cover: capacity overflow
  at the boundary, late-cancel boundary (±1 min around cutoff), charge job idempotency (run
  twice → one charge), charge-vs-late-cancel race (one charge), trainer cancel after charge →
  refund and net 0, customer cancel after start → rejected, no transaction, negative-balance flows, invite token reuse/expiry, recurring
  materialization idempotency, slot template with custom duration/capacity.
- Manual E2E per stage: run dev server, walk both roles' flows; verify PWA install +
  push on a real Android phone and an iPhone (home-screen install).
- Cron jobs testable by invoking their SQL/functions directly against the local stack with
  seeded fixture dates.

## Open questions for the trainer (non-blocking)

1. Does the trainer want any veto over self-bookings? (default: no)

Decided defaults: cutoff 5 h, slot 60 min, capacity 5 per slot, charge at session start,
late cancel charged at cancel time.
