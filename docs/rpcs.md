# RPC reference

Every credit and capacity mutation goes through a Postgres function called over PostgREST
(`supabase.rpc(...)`). The migrations are the exact definition; this page is the contract the
app relies on.

## Conventions

- Every RPC is `language plpgsql security definer set search_path = ''` and runs in the
  caller's transaction, so each call is all-or-nothing.
- **Role check, always explicit.** `public.is_trainer()` decides whether the caller is the
  trainer. A customer may act only on their own record (`public.current_customer_id()`). An
  auth user without a `customers` row is neither, so every RPC except `accept_invite` rejects
  them with `AMRAP_FORBIDDEN`.
- **Errors.** Every rejection is `raise exception` with SQLSTATE `P0001` and a message of the
  form `AMRAP_<CODE>: <English detail>`. The app maps the token before the colon to Slovenian
  copy in `app/src/i18n/sl.ts`; the detail after it is for logs only and may change.
- **Grants.** The initial migration revoked default execute, so each RPC below is granted
  explicitly to `authenticated` and `service_role` (never `anon`), except the job functions
  `charge_due_appointments()`, `send_cutoff_reminders()` and `prune_cron_history()` and the edge function's
  `claim_notifications()`, which have no grant to `authenticated` or `anon` (`service_role`
  only), and `save_push_subscription()`, which is granted to `authenticated` only (it acts on
  the caller's auth user, so `service_role` has no use for it). The grant is not the protection: `materialize_recurring()` is granted to
  `authenticated` so the trainer can call it, and its role check inside rejects everyone else.
  The private helpers `materialize_rule()`, `push_config()`, `dispatch_notifications()` and
  `enqueue_notification()` and the notification trigger functions are granted to nobody.
- Times are `timestamptz`. Weekday and start time of a slot template are interpreted in
  `settings.timezone` (weekday 0 = Monday, see [schema.md](schema.md#slot_templates)).

## Error tokens

| Token | Meaning | Raised by |
|---|---|---|
| `AMRAP_FORBIDDEN` | The caller's role does not allow this call, a customer acts on someone else's record or gives a cancel reason (`cancel`), or (`accept_invite`) there is no signed-in user | all except `charge_due_appointments`, `send_cutoff_reminders`, `prune_cron_history` and `claim_notifications` |
| `AMRAP_INVALID_ARGUMENT` | A required argument is missing, out of range, or not allowed in this combination (for `create_invite`: the record is not a customer record; for `cancel` and `cancel_occurrence`: a reason over 200 characters) | `book`, `cancel`, `cancel_occurrence`, `top_up`, `adjust`, `create_invite`, `materialize_recurring`, `save_push_subscription` |
| `AMRAP_NOT_FOUND` | The referenced customer, slot template, appointment or recurring rule does not exist | `book`, `cancel`, `cancel_occurrence`, `top_up`, `adjust`, `create_invite`, `activate_rule`, `deactivate_rule` |
| `AMRAP_SLOT_INACTIVE` | The slot template is deactivated | `book`, `cancel_occurrence` |
| `AMRAP_IN_PAST` | A customer tried to book a start that is not in the future | `book` |
| `AMRAP_SLOT_MISMATCH` | The start is not on the template's weekday and start time (in `settings.timezone`), so it is not an occurrence | `book`, `cancel_occurrence` |
| `AMRAP_BLOCKED` | The appointment `[starts_at, ends_at)` overlaps a blocked period (`cancel_occurrence`: the occurrence is already closed) | `book`, `cancel_occurrence` |
| `AMRAP_CAPACITY_FULL` | The slot occurrence already has `capacity` live appointments | `book` |
| `AMRAP_ALREADY_BOOKED` | The customer already has a live (`booked`/`charged`) appointment at that start | `book` |
| `AMRAP_INVITE_INVALID` | The invite token is unknown, empty, replaced by a newer invite, already redeemed (redeeming clears it) or expired | `accept_invite` |
| `AMRAP_INVITE_USED` | The token belongs to a customer record that is already linked | `accept_invite` |
| `AMRAP_ALREADY_LINKED` | The customer record already has an account (`create_invite`), or the caller is already linked to a customer (`accept_invite`) | `create_invite`, `accept_invite` |
| `AMRAP_BOOKING_DISABLED` | A customer tried to book while customer booking is turned off (`settings.customer_booking_enabled` is false) | `book` |
| `AMRAP_SETTINGS_MISSING` | The `settings` row (`id = 1`) is missing, so the timezone or cutoff is unknown; the call fails closed | `book` (customer, or trainer with a template), `cancel` (customer), `cancel_occurrence`, `materialize_recurring` (when there is an active rule) |
| `AMRAP_NOT_CANCELLABLE` | The appointment is not in a state the caller may cancel (customer: not `booked` or already started; anyone: already cancelled) | `cancel` |

## book

```sql
public.book(p_customer_id uuid, p_starts_at timestamptz,
            p_slot_template_id uuid default null, p_ends_at timestamptz default null) returns uuid
```

- **Who may call:** a customer for themselves (`p_customer_id = current_customer_id()`), or the
  trainer for any customer.
- **Rules, in the order they are checked:**
  1. A customer may book only themselves (`AMRAP_FORBIDDEN`).
  2. A customer may book only while `settings.customer_booking_enabled` is true
     (`AMRAP_BOOKING_DISABLED`); a missing `settings` row fails closed
     (`AMRAP_SETTINGS_MISSING`). The trainer skips this check. (Since
     `20261119123322_customer_booking_switch.sql`, [ADR 0018](adr/0018-customers-do-not-book-in-first-release.md).)
  3. Arguments (`AMRAP_INVALID_ARGUMENT`): `p_customer_id` and `p_starts_at` are required. A
     customer must pass `p_slot_template_id`. `p_ends_at` is allowed only without a template
     (ad hoc, trainer only), and then it is required and must be after `p_starts_at`. With a
     template the duration always comes from the template.
  4. The customer must exist (`AMRAP_NOT_FOUND`).
  5. With a template: it must exist (`AMRAP_NOT_FOUND`) and be active (`AMRAP_SLOT_INACTIVE`);
     for a customer `p_starts_at` must be in the future (`AMRAP_IN_PAST`; the trainer may book
     past occurrences); `p_starts_at` in `settings.timezone` must fall on the template's
     `weekday` (`isodow - 1`) at its `start_time` (`AMRAP_SLOT_MISMATCH`). If the `settings`
     row is missing the call fails closed (`AMRAP_SETTINGS_MISSING`).
     DST: a `start_time` inside the autumn fall-back hour (02:00–03:00 local) occurs twice, so
     it maps to two instants and both match; a `start_time` inside the spring-forward gap does
     not exist that day, so no instant matches and that occurrence cannot be booked from the
     template (the trainer can book it ad hoc).
  6. With a template: takes `pg_advisory_xact_lock(hashtext(template_id || '@' ||
     epoch(p_starts_at)))`, so concurrent bookings of one occurrence, materialization and
     `cancel_occurrence()` are serialized. (The lock key uses the epoch rather than
     `p_starts_at::text` so it does not depend on the session's `TimeZone`.) Since
     `20261024222414_cancel_occurrence.sql` the lock comes before the blocked check, so a
     booking that waited on a `cancel_occurrence()` sees the blocked period it committed.
  7. The appointment must not overlap a blocked period: `tstzrange(p_starts_at, ends_at) &&
     tstzrange(b.starts_at, b.ends_at)`, both half-open, where `ends_at` is the start plus the
     template's duration or `p_ends_at` (`AMRAP_BLOCKED`). An appointment that starts before a
     blocked period but runs into it is rejected; one that ends exactly when the period starts
     is allowed. Applies to the trainer and to ad-hoc bookings too. (Since
     `20261023192556_recurring_and_jobs.sql`; before, only the start was checked.)
  8. With a template: counts appointments of that template at that start with status `booked`
     or `charged`. If the count is `>= capacity` the booking fails (`AMRAP_CAPACITY_FULL`), for
     the trainer too. Ad-hoc bookings have no capacity.
  9. Insert; a second live booking of the same customer at the same start hits
     `appointments_one_live_booking_idx` and is reported as `AMRAP_ALREADY_BOOKED`.
- **Side effects:** inserts one `appointments` row: `status = 'booked'`,
  `source = 'trainer'` when the trainer calls, else `'self_booked'`;
  `ends_at = p_starts_at + duration_minutes` with a template, else `p_ends_at`. No credit
  transaction (the charge happens at session start, see [jobs.md](jobs.md)). Returns the
  appointment id.
- **Diagram:** [architecture/booking-sequence.md](architecture/booking-sequence.md).

## cancel

```sql
public.cancel(p_appointment_id uuid, p_reason text default null) returns void
```

- **Who may call:** a customer for their own appointment, or the trainer for any. One
  function with a default, so a call with only `p_appointment_id` (the customer's) resolves to
  it. Before `20261024221416_trainer_cancel_reason.sql` it was `cancel(uuid)`; that migration
  dropped it and created this one with the same grants.
- **Locking:** reads the appointment with `select ... for update` before looking at its
  status, so a cancel and `charge_due_appointments()` on the same row are serialized: exactly
  one of them wins (ADR 0002). The partial unique index on `credit_transactions` is the final
  guard (ADR 0003).
- **Rules:**
  - The appointment must exist (`AMRAP_NOT_FOUND`); an auth user without a customer record is
    rejected first (`AMRAP_FORBIDDEN`).
  - **Reason** (ADR 0015): only the trainer may pass `p_reason`; a customer who passes one,
    even an empty string, is rejected with `AMRAP_FORBIDDEN` before the appointment is read.
    The trainer's reason is trimmed (spaces, tabs, line breaks); a blank one is stored as null;
    longer than 200 characters after trimming is `AMRAP_INVALID_ARGUMENT`.
  - **Customer:** must own it (`AMRAP_FORBIDDEN`). Status must be `booked` and `starts_at`
    must still be in the future, else `AMRAP_NOT_CANCELLABLE` (covers charged, started but not
    yet charged, and every cancelled status). With `cutoff = settings.late_cancel_hours`
    (missing `settings` row → `AMRAP_SETTINGS_MISSING`, so a cancel is never charged by
    default):
    - `now() < starts_at - cutoff` → status `cancelled`, no transaction (free);
    - otherwise → status `cancelled_late` and one `late_cancel` transaction (−1,
      `created_by = auth.uid()`). The balance may go negative; that is allowed and shown.
  - **Trainer:** status `booked` → `cancelled_by_trainer`, no transaction. Status `charged` →
    `cancelled_by_trainer` plus one `refund` transaction (+1, `appointment_id` set,
    `created_by = auth.uid()`), so the appointment nets to zero. Both set `cancel_reason` in
    the same update as the status. Any cancelled status
    (`cancelled`, `cancelled_late`, `cancelled_by_trainer`) → `AMRAP_NOT_CANCELLABLE`. To waive
    a late-cancel charge the trainer calls `adjust(customer, 1, note)` instead.
- **Side effects:** updates the appointment's `status` and sets `cancelled_at = now()` (and
  `cancel_reason` for the trainer); inserts at most one transaction as described. A cancelled
  appointment no longer counts toward the slot's capacity, so `book()` can fill its place. A
  customer's cancel notifies the trainer (`booking_cancelled`), a trainer's cancel notifies the
  customer (`appointment_cancelled_by_trainer`, with `refunded` and the reason), both by
  trigger and best effort ([notifications.md](notifications.md#event-notifications)); the
  trainer is never notified of their own cancel.
- **Diagrams:** [architecture/appointment-states.md](architecture/appointment-states.md),
  [architecture/charging-sequence.md](architecture/charging-sequence.md).

## cancel_occurrence

```sql
public.cancel_occurrence(p_template_id uuid, p_starts_at timestamptz, p_reason text default null)
  returns int
```

Cancels one occurrence of a slot template with all its bookings and closes it (issue #19,
[ADR 0016](adr/0016-cancel-occurrence-closes-it.md)). Defined in
`20261024222414_cancel_occurrence.sql`.

- **Who may call:** the trainer only (`AMRAP_FORBIDDEN` otherwise).
- **Rules, in the order they are checked:**
  1. `p_template_id` and `p_starts_at` are required; the reason is trimmed like `cancel()`'s
     (blank → null) and may have at most 200 characters (`AMRAP_INVALID_ARGUMENT`).
  2. The template must exist (`AMRAP_NOT_FOUND`) and be active (`AMRAP_SLOT_INACTIVE`).
  3. `p_starts_at` in `settings.timezone` must fall on the template's weekday at its
     `start_time`, exactly as in `book()` (`AMRAP_SLOT_MISMATCH`; missing settings row →
     `AMRAP_SETTINGS_MISSING`). The occurrence is `[p_starts_at, p_starts_at +
     duration_minutes)`.
  4. Takes `book()`'s advisory lock for the occurrence (`hashtext(template_id || '@' ||
     epoch(p_starts_at))`).
  5. The occurrence must not already overlap a blocked period (`AMRAP_BLOCKED`): it is already
     closed, and a second call is rejected rather than adding a second period. A blocked period
     added in Settings does not cancel the bookings inside it (open question 3 in issue #7), so
     such bookings are cancelled one by one with `cancel()`.
  6. Past occurrences are allowed, as in `cancel()` for the trainer (for example a session the
     trainer missed that the charge job already charged); an occurrence without bookings is
     allowed too and is only closed.
- **Side effects, one transaction:** every `booked` appointment of the template at
  `p_starts_at` becomes `cancelled_by_trainer` with `cancelled_at = now()` and
  `cancel_reason`; then every `charged` one too, each with one `refund` (+1, `created_by =
  auth.uid()`), exactly as `cancel()` does for the trainer. Booked first, so one the charge
  job charges meanwhile (its `for update skip locked` skips rows this call holds; if it held the
  row first, this update waits and skips it) is caught by the charged step. Appointments
  already cancelled, other occurrences and ad-hoc appointments at the same time are untouched,
  and so are live bookings of **another template whose occurrence overlaps** the closed period:
  they stay `booked`/`charged`, get no refund and no notification, and are cancelled one by
  one with `cancel()`; the blocked period does close that occurrence for new bookings (the app
  warns before confirming, [screens.md](screens.md#calendar-tkoledar)).
  Then inserts one `blocked_periods` row `[p_starts_at, p_starts_at + duration)` with the
  reason, so `book()` and materialization skip the occurrence. Each cancelled appointment
  notifies its customer through the trainer-cancel trigger
  ([notifications.md](notifications.md#event-notifications)), with `refunded` and the reason.
- **Returns:** the number of appointments cancelled (booked plus charged).
- **Reopening:** delete the blocked period (Settings → **Zaprta obdobja**); the cancelled
  bookings stay cancelled.
- **Diagram:** [architecture/appointment-states.md](architecture/appointment-states.md).

## top_up

```sql
public.top_up(p_customer_id uuid, p_amount int, p_note text default null) returns uuid
```

- **Who may call:** the trainer only.
- **Rules:** `p_amount > 0`; the customer must exist.
- **Errors:** `AMRAP_FORBIDDEN` (not the trainer), `AMRAP_INVALID_ARGUMENT` (amount null or
  `<= 0`), `AMRAP_NOT_FOUND` (no such customer).
- **Side effects:** inserts one `credit_transactions` row: `type = 'topup'`,
  `amount = p_amount`, `created_by = auth.uid()`, `note = p_note`. Returns its id.

## adjust

```sql
public.adjust(p_customer_id uuid, p_amount int, p_note text default null) returns uuid
```

- **Who may call:** the trainer only.
- **Rules:** `p_amount <> 0` (either sign); the customer must exist. This is also how the
  trainer waives a late-cancel charge: `adjust(customer, 1, note)`.
- **Errors:** `AMRAP_FORBIDDEN` (not the trainer), `AMRAP_INVALID_ARGUMENT` (amount null or
  0), `AMRAP_NOT_FOUND` (no such customer).
- **Side effects:** inserts one `credit_transactions` row: `type = 'adjustment'`,
  `amount = p_amount`, `created_by = auth.uid()`, `note = p_note`. Returns its id.

## create_invite

```sql
public.create_invite(p_customer_id uuid) returns text
```

- **Who may call:** the trainer only.
- **Rules:** the customer must exist, must not be linked (`auth_user_id is null`) and must have
  `role = 'customer'` (an unlinked trainer record cannot be invited, because redeeming the token
  would hand out trainer access). Locks the customer row. Calling it again for a pending
  invite issues a new token and the old one stops working.
- **Errors:** `AMRAP_FORBIDDEN` (not the trainer), `AMRAP_NOT_FOUND` (no such customer),
  `AMRAP_ALREADY_LINKED` (the customer already has an account), `AMRAP_INVALID_ARGUMENT` (the
  record's role is not `customer`).
- **Side effects:** sets `invite_token = encode(extensions.gen_random_bytes(24), 'hex')` (48 hex
  characters) and `invite_expires_at = now() + interval '7 days'`. Returns the token, which the
  app turns into the invite link.
- **Re-linking:** a linked customer who lost access is re-linked by deleting their auth user in
  the dashboard (`on delete set null` clears `auth_user_id`), then calling `create_invite`
  again; see ADR 0007 and `docs/runbook.md` "Re-link a customer".
- **Diagram:** [architecture/auth-invite-flow.md](architecture/auth-invite-flow.md).

## accept_invite

```sql
public.accept_invite(p_token text) returns uuid
```

- **Who may call:** any signed-in (`authenticated`) user, typically one who just signed up
  through the invite link and has no customer record yet.
- **Rules, in order:** a signed-in user is required (`AMRAP_FORBIDDEN`, e.g. service role
  without a user). The customer row is looked up by `invite_token = p_token` and locked
  `for update`, so two concurrent redemptions cannot both win. No row, or
  `invite_expires_at <= now()` → `AMRAP_INVITE_INVALID`. The row is already linked →
  `AMRAP_INVITE_USED`. The caller is already linked to a customer → `AMRAP_ALREADY_LINKED`;
  this also covers the same user redeeming two tokens concurrently, where the second update
  hits the unique `auth_user_id` and the `unique_violation` is reported as
  `AMRAP_ALREADY_LINKED` rather than a raw `23505`.
- **Single use:** a successful accept clears the token, so a second use of the same token finds
  no row and is rejected with `AMRAP_INVITE_INVALID`. `AMRAP_INVITE_USED` only occurs if a
  linked record still carries a token (for example after a direct trainer edit).
- **Side effects:** sets `auth_user_id = auth.uid()`, `invite_token = null`,
  `invite_expires_at = null`. Returns the customer id. From then on `current_customer_id()` and
  `is_trainer()` resolve for that user.
- **Diagram:** [architecture/auth-invite-flow.md](architecture/auth-invite-flow.md).

## charge_due_appointments

```sql
public.charge_due_appointments() returns int
```

- **Who may call:** pg_cron (as `postgres`, every 15 minutes, see [jobs.md](jobs.md#schedules)) and `service_role` only. There is no role check
  inside; `execute` is revoked from `public`, `anon` and `authenticated`, so a signed-in user
  (trainer included) gets SQLSTATE `42501`.
- **Rules:** every appointment with `status = 'booked'` and `starts_at <= now()`, locked with
  `for update skip locked` (rows held by a concurrent `cancel()` are skipped and picked up by
  the next run if still booked).
- **Errors:** none of its own.
- **Side effects:** per appointment: `status = 'charged'` and one `session` transaction (−1,
  `created_by = null`). Returns the number charged. Idempotent: a second run returns 0.
  Described as a job in [jobs.md](jobs.md).
- **Diagram:** [architecture/charging-sequence.md](architecture/charging-sequence.md).

## activate_rule

```sql
public.activate_rule(p_rule_id uuid) returns int
```

- **Who may call:** the trainer only (`AMRAP_FORBIDDEN` otherwise).
- **Rules:** the rule must exist (`AMRAP_NOT_FOUND`). Sets `active = true`, then materializes
  that one rule over the default window (`materialize_rule(p_rule_id, 4)`, see
  [Helpers](#helpers)), so the customer sees the instances without waiting for the nightly
  run. A rule whose slot template is inactive is activated but materializes nothing.
- **Side effects:** updates `recurring_rules.active`; inserts `booked` instances with
  `source = 'recurring'`. Returns the number inserted. Instances that already exist for the
  rule in any status are not inserted again, so after `deactivate_rule` → `activate_rule` the
  instances the deactivation cancelled stay cancelled (the trainer rebooks one with `book()` if
  needed); only occurrences without an instance are filled.
- **Diagram:** [architecture/materialization-sequence.md](architecture/materialization-sequence.md).

## deactivate_rule

```sql
public.deactivate_rule(p_rule_id uuid) returns int
```

- **Who may call:** the trainer only (`AMRAP_FORBIDDEN` otherwise).
- **Rules:** the rule must exist (`AMRAP_NOT_FOUND`). Sets `active = false`, so later
  materialization skips it, and cancels the rule's instances with `status = 'booked'` and
  `starts_at > now()`.
- **Side effects:** those instances become `cancelled_by_trainer` with `cancelled_at = now()`
  and no reason; no credit transaction (a booked appointment has no charge to refund). Each one
  notifies the customer (`appointment_cancelled_by_trainer`, one per instance; materialization
  keeps at most about five future instances per rule, ADR 0015). Past instances
  (`charged`, or `booked` but started and not yet charged) and instances already cancelled are
  untouched. Returns the number cancelled.
- **Diagram:** [architecture/appointment-states.md](architecture/appointment-states.md).

## materialize_recurring

```sql
public.materialize_recurring(p_weeks int default 4) returns int
```

- **Who may call:** pg_cron and the service role (no signed-in user: `auth.uid() is null`), or
  the trainer (`is_trainer()`), so a new rule can be materialized from the UI right away.
  Anyone else with a JWT (a customer, an auth user without a customer record) gets
  `AMRAP_FORBIDDEN`; `anon` has no execute (`42501`). Granted to `authenticated` and
  `service_role`; the role check inside is the protection.
- **Rules:** `p_weeks` must be `>= 0` (`AMRAP_INVALID_ARGUMENT`). Runs `materialize_rule(rule,
  p_weeks)` (see [Helpers](#helpers)) for every rule with `active = true` whose slot template
  is active, in rule id order, and adds up what each inserted. Fails closed without the
  `settings` row (`AMRAP_SETTINGS_MISSING`).
- **Side effects:** inserts `appointments` rows `status = 'booked'`, `source = 'recurring'`,
  `rule_id` set (details under `materialize_rule`). No credit transaction: the charge job
  charges them at start like any booking. Returns the number inserted.
- **Idempotent:** an instance that exists for a rule and start, in any status, is never
  inserted again (`appointments_rule_id_starts_at_idx`), so a second run returns 0 and an
  instance the customer or trainer cancelled is not recreated.
- Scheduled nightly by pg_cron as `postgres`, see [jobs.md](jobs.md#schedules).
- **Diagram:** [architecture/materialization-sequence.md](architecture/materialization-sequence.md).

## send_cutoff_reminders

```sql
public.send_cutoff_reminders() returns int
```

- **Who may call:** pg_cron (as `postgres`, every 15 minutes, see [jobs.md](jobs.md#schedules))
  and `service_role` only. No role check inside; `execute` is revoked from `public`, `anon` and
  `authenticated` (SQLSTATE `42501`), the `charge_due_appointments` pattern
  ([ADR 0008](adr/0008-recurrence-and-occupancy.md)).
- **Rules:** first deletes `notifications` rows older than 30 days. Then, without push config
  (`push_config()` returns a null) or without the `settings` row, it logs (`raise log`) and
  returns 0: a cron job never raises, and nothing is recorded, so the reminder is still sent if
  the config appears while the cutoff is in the window. Otherwise it selects every appointment
  with `status = 'booked'` whose cutoff, `starts_at − late_cancel_hours · 1 h` (the same cutoff
  `cancel()` uses), is in `[now() + 45 min, now() + 75 min)`, whose customer is linked and has
  at least one `push_subscriptions` row.
- **Errors:** none of its own.
- **Side effects:** per selected appointment, one `notifications` row `kind = 'cutoff_reminder'`
  with `data = {appointment_id, starts_at, cutoff_at, timezone}`, inserted `on conflict (kind,
  appointment_id) do nothing`; then `dispatch_notifications(ids)` with the ids actually
  inserted. Returns the number inserted.
- **Idempotent:** the unique `(kind, appointment_id)` key allows one reminder per appointment,
  ever, so a second or overlapping run inserts and dispatches nothing for it (a concurrent run
  waits on the unique index and then skips). Details in [notifications.md](notifications.md).
- **Diagram:** [architecture/push-sequence.md](architecture/push-sequence.md).

## prune_cron_history

```sql
public.prune_cron_history() returns int
```

- **Who may call:** pg_cron (as `postgres`, daily at 03:07 UTC, see [jobs.md](jobs.md#schedules))
  and `service_role` only. No role check inside; `execute` is revoked from `public`, `anon` and
  `authenticated` (SQLSTATE `42501`), the `charge_due_appointments` pattern.
- **Rules:** deletes every `cron.job_run_details` row whose `end_time`, or `start_time` when the
  run never ended, is more than 14 days before `now()`; a run exactly 14 days old stays
  ([ADR 0013](adr/0013-data-retention.md)).
- **Errors:** none of its own.
- **Side effects:** the delete. Returns the number of rows deleted. Idempotent: a second run
  returns 0.

## claim_notifications

```sql
public.claim_notifications(p_ids uuid[])
  returns table (notification_id uuid, kind notification_kind, data jsonb,
                 endpoint text, p256dh text, auth text)
```

- **Who may call:** `service_role` only (the `send-push` edge function); `execute` is revoked
  from `public`, `anon` and `authenticated` (SQLSTATE `42501`). `language sql security
  definer set search_path = ''`.
- **Rules:** sets `dispatched_at = now()` on the rows of `p_ids` where it is still null and
  returns each claimed row once per push subscription of its recipient
  (`notifications.customer_id` → `customers.auth_user_id` → `push_subscriptions.user_id`).
  A row whose recipient has no subscription left is claimed and returns nothing.
- **Errors:** none of its own.
- **Side effects:** `notifications.dispatched_at`. A second call with the same ids returns no
  rows, and a concurrent call waits on the row lock and then finds it claimed, so a
  notification is pushed at most once.
- **Diagram:** [architecture/push-sequence.md](architecture/push-sequence.md).

## save_push_subscription

```sql
public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
```

- **Who may call:** a linked customer or the trainer (`current_customer_id()` is not null),
  for their own auth user; an auth user without a customer record gets `AMRAP_FORBIDDEN`.
  Granted to `authenticated` only; `anon` and `service_role` get `42501`.
- **Rules:** all three arguments are required and non-empty, and the endpoint must start with
  `https://` (`AMRAP_INVALID_ARGUMENT`; the table's check constraint enforces the same). They
  are the browser's `PushSubscription` endpoint and its `p256dh` and `auth` keys; browsers'
  push services are always https.
- **Side effects:** upserts `push_subscriptions` on `endpoint`: a new endpoint is inserted for
  `auth.uid()`; an existing one is moved to the caller with the new keys and `created_at =
  now()`. A device shared by two accounts therefore notifies whoever enabled push last
  (ADR 0009). Removing a subscription stays a plain delete of an own row (RLS).
- **Errors:** `AMRAP_FORBIDDEN`, `AMRAP_INVALID_ARGUMENT`.

## Helpers

Role helpers used by RLS policies and by every RPC's role check. Both are `language sql
stable security definer set search_path = ''`, executable by `authenticated` and
`service_role` only (revoked from `public` and `anon`). Defined in
`20261023173423_initial_schema.sql`; see [schema.md](schema.md#helpers).

- `public.current_customer_id() returns uuid` — the `customers.id` linked to `auth.uid()`, or
  null when the caller has no customer record.
- `public.is_trainer() returns boolean` — true when the caller's customer record has
  `role = 'trainer'`.

Materialization helper, defined in `20261023192556_recurring_and_jobs.sql`: `language plpgsql
security definer set search_path = ''`, executable by nobody but its owner (execute revoked
from `public`, `anon`, `authenticated` and `service_role`). It is only called by
`materialize_recurring()` and `activate_rule()`, which do the role check.

- `public.materialize_rule(p_rule_id uuid, p_weeks int) returns int` — materializes one rule
  and returns the number of appointments inserted. Returns 0 when the rule is missing or
  inactive or its template is inactive. Fails closed without the `settings` row
  (`AMRAP_SETTINGS_MISSING`). Locks the rule row `for share`, so a concurrent
  `deactivate_rule()` either runs first (the rule is then inactive here) or waits and then
  cancels what this run inserted. For each date from today through `today + p_weeks *
  7` days (local dates in `settings.timezone`, both ends included) on the template's weekday,
  in ascending order, so concurrent runs take the advisory locks below in the same order:
  1. `starts_at = (date + start_time) at time zone settings.timezone`, so Postgres picks the
     UTC offset of that date and the wall-clock time survives DST changes;
     `ends_at = starts_at + duration_minutes`.
  2. Skip when `starts_at <= now()`; or when the local time of `starts_at` is not `start_time`
     (a `start_time` inside the spring-forward gap does not exist that day; `book()` cannot
     match it either).
  3. Take the same advisory lock as `book()`:
     `pg_advisory_xact_lock(hashtext(template_id || '@' || epoch(starts_at)))`.
  4. Skip when `[starts_at, ends_at)` overlaps a blocked period (as in `book()`; checked after
     the lock since `20261024222414_cancel_occurrence.sql`, so a concurrent
     `cancel_occurrence()` is seen); when the rule already has an appointment at `starts_at`
     (any status); when the customer already has a live (`booked`/`charged`) appointment at
     `starts_at`; or when the slot occurrence already has `capacity` live appointments.
  5. Insert `status = 'booked'`, `source = 'recurring'`, `rule_id`, `slot_template_id`;
     `on conflict do nothing` covers a concurrent booking of the same customer at the same
     start through another template (another lock).

Push helpers, defined in `20261023214654_notifications_and_reminders.sql`: `security definer
set search_path = ''`, executable by nobody but their owner (execute revoked from `public`,
`anon`, `authenticated` and `service_role`). Called by `send_cutoff_reminders()` and
`enqueue_notification()`. See [notifications.md](notifications.md).

- `public.push_config() returns table (functions_url text, push_secret text)` — `language sql
  stable`; one row with the Vault secrets `amrap_functions_url` and `amrap_push_secret`
  (`vault.decrypted_secrets`), each null when missing or empty.
- `public.dispatch_notifications(p_ids uuid[]) returns void` — `language plpgsql`. Does
  nothing for a null or empty array. Without push config it logs (`raise log`) and returns.
  Otherwise it queues one `net.http_post` to `<functions_url>/send-push` with body
  `{"ids": [...]}`, headers `Content-Type: application/json` and `x-amrap-push-secret`, and a
  10 s timeout. pg_net sends it only after the calling transaction commits (a rolled-back
  caller sends nothing). Any error, including a pg_net failure, is caught and reported with
  `raise warning`, so it never aborts the caller.

Event notification helpers, defined in `20261023215339_event_notifications.sql`: `language
plpgsql security definer set search_path = ''`, executable by nobody but their owner (execute
revoked from `public`, `anon`, `authenticated` and `service_role`; a trigger needs no execute
grant for the role that fires it). See [notifications.md](notifications.md#event-notifications).

- `public.enqueue_notification(p_customer_id uuid, p_kind notification_kind, p_data jsonb,
  p_appointment_id uuid default null, p_transaction_id uuid default null) returns void` —
  without push config logs (`raise log`) and returns; returns when the recipient has no linked
  user or no push subscription; otherwise inserts the `notifications` row `on conflict (kind,
  appointment_id) do nothing` and, when a row was inserted, calls
  `dispatch_notifications(array[id])`. Any error inside it is caught and reported with
  `raise warning` (nothing is recorded then).
- `public.notify_booking_created() returns trigger` — trigger
  `appointments_notify_booking_created` (`after insert`, `source = 'self_booked'`): enqueues
  `booking_created` for the trainer (see below).
- `public.notify_booking_cancelled() returns trigger` — trigger
  `appointments_notify_booking_cancelled` (`after update of status`, `booked` → `cancelled` or
  `cancelled_late`): enqueues `booking_cancelled` for the trainer. The recipient is one
  trainer record, the earliest created one with a push subscription (ties by id), matching the
  one-row-per-`(kind, appointment_id)` key; the domain has a single trainer.
- `public.notify_credit_change() returns trigger` — trigger
  `credit_transactions_notify_credit_change` (`after insert`, `type in ('topup',
  'adjustment')`): enqueues `credit_topup` or `credit_adjustment` for the customer with the
  balance after the row, read from `customer_balances`.
- `public.notify_cancelled_by_trainer() returns trigger` — trigger
  `appointments_notify_cancelled_by_trainer` (`after update of status`, `booked` or `charged` →
  `cancelled_by_trainer`), defined in `20261024221416_trainer_cancel_reason.sql`: enqueues
  `appointment_cancelled_by_trainer` for the appointment's customer with `starts_at`,
  `timezone`, `refunded` and `reason` (`cancel_reason`). `refunded` is `old.status =
  'charged'`: the refund row is inserted after the status update, when this row trigger has
  already run, and every trainer cancel of a charged appointment refunds it.

Each trigger function, like `enqueue_notification` itself, catches every error and reports it
with `raise warning`, so a notification problem never fails `book`, `cancel`,
`deactivate_rule`, `top_up` or `adjust`.
