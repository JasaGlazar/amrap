# 0009. Web push through a notification log, pg_net and one edge function

Status: Accepted
Date: 2026-10-23

## Context

Stage 3 adds best-effort web push (PLAN.md): a pre-cutoff reminder to customers, the
customer's only warning before a charge, so it is required before the pilot; trainer
notifications on customer bookings and cancellations; customer notifications on top-ups and
adjustments. Constraints: Free Plan only (no Firebase, no paid push service), no committed
secrets, a failed push must never fail or roll back the booking, cancel or top-up, overlapping
or retried job runs must never send a reminder twice, the hosted project must keep working
before the owner has set any push secret, and Slovenian copy lives only in
`app/src/i18n/sl.ts`.

Checked on 2026-10-23 (Supabase docs via Context7, local stack on CLI 2.117.0):
`net.http_post` is asynchronous and starts its request only after the calling transaction
commits (default timeout 2000 ms); Vault (`vault.create_secret`, `vault.decrypted_secrets`) is
installed locally and on the hosted project; pg_net 0.20.4 is available but not installed;
edge functions get `SUPABASE_URL` and the service/secret keys by default and read their own
secrets from `supabase/functions/.env` locally and `supabase secrets set` on the hosted
project; `npm:web-push@3.6.7` encrypts (aes128gcm) and signs (VAPID) in the local edge runtime
1.74.3 (Deno 2.1.4 compatible). Not verified: how the hosted gateway treats a
`verify_jwt = false` function called without an `apikey` header.

## Decision

- **Notification log.** A table `notifications` (recipient customer, `kind`, appointment or
  transaction reference, `data jsonb`, `created_at`, `dispatched_at`) records every push the
  database decides to send, with a unique key on `(kind, appointment_id)`. A writer inserts
  with `on conflict do nothing returning id` and dispatches only the ids it got back, so
  overlapping or retried runs never produce a second row and therefore never a second push.
  Rows are written only when push is configured and the recipient has at least one
  subscription; otherwise nothing is recorded, so a reminder is still sent once the config or
  a subscription appears inside the window. Rows older than 30 days are deleted by the
  reminder job (500 MB limit).
- **Database decides, the edge function delivers.** Postgres selects recipients and builds
  `data` (times, names, amounts, timezone). A private helper posts the new ids to the edge
  function `send-push` with `net.http_post` (timeout raised to 10 s, response ignored). Because
  pg_net sends only after commit, a rolled-back booking sends nothing and a failed push cannot
  roll back anything. The helper and the trigger bodies catch every error, `raise warning`,
  and return, so even a pg_net failure never aborts the caller.
- **At most once.** The function claims its ids through `claim_notifications(ids)`, which
  sets `dispatched_at` only where it is null and returns the claimed rows with the
  recipient's subscriptions. A repeated or duplicated call claims nothing. A push that fails
  after the claim is not retried (best effort).
- **Configuration is two Vault rows.** `amrap_functions_url` (hosted
  `https://<ref>.supabase.co/functions/v1`, local `http://host.docker.internal:54321/functions/v1`)
  and `amrap_push_secret`. When either is missing, the job and the triggers log
  (`raise log`) and do nothing, so the hosted project works unchanged until the owner sets
  them. The local values are placeholders in a dev seed, like the seeded local passwords.
- **DB→function auth is a shared secret, not a JWT.** `send-push` runs with
  `verify_jwt = false` and rejects a request whose `x-amrap-push-secret` header does not equal
  its `PUSH_SECRET` secret. The service-role key is not stored in Vault: a leaked push secret
  can only trigger sending rows that are already queued and unclaimed. The function reads and
  deletes subscriptions with its default service/secret key. If the hosted gateway turns out
  to need an `apikey`, the helper adds the publishable key from a third Vault row.
- **Expired subscriptions.** A 404 or 410 from the push service deletes that subscription;
  any other error is logged and the subscription kept.
- **Structured payload, copy in the app.** The push payload is JSON `{kind, data, url}`. The
  service worker (`app/src/sw.ts`, built by vite-plugin-pwa with `strategies:
  'injectManifest'`) renders the title and body from `sl.ts`, so no Slovenian text lives in
  SQL or Deno. Per kind the function sets TTL and urgency: the reminder expires at the cutoff,
  is `high` urgency and uses the appointment as its `topic`; the others live 24 hours at
  `normal` urgency. A notification click focuses the app or opens it at `url`.
- **Reminder window.** Every 15 minutes, `booked` appointments whose cutoff
  (`starts_at − late_cancel_hours·1 h`) lies in `[now() + 45 min, now() + 75 min)` get a
  `cutoff_reminder`. The 30-minute window survives one missed run; the unique key makes the
  second selection a no-op. A missing `settings` row logs and returns 0 instead of raising.
- **Event notifications are triggers.** `after insert` on `appointments` with
  `source = 'self_booked'` notifies the trainer (`booking_created`); a status change to
  `cancelled` or `cancelled_late` notifies the trainer (`booking_cancelled`);
  `after insert` on `credit_transactions` with `type in ('topup', 'adjustment')` notifies the
  customer. Materialization (`source = 'recurring'`), trainer bookings, trainer cancels and
  charges send nothing. No RPC body changes.
- **Grants (ADR 0008 pattern).** The reminder job follows `charge_due_appointments`: no grant
  to `authenticated` or `anon`, run by pg_cron as `postgres`. `claim_notifications` is granted
  to `service_role` only. The dispatch helper and trigger functions are granted to nobody.
  `notifications` has RLS on and no policy for `authenticated`.
- **Subscriptions follow the device.** The app saves a subscription through
  `save_push_subscription(endpoint, p256dh, auth)`, which replaces any row with that endpoint
  for the caller, so a device shared by two accounts notifies whoever enabled push last.
  Signing out deletes the device's row.
- **VAPID.** One key pair. The private key and subject are edge function secrets
  (`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, plus `VAPID_PUBLIC_KEY`); the public key reaches the
  app as the build-time variable `VITE_VAPID_PUBLIC_KEY`. Without it the app shows push as
  unavailable instead of failing.

## Consequences

- A push can be lost (function down, push service error after the claim) and is not retried;
  a reminder is never duplicated. This matches "best effort" and the no-duplicates rule.
- pgTAP can check what the database decides (log rows, a queued `net.http_request_queue`
  row, the no-op without config) but not delivery, since CI runs without the edge runtime.
  Delivery is covered by Deno unit tests with a fake sender and a manual browser check.
- The owner turns push on with hosted steps that are not in git: generate a VAPID pair,
  `supabase secrets set`, deploy `send-push`, insert the two Vault rows, set
  `VITE_VAPID_PUBLIC_KEY` in Cloudflare Pages (`docs/runbook.md`).
- iOS delivers web push only to a home-screen-installed PWA; the app shows an install hint
  where push is unsupported.
- A trainer cancel does not notify the customer (not in PLAN.md), so deactivating a rule
  sends nothing either.
- Details: `docs/notifications.md`, `docs/jobs.md`, `docs/rpcs.md`, `docs/schema.md`,
  `docs/architecture/push-sequence.md`.
