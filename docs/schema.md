# Schema

Reference for every table, view and helper in `public`. The migrations in
`supabase/migrations/` are the exact definition; the ERD is in
[architecture/data-model.md](architecture/data-model.md). The model is ledger-first
(ADR 0003): there is no balance column anywhere.

All tables have row level security enabled. Customers only read directly; every customer
write (booking, cancelling, accepting an invite) and every credit change goes through a
`SECURITY DEFINER` RPC ([rpcs.md](rpcs.md)). `anon` has no privileges on anything in `public`.

## Migrations

| File | Contents |
|---|---|
| `20261023173423_initial_schema.sql` | Enums, all tables, indexes, constraints, `customer_balances` view, `current_customer_id()` / `is_trainer()` helpers, RLS policies and grants. |
| `20261023175948_core_rpcs.sql` | The RPCs in [rpcs.md](rpcs.md) and their execute grants. |

## Enums

| Enum | Values |
|---|---|
| `customer_role` | `trainer`, `customer` |
| `appointment_status` | `booked`, `charged`, `cancelled`, `cancelled_late`, `cancelled_by_trainer` |
| `appointment_source` | `recurring`, `self_booked`, `trainer` |
| `transaction_type` | `topup`, `session`, `late_cancel`, `refund`, `adjustment` |

## Tables

All `id` columns are `uuid primary key default gen_random_uuid()` (except `settings`), and all
`created_at` columns are `timestamptz not null default now()`.

### customers

A person who trains at the gym, or the trainer. May or may not have an app account.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | not null |
| `phone` | text | |
| `email` | text | contact only; not proof of identity (ADR 0006) |
| `role` | customer_role | not null, default `customer` |
| `auth_user_id` | uuid | unique, references `auth.users(id)` on delete set null |
| `invite_token` | text | unique; single use, cleared on accept |
| `invite_expires_at` | timestamptz | token expiry (7 days) |
| `created_at` | timestamptz | |

Invite status is derived, not stored: **linked** when `auth_user_id` is not null, **pending**
when `invite_token` is not null and `invite_expires_at > now()`, otherwise **none**.

### slot_templates

The trainer's weekly grid (ADR 0004).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `weekday` | smallint | not null, check `0..6`; **0 = Monday … 6 = Sunday** (Postgres `isodow - 1`, not `dow`), in `settings.timezone` |
| `start_time` | time | not null, local time in `settings.timezone` |
| `duration_minutes` | int | not null, default 60, check `> 0` |
| `capacity` | int | not null, default 5, check `> 0` |
| `active` | boolean | not null, default true |
| `created_at` | timestamptz | |

### recurring_rules

The trainer's standing assignment of a customer to a slot template.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `customer_id` | uuid | not null, references `customers` |
| `slot_template_id` | uuid | not null, references `slot_templates` |
| `active` | boolean | not null, default true |
| `created_at` | timestamptz | |

Unique `(customer_id, slot_template_id)`.

### appointments

One customer's reservation of a slot or an ad-hoc time.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `customer_id` | uuid | not null, references `customers` |
| `slot_template_id` | uuid | references `slot_templates`; null for ad-hoc appointments |
| `starts_at` | timestamptz | not null |
| `ends_at` | timestamptz | not null, check `ends_at > starts_at` |
| `status` | appointment_status | not null, default `booked` |
| `source` | appointment_source | not null |
| `rule_id` | uuid | references `recurring_rules`; set for materialized appointments |
| `cancelled_at` | timestamptz | |
| `created_at` | timestamptz | |

Indexes:

- `appointments_one_live_booking_idx` — unique `(customer_id, starts_at) where status in
  ('booked','charged')`: one live booking per customer per start time; cancelled rows do not
  block rebooking.
- `appointments_slot_template_id_starts_at_idx` — `(slot_template_id, starts_at)`, slot
  occupancy for the capacity check.
- `appointments_status_starts_at_idx` — `(status, starts_at)`, the charge job's scan.

### credit_transactions

The append-only credit ledger. A customer's balance is the sum of their `amount`s.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `customer_id` | uuid | not null, references `customers` |
| `amount` | int | not null, check `<> 0` |
| `type` | transaction_type | not null |
| `appointment_id` | uuid | references `appointments` |
| `created_by` | uuid | references `auth.users(id)` on delete set null; the acting user, null for the charge job |
| `note` | text | |
| `created_at` | timestamptz | |

Check `credit_transactions_amount_matches_type`:

| Type | Amount | `appointment_id` |
|---|---|---|
| `session` | −1 | required |
| `late_cancel` | −1 | required |
| `refund` | +1 | required |
| `topup` | > 0 | optional |
| `adjustment` | any non-zero | optional |

Any other type fails the check (`else false`), so a future enum value must be added to it.

Indexes:

- `credit_transactions_one_charge_per_appointment_idx` — unique `(appointment_id) where type in
  ('session','late_cancel')`: at most one charge per appointment, enforced by the database.
  `refund` is excluded so a charged appointment can be refunded.
