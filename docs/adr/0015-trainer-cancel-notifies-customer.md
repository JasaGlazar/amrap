# 0015. A trainer cancel notifies the customer, with an optional reason

Status: Accepted
Date: 2026-10-25

## Context

Until Stage 11 a trainer cancel (`cancel()` by the trainer, `deactivate_rule()`) was silent:
ADR 0009's triggers notified the trainer of a customer's booking or cancel and the customer of
credit changes, but `docs/notifications.md` listed trainer cancels among the things that notify
nobody, because `PLAN.md` did not ask for it. The owner answered open question 1 of issue #7 in
issue #18: the customer must be told, and the trainer wants to be able to say why.

Forces:

- Push is best effort and optional (ADR 0009): many customers will have no device subscribed, so
  the reason must also live on the appointment, where the customer's history can show it.
- `cancel()` is called by customers too. A reason from a customer has no reader (the trainer is
  notified of customer cancels without one) and no UI.
- `cancel()` inserts the refund for a charged appointment after the status update, so a row
  trigger on the status change runs before the refund row exists.
- `deactivate_rule()` cancels all of a rule's future booked instances in one statement.

## Decision

- `appointments.cancel_reason text`, null or 1-200 characters without surrounding whitespace
  (a check constraint). `cancel(p_appointment_id uuid, p_reason text default null)` replaces
  `cancel(uuid)` (drop and create, same grants), so existing one-argument calls resolve to it.
  The trainer's reason is trimmed, blank becomes null and over 200 characters is
  `AMRAP_INVALID_ARGUMENT`. A customer who passes a reason, even an empty one, is rejected with
  `AMRAP_FORBIDDEN` rather than having it ignored: the app never sends one, so a reason from a
  customer is a client bug or a hand-made call, and refusing it is visible and testable.
- A new kind, `appointment_cancelled_by_trainer`, enqueued by the trigger
  `appointments_notify_cancelled_by_trainer` on `booked` or `charged` → `cancelled_by_trainer`,
  for the appointment's customer, through `enqueue_notification()` (no account or no device:
  nothing is recorded). Data: `appointment_id`, `starts_at`, `timezone`, `refunded`, `reason`.
  `refunded` is `old.status = 'charged'`, which holds because every trainer cancel of a charged
  appointment refunds it in the same transaction; it does not depend on trigger order.
- `deactivate_rule()` notifies too, one notification per cancelled instance, without a reason.
  Materialization keeps four weeks, so a rule has at most about five future instances; a
  summary per rule would need a second kind and its own key for little gain. The service
  worker's tag is per appointment, so the customer sees each cancelled date.
- The trainer is still not notified of their own cancels.
- Like every notification trigger, a failure is caught (`raise warning`) and never fails the
  cancel.

## Consequences

- The customer's **Zgodovina** and the trainer's customer detail show the reason under the
  "Odpovedal trener" row, so a customer without push still learns why.
- Hosted push needs the redeployed `send-push` for the new kind's URL (until then it opens `/`)
  and the app build for its copy; until push is turned on (issue #5) nothing is sent anyway.
- A future "cancel many" feature (Stage 11's whole-session cancel, ADR 0016) gets the
  notifications for free by moving appointments to `cancelled_by_trainer` with
  `cancel_reason` in the same update.
- Adding an enum value is not usable inside the migration that adds it; the migration only
  references it from function bodies, which resolve it when they run.
