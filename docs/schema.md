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
| `20261023192556_recurring_and_jobs.sql` | `book()` replaced to check blocked periods by interval overlap; `appointments_rule_id_starts_at_idx`; `materialize_rule()`, `materialize_recurring()`, `activate_rule()`, `deactivate_rule()` and their grants; `slot_occupancy` view; the `pg_cron` extension and both job schedules ([jobs.md](jobs.md)). |
| `20261023214654_notifications_and_reminders.sql` | The `pg_net` extension (schema `extensions`); `notification_kind` enum; `notifications` table; `push_config()`, `dispatch_notifications()`, `claim_notifications()`, `send_cutoff_reminders()` and their grants; the `send_cutoff_reminders` schedule ([jobs.md](jobs.md), [notifications.md](notifications.md)). |
| `20261023215339_event_notifications.sql` | `enqueue_notification()`, the trigger functions `notify_booking_created()`, `notify_booking_cancelled()`, `notify_credit_change()` and their triggers on `appointments` and `credit_transactions`; the https-only check on `push_subscriptions.endpoint`; `save_push_subscription()`; grants ([notifications.md](notifications.md#event-notifications)). |
| `20261024193349_data_retention.sql` | `prune_cron_history()` and its grants; the `prune_cron_history` schedule that keeps the pg_cron run log to 14 days ([jobs.md](jobs.md), [ADR 0013](adr/0013-data-retention.md)). |
| `20261024221416_trainer_cancel_reason.sql` | `appointments.cancel_reason` and its check; the `appointment_cancelled_by_trainer` notification kind; `cancel(uuid)` dropped and recreated as `cancel(uuid, text default null)` with the same grants; `notify_cancelled_by_trainer()` and its trigger ([rpcs.md](rpcs.md#cancel), [notifications.md](notifications.md#event-notifications), [ADR 0015](adr/0015-trainer-cancel-notifies-customer.md)). |
| `20261024222414_cancel_occurrence.sql` | `cancel_occurrence()` and its grants; `book()` and `materialize_rule()` replaced to take the advisory lock before the blocked-period check ([rpcs.md](rpcs.md#cancel_occurrence), [ADR 0016](adr/0016-cancel-occurrence-closes-it.md)). |
| `20261119123322_customer_booking_switch.sql` | `settings.late_cancel_hours` default and current value 8; `settings.customer_booking_enabled`; `book()` replaced to refuse customer bookings while that setting is false ([rpcs.md](rpcs.md#book), [ADR 0018](adr/0018-customers-do-not-book-in-first-release.md)). |
| `20261119125501_undo_cancel.sql` | `undo_cancel()` and its grants: a customer restores their own free cancel before the cutoff ([rpcs.md](rpcs.md#undo_cancel)). |
| `20261119131643_booking_restored_notification.sql` | The `booking_restored` notification kind; `notify_booking_restored()` and its trigger; `notify_booking_cancelled()` replaced to delete the appointment's earlier `booking_cancelled` row first, so a repeat cancel is pushed again ([rpcs.md](rpcs.md#helpers), [notifications.md](notifications.md#repeat-cancel-and-undo)). |

## Enums

| Enum | Values |
|---|---|
| `customer_role` | `trainer`, `customer` |
| `appointment_status` | `booked`, `charged`, `cancelled`, `cancelled_late`, `cancelled_by_trainer` |
| `appointment_source` | `recurring`, `self_booked`, `trainer` |
| `transaction_type` | `topup`, `session`, `late_cancel`, `refund`, `adjustment` |
| `notification_kind` | `cutoff_reminder`, `booking_created`, `booking_cancelled`, `credit_topup`, `credit_adjustment`, `appointment_cancelled_by_trainer`, `booking_restored` |

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
| `cancel_reason` | text | the trainer's reason for a `cancelled_by_trainer` appointment, else null; check: null or 1-200 characters with no leading or trailing whitespace (`cancel()` trims and turns blank into null) |
| `created_at` | timestamptz | |

Indexes:

- `appointments_one_live_booking_idx` — unique `(customer_id, starts_at) where status in
  ('booked','charged')`: one live booking per customer per start time; cancelled rows do not
  block rebooking.
- `appointments_slot_template_id_starts_at_idx` — `(slot_template_id, starts_at)`, slot
  occupancy for the capacity check.
- `appointments_status_starts_at_idx` — `(status, starts_at)`, the charge job's scan.
- `appointments_rule_id_starts_at_idx` — unique `(rule_id, starts_at) where rule_id is not
  null`, any status: one instance per recurring rule per start, so materialization is
  idempotent and never recreates an instance that was cancelled.

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

A time range (holiday, closure) in which booking is not allowed. The trainer adds one in
Settings, or `cancel_occurrence()` adds one for exactly the occurrence it cancels (ADR 0016).

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
| `late_cancel_hours` | int | not null, default 8, check `>= 0`; the cutoff |
| `customer_booking_enabled` | boolean | not null, default false; when false, `book()` refuses customers (`AMRAP_BOOKING_DISABLED`) |
| `timezone` | text | not null, default `Europe/Ljubljana`; the gym's timezone |

### push_subscriptions

Web Push subscriptions, one per device/browser endpoint. Owned by an auth user, so it reaches
a customer only through `customers.auth_user_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | not null, references `auth.users(id)` on delete cascade |
| `endpoint` | text | not null, unique, must start with `https://` (`push_subscriptions_endpoint_https_check`) |
| `p256dh` | text | not null, subscription public key |
| `auth` | text | not null, subscription auth secret |
| `created_at` | timestamptz | |

Index `push_subscriptions_user_id_idx` on `(user_id)`. The app saves rows through
`save_push_subscription()` ([rpcs.md](rpcs.md#save_push_subscription)), which moves an existing
endpoint to the caller, and deletes its own rows directly (RLS). The `send-push` edge function
deletes rows the push service reports gone.

### notifications

The notification log: one row per push the database decided to send ([notifications.md](notifications.md),
ADR 0009). Written only by `security definer` functions; nobody reads or writes it through the
API.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `customer_id` | uuid | not null, references `customers(id)` on delete cascade; the recipient |
| `kind` | `notification_kind` | not null |
| `appointment_id` | uuid | references `appointments(id)` on delete cascade; set for appointment kinds |
| `transaction_id` | uuid | references `credit_transactions(id)` on delete cascade; set for credit kinds |
| `data` | jsonb | not null, default `{}`; what the service worker renders (per kind in notifications.md) |
| `created_at` | timestamptz | not null, default `now()` |
| `dispatched_at` | timestamptz | set once by `claim_notifications()`; null until the edge function claims the row |

Unique `notifications_kind_appointment_id_key` on `(kind, appointment_id)`: one notification of
a kind per appointment at a time (nulls are distinct, so rows without an appointment never
collide). Only the `booking_cancelled` and `booking_restored` triggers delete their earlier row
first, so a repeat cancel or undo is pushed again
([notifications.md](notifications.md#repeat-cancel-and-undo)). Index `notifications_created_at_idx` on `(created_at)` for the 30-day pruning in
`send_cutoff_reminders()`.

Foreign keys not listed with an `on delete` action use the default (no action): customers,
slot templates, rules and appointments with dependent rows cannot be deleted, which keeps the
ledger intact. Deactivate instead (`active = false`).

## Triggers

Notification triggers (ADR 0009, [notifications.md](notifications.md#event-notifications)), all
`for each row`, executing `security definer` functions that never raise:

| Trigger | Table | Fires | Function |
|---|---|---|---|
| `appointments_notify_booking_created` | `appointments` | `after insert` when `new.source = 'self_booked'` | `notify_booking_created()` |
| `appointments_notify_booking_cancelled` | `appointments` | `after update of status` when `old.status = 'booked'` and `new.status in ('cancelled', 'cancelled_late')` | `notify_booking_cancelled()` |
| `appointments_notify_cancelled_by_trainer` | `appointments` | `after update of status` when `old.status in ('booked', 'charged')` and `new.status = 'cancelled_by_trainer'` | `notify_cancelled_by_trainer()` |
| `appointments_notify_booking_restored` | `appointments` | `after update of status` when `old.status = 'cancelled'` and `new.status = 'booked'` | `notify_booking_restored()` |
| `credit_transactions_notify_credit_change` | `credit_transactions` | `after insert` when `new.type in ('topup', 'adjustment')` | `notify_credit_change()` |

## Views

### customer_balances

`(customer_id uuid, balance bigint)`: `coalesce(sum(amount), 0)` per customer over `customers
left join credit_transactions`, so a customer without transactions has balance 0. Created
`with (security_invoker = true)`, so the caller's RLS applies: a customer sees only their own
row, the trainer sees all. Read-only (`select` only for `authenticated`). A debtor is a row with
`balance < 0`.

### slot_occupancy

`(slot_template_id uuid, starts_at timestamptz, booked_count bigint)`: the number of
appointments with status `booked` or `charged` per slot template and start (ad-hoc
appointments, without a template, are not counted), so the customer calendar can show
remaining capacity (`capacity - booked_count`). Unlike `customer_balances` it is **not**
`security_invoker`: it runs as its owner, so it counts every customer's appointments, and it
exposes counts only, never a customer id or name. Rows are returned only when the caller is
linked: `where (select current_customer_id()) is not null or (select is_trainer())`, so an
auth user without a customer record sees nothing. `select` is granted to `authenticated` and
`service_role` (insert, update and delete revoked, matching `customer_balances`); `anon` has
nothing. `service_role` (and any caller without a JWT) gets zero rows, since both helpers
return null/false without `auth.uid()`; its grant is only for parity with `customer_balances`.
The dashboard's Security Advisor reports it as a "security definer view"; that is intended
([ADR 0008](adr/0008-recurrence-and-occupancy.md)), the filter above and the count-only
columns are the guard.

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
| `notifications` | none | none |
| `customer_balances` (view) | all rows via invoker RLS | own row via invoker RLS |
| `slot_occupancy` (view) | all counts (owner view, gated on a linked caller) | all counts, no identities |

Customers have no insert, update or delete policy on any table except `push_subscriptions`;
such writes affect zero rows (update/delete) or fail with `42501` (insert). The shared reference
tables (`slot_templates`, `blocked_periods`, `settings`) and `push_subscriptions` additionally
require `current_customer_id() is not null`, so an auth user without a customer record (public
sign-up without an invite) can neither read nor write any row.

## Grants

- `anon`: nothing. `revoke all on all tables in schema public from anon`; execute on the helpers
  revoked from `public` and `anon`.
- `authenticated`: `select, insert, update, delete` on every table (RLS decides rows),
  `select` only on `customer_balances` and `slot_occupancy`. No `truncate`, `references`, `trigger` or `maintain`.
- `notifications`: RLS enabled with no policy, and every privilege revoked from `anon` and
  `authenticated`, so the trainer cannot read it either (SQLSTATE `42501`). Only the owner's
  `security definer` functions and `service_role` touch it.
- `service_role`: Supabase defaults (bypasses RLS); used by server-side jobs.
- Default privileges for objects that `postgres` (migrations) creates revoke everything on
  tables, sequences and functions in `public` from `anon`, and
  `truncate`/`references`/`trigger`/`maintain` on tables from `authenticated`, so later tables
  get the same `select, insert, update, delete` baseline.
- New functions are executable by nobody except their owner and `service_role`: the global
  `PUBLIC` execute default is revoked for `postgres`, and so is the per-schema `authenticated`
  default. Each new RPC must `grant execute on function … to authenticated` explicitly;
  cron-only functions get no grant to `authenticated` (`charge_due_appointments` is
  explicitly granted to `service_role` only). `materialize_recurring` runs from cron too but
  is also the trainer's, so it is granted to `authenticated` and checks the role inside;
  the helper `materialize_rule` has execute revoked from everyone but its owner.

## Test helpers and seeds (local only)

`supabase/seeds/test_helpers.sql` creates schema `tests` with `tests.create_user`,
`tests.authenticate_as`, `tests.authenticate_as_service_role` and `tests.clear_authentication`
(see [harness.md](harness.md#testing)). `supabase/seeds/dev.sql` adds the local trainer
(`trainer@amrap.local` / `password`), a linked customer (`ana@amrap.local` / `password`, one
8-credit top-up), an invited customer (token `dev-invite-token`, valid 7 days from the reset)
and two slot templates (Monday 07:00 with the defaults, Wednesday 18:00 for 90 minutes with
capacity 4). It also creates the two Vault secrets push needs locally (ADR 0009):
`amrap_functions_url` = `http://host.docker.internal:54321/functions/v1` (the host's API port as
seen from the db container) and `amrap_push_secret` = `local-push-secret`, a placeholder the local
edge function's `PUSH_SECRET` must equal. The hosted values are set by hand
([runbook.md](runbook.md#turn-on-push-notifications)). `test_helpers.sql` loads first because `dev.sql` uses `tests.create_user`. Seeds
run only on `supabase db reset`; they are never pushed to the remote project.