- `credit_transactions_customer_id_idx` — `(customer_id)`, balance aggregation.

### blocked_periods

A time range (holiday, closure) in which booking is not allowed.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `starts_at` | timestamptz | not null |
| `ends_at` | timestamptz | not null, check `ends_at > starts_at` |
| `reason` | text | |
| `created_at` | timestamptz | |

### settings

Single-row configuration; the row (`id = 1`, defaults) is inserted by the migration.

| Column | Type | Notes |
|---|---|---|
| `id` | int | PK, default 1, check `id = 1` |
| `late_cancel_hours` | int | not null, default 5, check `>= 0`; the cutoff |
| `timezone` | text | not null, default `Europe/Ljubljana`; the gym's timezone |

### push_subscriptions

Web Push subscriptions, one per device/browser endpoint. Owned by an auth user, so it reaches
a customer only through `customers.auth_user_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | not null, references `auth.users(id)` on delete cascade |
| `endpoint` | text | not null, unique |
| `p256dh` | text | not null, subscription public key |
| `auth` | text | not null, subscription auth secret |
| `created_at` | timestamptz | |

Index `push_subscriptions_user_id_idx` on `(user_id)`.

Foreign keys not listed with an `on delete` action use the default (no action): customers,
slot templates, rules and appointments with dependent rows cannot be deleted, which keeps the
ledger intact. Deactivate instead (`active = false`).

## Views

### customer_balances

`(customer_id uuid, balance bigint)`: `coalesce(sum(amount), 0)` per customer over `customers
left join credit_transactions`, so a customer without transactions has balance 0. Created
`with (security_invoker = true)`, so the caller's RLS applies: a customer sees only their own
row, the trainer sees all. Read-only (`select` only for `authenticated`). A debtor is a row with
`balance < 0`.

## Helpers

Both are `language sql stable security definer set search_path = ''`. They are
`SECURITY DEFINER` so policies can call them without recursing into the RLS of `customers`.
Role comes from the `customers` row, never from user-editable auth metadata (ADR 0006).
`execute` is granted to `authenticated` and `service_role` only.

| Function | Returns |
|---|---|
| `public.current_customer_id()` | `uuid`: the `customers.id` whose `auth_user_id = auth.uid()`, or null |
| `public.is_trainer()` | `boolean`: true when the caller's customer row has `role = 'trainer'` |

## RLS policies

Policies apply to `authenticated`. `is_trainer()` and `current_customer_id()` are wrapped in
`(select …)` so they are evaluated once per statement.

| Table | Trainer | Customer |
|---|---|---|
| `customers` | all | select own row (`auth_user_id = auth.uid()`) |
| `slot_templates` | all | select rows with `active = true` |
| `recurring_rules` | all | select own (`customer_id = current_customer_id()`) |
| `appointments` | all | select own |
| `credit_transactions` | all | select own |
| `blocked_periods` | all | select all |
| `settings` | all | select |
| `push_subscriptions` | all | all on own rows (`user_id = auth.uid()`), linked customers only |
| `customer_balances` (view) | all rows via invoker RLS | own row via invoker RLS |

Customers have no insert, update or delete policy on any table except `push_subscriptions`;
such writes affect zero rows (update/delete) or fail with `42501` (insert). The shared reference
tables (`slot_templates`, `blocked_periods`, `settings`) and `push_subscriptions` additionally
require `current_customer_id() is not null`, so an auth user without a customer record (public
sign-up without an invite) can neither read nor write any row.

## Grants

- `anon`: nothing. `revoke all on all tables in schema public from anon`; execute on the helpers
  revoked from `public` and `anon`.
- `authenticated`: `select, insert, update, delete` on every table (RLS decides rows),
  `select` only on `customer_balances`. No `truncate`, `references`, `trigger` or `maintain`.
- `service_role`: Supabase defaults (bypasses RLS); used by server-side jobs.
- Default privileges for objects that `postgres` (migrations) creates revoke everything on
  tables, sequences and functions in `public` from `anon`, and
  `truncate`/`references`/`trigger`/`maintain` on tables from `authenticated`, so later tables
  get the same `select, insert, update, delete` baseline.
- New functions are executable by nobody except their owner and `service_role`: the global
  `PUBLIC` execute default is revoked for `postgres`, and so is the per-schema `authenticated`
  default. Each new RPC must `grant execute on function … to authenticated` explicitly;
  cron-only functions get no grant to `authenticated` (`charge_due_appointments` is
  explicitly granted to `service_role` only).

## Test helpers and seeds (local only)

`supabase/seeds/test_helpers.sql` creates schema `tests` with `tests.create_user`,
`tests.authenticate_as`, `tests.authenticate_as_service_role` and `tests.clear_authentication`
(see [harness.md](harness.md#testing)). `supabase/seeds/dev.sql` adds the local trainer
(`trainer@amrap.local` / `password`), a linked customer (`ana@amrap.local` / `password`, one
8-credit top-up), an invited customer (token `dev-invite-token`) and two slot templates. Seeds
run only on `supabase db reset`; they are never pushed to the remote project.
