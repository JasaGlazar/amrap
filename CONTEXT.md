# AMRAP — Domain Context

Shared vocabulary for code, docs, tests and conversation. Use these terms exactly. UI copy is
Slovenian, but identifiers and docs use the English terms below.

## Terms

- **credit** — one prepaid session; the unit of every ledger amount. Stored as rows in `credit_transactions.amount`.
- **balance** — the sum of a customer's credits; always computed as `SUM(credit_transactions.amount)`, never stored (view `customer_balances`).
- **top-up** — a trainer-recorded purchase of credits (typically 8); a `topup` (+n) transaction created by the `top_up` RPC.
- **adjustment** — a trainer correction of a balance in either direction; an `adjustment` (±n) transaction created by the `adjust` RPC.
- **charge** — the single deduction of one credit for an appointment; a `session` or `late_cancel` transaction (−1), at most one per appointment.
- **session charge** — the charge made when a `booked` appointment reaches its start time; a `session` transaction written by `charge_due_appointments`.
- **late cancel** — a customer cancel after the cutoff; the appointment becomes `cancelled_late` and a `late_cancel` charge (−1) is written at cancel time by `cancel`.
- **refund** — a `refund` (+1) transaction inserted when the trainer cancels an appointment that was already charged; it does not count toward the one-charge rule.
- **cutoff** — the number of hours before `starts_at` after which a customer cancel is late; `settings.late_cancel_hours`, default 5.
- **slot template** — a weekly-grid entry defined by the trainer: weekday, start time, duration (default 60 minutes, any value allowed) and capacity (default 5); table `slot_templates`.
- **slot** — a concrete dated occurrence of a slot template; derived from the template and the date, with capacity counted over its `booked` and `charged` appointments.
- **appointment** — one customer's reservation of a slot or an ad-hoc time; table `appointments`, with status `booked`, `charged`, `cancelled`, `cancelled_late` or `cancelled_by_trainer`.
- **recurring rule** — the trainer's standing assignment of a customer to a slot template; table `recurring_rules`.
- **materialization** — turning active recurring rules into concrete `booked` appointments (`source = 'recurring'`) for every occurrence from today through four weeks ahead; done nightly by `materialize_recurring` (pg_cron) and on demand by the trainer. Idempotent: one instance per rule and start, ever, so a cancelled instance is not recreated. Past starts, blocked periods, full slots and starts where the customer is already booked are skipped.
- **instance** — an appointment created by materialization; it carries its rule's `rule_id`.
- **rule activation** — the trainer switching a recurring rule on (`activate_rule`, which materializes it at once) or off (`deactivate_rule`, which cancels its future `booked` instances as `cancelled_by_trainer`, without charge). Reactivating does not bring back instances that were cancelled.
- **occupancy** — the number of live (`booked` + `charged`) appointments in a slot; customers read it from the view `slot_occupancy` (counts only) to see remaining capacity.
- **ad-hoc appointment** — a trainer-created appointment with no slot template (`slot_template_id` is null, `source = 'trainer'`).
- **blocked period** — a trainer-defined time range (holiday, closure) in which booking is not allowed; table `blocked_periods`.
- **debtor** — a customer whose `customer_balances` row has balance < 0; shown in red and listed on the trainer dashboard, never blocked.
- **invite** — a single-use, expiring (7 days) token a trainer generates with `create_invite` and a customer redeems with `accept_invite` to link an account to their customer record.
- **invite status** — derived per customer record, never stored: **linked** (an auth user is linked), **pending** (an unexpired invite token exists) or **none**; shown on the trainer's customer list.
- **trainer** — the gym owner; the only user with `role = 'trainer'`, who manages the grid, credits, customers and all appointments (helper `is_trainer()`).
- **customer** — a person who trains at the gym, with a row in `customers` (role `customer`); may or may not have an app account (`auth_user_id` may be null; helper `current_customer_id()`).
- **notification** — one best-effort web push the database decided to send, recorded in `notifications` with its kind (`cutoff_reminder`, `booking_created`, `booking_cancelled`, `credit_topup`, `credit_adjustment`); at most one per kind and appointment, pushed at most once.
- **event notification** — a notification written by a trigger: the trainer's `booking_created` / `booking_cancelled` when a customer books or cancels, the customer's `credit_topup` / `credit_adjustment` when the trainer tops up or adjusts.
- **reminder** — the `cutoff_reminder` notification a customer gets 45 to 75 minutes before an appointment's cutoff (`send_cutoff_reminders`, every 15 minutes); their only warning before a booking is charged.
- **push subscription** — one browser or device's Web Push endpoint and keys for an auth user; table `push_subscriptions`, saved by `save_push_subscription` (a device belongs to whoever enabled push on it last). Deleted when the push service reports it gone (404/410).
- **install** — adding the app to the phone's home screen so it opens standalone, without the browser around it: Chrome's install prompt or browser menu on Android, Share → Add to Home Screen on iOS. Required on iOS for push; offered by the install card in both shells and dismissible per device.
- **keep-alive** — the lightweight authenticated read the frontend performs on every load so the Supabase free-tier project is not paused for inactivity.

## Rules

- One charge per appointment, enforced by a partial unique index on `credit_transactions(appointment_id)` for types `session` and `late_cancel`.
- Negative balances are allowed; they are shown, never blocked.
- Nobody logs attendance. A booked appointment that is not cancelled before the cutoff is charged.
- The trainer may cancel any `booked` or `charged` appointment at any time without charge (`cancelled_by_trainer`); an existing charge is refunded.
- A `cancelled_late` appointment cannot be cancelled again; the trainer waives a late-cancel charge with `adjust(+1, note)`.
- The balance is never stored; the ledger is the only source of truth.
- All credit and capacity mutations go through `SECURITY DEFINER` RPCs with explicit role checks.
