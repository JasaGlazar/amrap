# Gym Session Tracker — Design & Plan

## Context

A personal trainer runs a small non-commercial gym. Customers pre-pay for session packs
(typically 8) tracked today on paper wall sheets; appointments (mostly fixed weekly slots,
plus ad-hoc ones negotiated by text) live on a whiteboard. The system runs on trust; some
sessions go unlogged, and cancellations/bookings generate constant texting. The goal is a
free-to-run PWA that digitizes credits and appointments without becoming stricter than the
trust-based reality it replaces.

This plan was produced through a full brainstorming/grilling session (2026-08-25); every
decision below was explicitly confirmed.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Credit authority | Customer QR-scan/manual check-in deducts; trainer can adjust. Some sessions are unsupervised, so customer self-scan is a real path, not just ritual. |
| Scan ↔ appointment | Scan = check-in to that day's appointment (marks ATTENDED, deducts once). Un-cancelled, un-attended appointments auto-deduct as NO_SHOW. Scan with no booking = walk-in. Never two deductions for one appointment. |
| Zero credits | Negative balances allowed; shown in red; trainer dashboard lists debtors. No blocking. |
| Recurrence | Recurring rules materialize concrete appointment instances ~4 weeks ahead via a scheduled job. Trainer owns rules; customers book one-offs. |
| Booking model | Customers self-book against slot capacity and cancel in-app (late-cancel cutoff, default 5h, configurable). Trainer has blackout/block tools. |
| Onboarding | Trainer-invite only (single-use expiring links). Customer records can exist without an app account (trainer tracks them manually). |
| Notifications | Best-effort web push (VAPID). Trainer: bookings/cancellations. Customer: pre-cutoff reminder, top-ups, adjustments. Home-screen install is part of onboarding (required for iOS push). |
| Backend | Supabase free tier: Postgres, Auth, RLS, edge functions, pg_cron. (Firebase rejected: scheduled functions need paid Blaze plan; Firestore fits the transactional ledger poorly.) |
| Frontend | Vite + React + TypeScript SPA, vite-plugin-pwa, React Router, Supabase JS. Hosted on Cloudflare Pages free tier. Trainer/customer views role-gated in one app. |
| Language | Slovenian UI, all strings centralized in one module. |
| Cost | €0 hosting (optional custom domain ~€10/yr). Payments/Stripe and door hardware explicitly out of scope. |

## Data model (Postgres, all tables under RLS)

Ledger-first: **no mutable balance column anywhere**; balance = `SUM(credit_transactions.amount)`.

- `customers` — name, phone, email, invite status/token, nullable `auth_user_id`, `role`
  ('trainer' | 'customer').
- `credit_transactions` — customer_id, amount (+8 topup, −1 attendance/no_show, ±n
  adjustment), type ('topup' | 'attendance' | 'no_show' | 'adjustment'), nullable
  appointment_id, created_by, note, created_at.
  **Partial unique index on appointment_id** ⇒ DB-enforced "one deduction per appointment"
  regardless of scan-vs-cron races.
- `recurring_rules` — customer_id, weekday, time, active.
- `appointments` — customer_id, starts_at, status ('booked' → 'attended' | 'cancelled' |
  'no_show'), source ('recurring' | 'self_booked' | 'trainer' | 'walk_in'), nullable
  rule_id, cancelled_at.
- `opening_hours`, `blocked_periods`, `settings` (late_cancel_hours default 5, capacity).
- `push_subscriptions` — user_id, endpoint, keys.

All credit/capacity mutations go through `SECURITY DEFINER` Postgres RPCs, each one
transaction with explicit role checks:

- `check_in()` — finds today's booked appointment → mark attended + deduct; else create
  walk_in appointment (attended) + deduct.
- `book()` — lock, count overlapping booked appointments vs capacity, insert.
- `cancel()` — now vs cutoff → free cancel, or cancel + deduct (late).
- `top_up()` / `adjust()` — trainer only.

## Screens

QR simplification: the wall QR encodes a static URL (`/check-in`); the phone camera
deep-links into the PWA — **no in-app camera/QR-decoding code**. Manual check-in is the
same screen via a button. No geo-fencing or rotating codes (scanning costs the customer a
credit; there is nothing to cheat toward).

Customer: **Home** (balance, red if negative; next appointment; check-in button),
**Check-in** (confirm "use 1 credit", shows resulting balance), **Calendar** (own
appointments; cancel with explicit free/late warning; book open slots with remaining
capacity), **History** (readable ledger).

Trainer: **Today** (appointments + live check-in status; debtors strip), **Calendar**
(week view all customers, capacity per slot, manage appointments + recurring rules),
**Customers** (balances; detail = ledger, top-up, adjust, invite link, edit),
**Settings** (hours, capacity, cutoff, blocked periods).

## Jobs (pg_cron; edge functions via pg_net where push is sent)

- Nightly: materialize recurring instances 4 weeks ahead.
- Nightly ~3 AM: yesterday's `booked` appointments with no check-in → `no_show` + deduct
  (next-day sweep gives forgetful scanners all day to check in late).
- Every 15 min: push reminder to customers whose cancellation cutoff is ~1h away.

## Build stages (each shippable)

1. **Foundation** — Supabase schema + RLS + RPCs with integration tests; Vite PWA shell,
   auth, invite flow.
2. **Credits core** — ledger, check-in (QR URL + manual), trainer top-up/adjust, history.
   *Already replaces the paper sheet — early pilot possible here.*
3. **Appointments** — rules, instance generation, booking/cancel with capacity + cutoff,
   both calendars.
4. **Automation** — no-show sweep, reminders, web push.
5. **Polish & pilot** — install onboarding, Slovenian copy review with trainer, real trial.

Each stage gets an entry in `IMPLEMENTATION_PLAN.md` at implementation time; TDD for RPCs
and logic.

## Verification

- Supabase CLI local stack (`supabase start`); RPC integration tests cover: double-scan,
  scan-vs-no-show race, capacity overflow at the boundary, late-cancel boundary (±1 min
  around cutoff), negative-balance flows, invite token reuse/expiry.
- Manual E2E per stage: run dev server, walk both roles' flows; verify PWA install +
  push on a real Android phone and an iPhone (home-screen install).
- Cron jobs testable by invoking their SQL/functions directly against the local stack with
  seeded fixture dates.

## Open questions for the trainer (configurable, non-blocking)

1. Exact late-cancel cutoff (5h assumed).
2. Does no-show deduction apply to unsupervised solo sessions?
3. Gym capacity number; session duration / slot grid.
4. Does he want any veto over self-bookings?
