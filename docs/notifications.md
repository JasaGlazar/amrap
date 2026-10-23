# Notifications

Best-effort web push (VAPID) to the trainer's and customers' devices. The design and its
reasons are in [ADR 0009](adr/0009-web-push-design.md); the sequence is in
[architecture/push-sequence.md](architecture/push-sequence.md). Postgres decides who gets what
and records it in a log; one edge function, `send-push`, delivers. The functions are in
[rpcs.md](rpcs.md), the table in [schema.md](schema.md#notifications), the job in
[jobs.md](jobs.md#send_cutoff_reminders-every-15-minutes).

## Flow

1. A writer (the 15-minute job `send_cutoff_reminders()`) selects recipients and inserts
   `notifications` rows `on conflict (kind, appointment_id) do nothing returning id`.
2. It passes the ids it got back to `dispatch_notifications(ids)`, which queues one pg_net
   request `POST <functions_url>/send-push` with `{"ids": [...]}` and the header
   `x-amrap-push-secret`.
3. pg_net sends the request after the writer's transaction commits. A writer that rolls back
   sends nothing.
4. `send-push` calls `claim_notifications(ids)` with its service key, which marks the rows
   dispatched and returns them with the recipient's subscriptions, then pushes to each
   subscription. A 404 or 410 from the push service deletes that subscription.

## The log

`public.notifications` holds one row per push the database decided to send: the recipient
(`customer_id`), the `kind`, the appointment or transaction it is about, the `data` the service
worker renders, `created_at` and `dispatched_at` (set once, by the claim). It is closed to the
API (RLS on, no policy, no grants to `anon` or `authenticated`). `send_cutoff_reminders()`
deletes rows older than 30 days on every run, so the table stays small (Free Plan 500 MB).

Rows are written only when push is configured and the recipient is linked and has at least one
push subscription. Nothing is recorded otherwise, so a reminder is still sent if the config or
the customer's subscription appears while the cutoff is in the window.

## Kinds and data

| Kind | Recipient | Written by | `data` |
|---|---|---|---|
| `cutoff_reminder` | the appointment's customer | `send_cutoff_reminders()` | `appointment_id`, `starts_at`, `cutoff_at` (ISO timestamps), `timezone` (`settings.timezone`) |
| `booking_created` | the trainer | not written yet (event notifications) | - |
| `booking_cancelled` | the trainer | not written yet (event notifications) | - |
| `credit_topup` | the customer | not written yet (event notifications) | - |
| `credit_adjustment` | the customer | not written yet (event notifications) | - |

`cutoff_at` is `starts_at − late_cancel_hours · 1 h`, the same cutoff `cancel()` uses.

## No duplicates

The unique key `(kind, appointment_id)` allows one notification of a kind per appointment,
ever. A writer pushes only the ids its own insert returned, so a second run, a retry or an
overlapping run (which waits on the unique index, then skips) never sends a second reminder.
`claim_notifications` sets `dispatched_at` only where it is null, so a repeated or duplicated
call to `send-push` sends nothing either: each notification is pushed at most once. A push
that fails after the claim is not retried.

## Configuration

Two Vault secrets switch push on; `push_config()` reads them:

| Vault name | Hosted | Local (dev seed) |
|---|---|---|
| `amrap_functions_url` | `https://<project-ref>.supabase.co/functions/v1` | `http://host.docker.internal:54321/functions/v1` |
| `amrap_push_secret` | a random secret, the same value as the function's `PUSH_SECRET` | `local-push-secret` |

When either is missing or empty, `send_cutoff_reminders()` and `dispatch_notifications()` log
with `raise log` and do nothing, so the hosted project runs unchanged until the owner sets
them. The service-role key is never stored in the database. Setting them on the hosted project
is in [runbook.md](runbook.md).

## Best effort

- A failed push never fails the action that caused it: pg_net sends only after commit, and
  `dispatch_notifications()` catches every error (a malformed URL, pg_net trouble) and reports
  it with `raise warning`.
- A push can be lost (function down, push service error after the claim) and is not retried.
- pg_net keeps each response in `net._http_response` for 6 hours (`pg_net.ttl`); a request
  that reached the gateway but no function shows status 404 or 503 there.

## Testing

- `supabase/tests/030_notifications.sql`: pg_net schema, the table, its key and closed
  privileges, function grants, `push_config`, the queued request (URL, headers, body, timeout),
  no request for empty ids or without config, a failing pg_net call caught, one claim per
  notification and subscription.
- `supabase/tests/031_reminders.sql`: the reminder job, see
  [jobs.md](jobs.md#send_cutoff_reminders-every-15-minutes).
- Requests in tests go to a test-only host and roll back with the transaction, so nothing is
  sent; CI runs without the edge runtime.
