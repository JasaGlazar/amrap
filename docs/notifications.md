# Notifications

Best-effort web push (VAPID) to the trainer's and customers' devices. The design and its
reasons are in [ADR 0009](adr/0009-web-push-design.md); the sequence is in
[architecture/push-sequence.md](architecture/push-sequence.md). Postgres decides who gets what
and records it in a log; one edge function, `send-push`, delivers. The functions are in
[rpcs.md](rpcs.md), the table in [schema.md](schema.md#notifications), the job in
[jobs.md](jobs.md#send_cutoff_reminders-every-15-minutes).

## Flow

1. A writer selects recipients and inserts `notifications` rows `on conflict (kind,
   appointment_id) do nothing returning id`: the 15-minute job `send_cutoff_reminders()` for
   reminders, `enqueue_notification()` (called by the triggers below) for events.
2. It passes the ids it got back to `dispatch_notifications(ids)`, which queues one pg_net
   request `POST <functions_url>/send-push` with `{"ids": [...]}` and the header
   `x-amrap-push-secret`.
3. pg_net sends the request after the writer's transaction commits. A writer that rolls back
   sends nothing.
4. `send-push` checks the secret, calls `claim_notifications(ids)` with its service key, which
   marks the rows dispatched and returns them with the recipient's subscriptions, then pushes
   to each subscription. A 404 or 410 from the push service deletes that subscription. The
   function's contract is in [jobs.md](jobs.md#send-push-edge-function).

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
| `booking_created` | the trainer | trigger on a customer's own booking | `appointment_id`, `customer_name`, `starts_at`, `timezone` |
| `booking_cancelled` | the trainer | trigger on a customer's cancel | `appointment_id`, `customer_name`, `starts_at`, `late` (true for `cancelled_late`), `timezone` |
| `credit_topup` | the customer | trigger on a `topup` row | `transaction_id`, `amount`, `note` (or null), `balance` (after the row) |
| `credit_adjustment` | the customer | trigger on an `adjustment` row | `transaction_id`, `amount` (signed), `note` (or null), `balance` (after the row) |
| `appointment_cancelled_by_trainer` | the appointment's customer | trigger on a trainer cancel (`cancel()` by the trainer, `cancel_occurrence()`, `deactivate_rule()`) | `appointment_id`, `starts_at`, `timezone`, `refunded` (true when the appointment was `charged`, so a refund was written), `reason` (the trimmed reason, or null) |

Appointment kinds set `notifications.appointment_id`; credit kinds set `transaction_id` and
leave `appointment_id` null.

`cutoff_at` is `starts_at − late_cancel_hours · 1 h`, the same cutoff `cancel()` uses.

## Push payload

The encrypted payload is JSON with no display text, so all copy stays in the app
(`app/src/i18n/sl.ts`; the service worker renders it):

```json
{ "kind": "cutoff_reminder", "data": { "appointment_id": "…", "starts_at": "…", "cutoff_at": "…", "timezone": "Europe/Ljubljana" }, "url": "/c" }
```

`data` is the row's `data` unchanged (see [Kinds and data](#kinds-and-data)). Per kind
(`supabase/functions/send-push/payload.ts`):

| Kind | `url` | TTL | Urgency | Topic |
|---|---|---|---|---|
| `cutoff_reminder` | `/c` | seconds until `data.cutoff_at` (0 when passed or missing) | `high` | the appointment id without dashes (32 characters), so a newer reminder replaces an undelivered older one |
| `booking_created`, `booking_cancelled` | `/t` | 24 hours | `normal` | none |
| `credit_topup`, `credit_adjustment`, `appointment_cancelled_by_trainer` | `/c/zgodovina` (the trainer cancel's reason is shown there) | 24 hours | `normal` | none |

A reminder that expires at the cutoff is never delivered after it, when it would be useless.

## Service worker

`app/src/sw.ts`, built by vite-plugin-pwa (`strategies: 'injectManifest'`) into `dist/sw.js`
and registered by the plugin's `registerSW.js`:

- **app shell:** precaches the build (`precacheAndRoute`; `injectManifest.globPatterns` adds
  the font's woff2 files to the default js, css and html, and `includeAssets` the icon and the
  wordmark), deletes caches of older builds
  (`cleanupOutdatedCaches`), answers every navigation with the precached `index.html`
  (`NavigationRoute` + `createHandlerBoundToURL`, so a deep link opens offline too) and takes
  over at once (`skipWaiting` + `clientsClaim`), as the plugin's generated worker did before.

- **push:** `parsePush(event.data.text())` (`app/src/push/render.ts`) parses `{kind, data,
  url}` and renders title and body from `sl.push.*` with the times in `data.timezone` (the
  device's zone if missing). A reminder shows the start and the cutoff (time only when the
  cutoff is the same day, else day and time); booking notifications the customer's name and
  start, with a separate title for a late cancel; a trainer cancel the start
  (`push.trainerCancelledBody`), then `push.withRefund` when `refunded` and `push.withReason`
  last when the reason is not blank; credit notifications the signed amount and the
  new balance, plus the note when there is one. An unknown kind, missing fields or a payload
  that is not JSON shows `push.genericTitle` / `push.genericBody`. The tag is
  `<kind>:<appointment or transaction id>`, so a repeated notification replaces the earlier one.
- **notificationclick:** closes the notification, then focuses a window of the app that the
  service worker controls and navigates it to `url`; with no such window, or when navigating
  fails, it opens a new window there. `parsePush` keeps a `url` only when it starts with `/` and
  still resolves to the app's own origin once parsed (so `//host`, `/\host` or a tab after the
  slash fall back to `/`), and the click handler checks the origin again before opening it.

## Subscribing in the app

`app/src/push/` holds the browser side; the toggle that uses it is described in
[screens.md](screens.md#notifications-toggle):

- `support.ts`: `pushSupport(environment)` → `supported`, `needs-install` (iOS outside the
  home-screen app, where Safari has no web push), `unsupported` or `no-key` (the build lacks
  `VITE_VAPID_PUBLIC_KEY`). On iOS the user has to install the app first; the
  [install card](screens.md#install-card) gives the steps. The device part of the environment
  (`ios`, `android`, `standalone`) comes from `lib/device.ts`, shared with the install card.
- `browser.ts`: `browserPlatform`, the only code that touches `navigator.serviceWorker`,
  `PushManager` and `Notification`. It uses the existing service worker registration
  (`getRegistration()`), so on the Vite dev server, which registers no service worker, push is
  not available; use a production build (`npm run build && npm run preview`). Subscribing waits
  for `navigator.serviceWorker.ready` once a registration exists, because a worker that is still
  installing (first visit, right after an update) cannot subscribe; after 5 seconds without an
  active worker it gives up and the toggle shows `pushToggle.failed`.
- `subscribe.ts`: `enablePush` (permission, `pushManager.subscribe({userVisibleOnly: true,
  applicationServerKey})`, `save_push_subscription`; when the browser refuses because an
  existing subscription was made with another VAPID key, `InvalidStateError`, it unsubscribes
  that one and retries once) and `disablePush` (delete this device's row for the signed-in user,
  unsubscribe; with no known user it only unsubscribes, and the 404/410 cleanup removes the row
  on the next push). Signing out calls `disablePush` first, best effort, so a shared device
  stops getting the previous user's notifications.

## Event notifications

Four triggers ([schema.md](schema.md#triggers)) call `enqueue_notification()`; no RPC body
knows about push:

| Event | Trigger condition | Notifies |
|---|---|---|
| A customer books (`book()` by a customer) | `after insert on appointments`, `source = 'self_booked'` | the trainer, `booking_created` |
| A customer cancels (`cancel()` by a customer) | `after update of status`, `booked` → `cancelled` or `cancelled_late` | the trainer, `booking_cancelled` |
| The trainer cancels (`cancel()` by the trainer, `cancel_occurrence()`, `deactivate_rule()`) | `after update of status`, `booked` or `charged` → `cancelled_by_trainer` | the customer, `appointment_cancelled_by_trainer` |
| The trainer tops up or adjusts | `after insert on credit_transactions`, `type in ('topup', 'adjustment')` | the customer, `credit_topup` / `credit_adjustment` |

Nothing else notifies: trainer bookings (`source = 'trainer'`), materialization
(`source = 'recurring'`, so the nightly run sends nothing), the charge job (`booked` →
`charged`), charges and refunds (a refund is part of the trainer cancel's notification,
`refunded`). The trainer is not notified of their own cancels.

A trainer cancel tells the customer (issue #18, [ADR 0015](adr/0015-trainer-cancel-notifies-customer.md)).
`refunded` comes from the old status (`charged`), because `cancel()` inserts the refund after
the status update, when the row trigger has already run. `deactivate_rule()` cancels a rule's
future booked instances in one statement and the trigger sends one notification per instance,
without a reason; materialization keeps four weeks, so that is at most about five.
`cancel_occurrence()` (ADR 0016) cancels a whole session the same way: one notification per
customer, each with the session's reason and its own `refunded`. A customer
without push still sees the cancel and its reason in **Zgodovina**
([screens.md](screens.md#history-czgodovina)), which reads `appointments.cancel_reason`, not
this log.

The domain has one trainer. The booking triggers pick a single recipient, matching the
`(kind, appointment_id)` key: the earliest-created `role = 'trainer'` record with a push
subscription (ties by id). The credit trigger reads the balance after the row from
`customer_balances`.

`enqueue_notification()` records nothing without push config or when the recipient has no linked
user or no subscription, inserts the row and dispatches its id. It and each trigger function
catch every error (`raise warning`), so a failing notification never fails `book`, `cancel`,
`deactivate_rule`, `top_up` or `adjust`.

## Subscriptions

The app saves a device's subscription with `save_push_subscription(endpoint, p256dh, auth)`
([rpcs.md](rpcs.md#save_push_subscription)): an upsert on `endpoint` that moves an endpoint
already saved by another account to the caller, so a shared device notifies whoever enabled
push last. Only `https://` endpoints are accepted (the RPC, a check constraint on the table,
and `send-push`, which never calls anything else), so a forged subscription cannot make the
function call an arbitrary URL. Deleting is a plain RLS delete of an own row.

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

The edge function needs its own secrets (`PUSH_SECRET`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, see [jobs.md](jobs.md#send-push-edge-function)); without
them it answers 503 and claims nothing, so the rows stay undispatched.

When either Vault row is missing or empty, `send_cutoff_reminders()` and
`dispatch_notifications()` log with `raise log` and do nothing, so the hosted project runs
unchanged until the owner sets them. The service-role key is never stored in the database.
Setting them on the hosted project is in [runbook.md](runbook.md#turn-on-push-notifications).

## Best effort

- A failed push never fails the action that caused it: pg_net sends only after commit, and
  `dispatch_notifications()` catches every error (a malformed URL, pg_net trouble) and reports
  it with `raise warning`.
- A push can be lost (function down, push service error after the claim) and is not retried.
- pg_net keeps each response in `net._http_response` for 6 hours (`pg_net.ttl`); a request
  that reached the gateway but no function shows status 404 or 503 there.

## Local setup

1. `cp supabase/functions/.env.example supabase/functions/.env` and fill in a VAPID pair from
   `npx web-push@3.6.7 generate-vapid-keys` (`PUSH_SECRET=local-push-secret` already matches
   the dev seed's Vault row).
2. `supabase stop && supabase start` so the edge runtime loads the file; `send-push` is then
   served at `http://127.0.0.1:54321/functions/v1/send-push` (a POST without the secret answers
   401).
3. Put the same public key in `app/.env.local` as `VITE_VAPID_PUBLIC_KEY`, then `npm run build
   && npm run preview` in `app/` (the service worker exists only in a build) and enable
   notifications on Home or Settings.
4. Trigger a notification (for example the reminder job, see [jobs.md](jobs.md#schedules)) and
   read `net._http_response` and `docker logs supabase_edge_runtime_amrap`.

## Testing

- `supabase/tests/030_notifications.sql`: pg_net schema, the table, its key and closed
  privileges, function grants, `push_config`, the queued request (URL, headers, body, timeout),
  no request for empty ids or without config, a failing pg_net call caught, one claim per
  notification and subscription.
- `supabase/tests/031_reminders.sql`: the reminder job, see
  [jobs.md](jobs.md#send_cutoff_reminders-every-15-minutes).
- `supabase/tests/032_event_notifications.sql`: which actions notify whom and with what data
  (a trainer cancel with and without a refund and a reason, `deactivate_rule` once per
  instance), which do not (trainer booking, materialization, charge, refund, no device, no
  account, no config), actions succeeding when the notification fails,
  `save_push_subscription`.
- `supabase/functions/send-push/*_test.ts` (Deno): payload per kind (URL, TTL, urgency,
  topic), the handler's 405/401/503/400/500 answers, pushes to every claimed subscription,
  404/410 deleting exactly those subscriptions, other failures kept, non-https endpoints never
  called; `keys_test.ts`: service-key selection (valid `SUPABASE_SECRET_KEYS`, malformed,
  without `default`, legacy only, neither).
- Vitest in `app/src/push/`: `render.test.ts` (copy per kind, DST, earlier-day cutoff, generic
  fallbacks, safe in-app URLs), `support.test.ts` (support matrix), `subscribe.test.ts`
  (permission, VAPID key, save, stale-key retry, disable), `browser.test.ts` (subscribe waits for
  the active worker), `logout.test.tsx` (signing out removes the device, and still signs out when
  that fails); `app/src/data/push.test.ts` (rows filtered by user);
  `app/src/pages/shared/pushToggle.test.tsx` (every toggle state and action).
- Requests in tests go to a test-only host and roll back with the transaction, so nothing is
  sent; CI runs without the edge runtime.

## Manual check (desktop, local stack)

What a headless desktop check can and cannot show, found on 2026-10-24 with Chrome 155:

- Headless Chrome starts with notification permission `denied` (the toggle shows "blocked").
  Granting it over the DevTools protocol (`Browser.grantPermissions` for the app origin) works
  only within the same protocol session; a tool that reconnects for every command (agent-browser
  through Playwright) loses the grant, so drive the permission-dependent steps from one session.
- With the grant, **Vklopi obvestila** creates a real FCM subscription
  (`https://fcm.googleapis.com/fcm/send/…`), saves it and shows "on", and `send-push` gets 201
  from FCM (`sent: 1`).
- Headless Chrome cannot receive pushes: its GCM client fails to log in (`Authentication
  Failed: wrong_secret` in the Chrome log) and after a few minutes drops the registration, so
  the next push gets 404/410 from FCM and `send-push` deletes the subscription (`removed: 1`).
  Delivery to a device is therefore a phone (or headed desktop Chrome) check.
- The service worker's rendering can be checked without FCM: the protocol's
  `ServiceWorker.deliverPushMessage` hands the worker a payload in the `send-push` format, and
  `registration.getNotifications()` in the page returns what it showed. A notification click
  cannot be simulated this way.
