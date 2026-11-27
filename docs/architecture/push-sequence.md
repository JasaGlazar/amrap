# Push sequence

How a notification travels from the database to a device (ADR 0009). A writer (the
15-minute reminder job, or `enqueue_notification()` called by a booking, cancel, undo, trainer
cancel, credit or registration trigger) records `notifications` rows with a unique `(kind,
appointment_id)` key and dispatches only the ids its insert returned, so re-runs and
overlapping runs push nothing new. The customer cancel and undo triggers first delete the
appointment's earlier row of their kind, so a repeat cancel or undo is pushed again.
`dispatch_notifications()` queues one pg_net request, which leaves only after the writer's
transaction commits, and never raises. The `send-push` edge function checks the shared
secret, claims the ids once with `claim_notifications()` (at most once per notification), and
sends to each of the recipient's subscriptions; a 404 or 410 from the push service deletes that
subscription. Without the Vault config the writer logs and records nothing. On the device, the
app subscribes once (the notifications toggle waits for the active service worker, subscribes
with the VAPID key and saves the keys with `save_push_subscription`); the service worker renders
each push from `sl.ts` with the tag `<kind>:<id>`, and a click focuses and navigates a
controlled window or opens a new one. Switching off or signing out deletes the signed-in user's
row for the device, then unsubscribes the browser. Details in
[notifications.md](../notifications.md).

```mermaid
sequenceDiagram
    participant U as User
    participant A as App (notifications toggle, /logout)
    participant S as push_subscriptions
    participant Cron as pg_cron (every 15 min)
    participant T as book, cancel, undo_cancel, cancel_occurrence, deactivate_rule, top_up, adjust, register_customer
    participant J as send_cutoff_reminders()
    participant E as enqueue_notification()
    participant N as notifications
    participant D as dispatch_notifications()
    participant Net as pg_net
    participant F as send-push (edge function)
    participant C as claim_notifications()
    participant P as Push service
    participant SW as Service worker

    opt enable on this device (once)
        U->>A: Vklopi obvestila
        A->>A: permission, navigator.serviceWorker.ready
        A->>P: pushManager.subscribe(VAPID public key)
        P-->>A: endpoint, p256dh, auth
        A->>S: save_push_subscription (upsert by endpoint for the caller)
    end
    alt reminder job
        Cron->>J: select send_cutoff_reminders()
        J->>N: delete rows older than 30 days
        J->>J: push_config() and settings, else raise log, return 0
        J->>N: insert cutoff_reminder for booked, subscribed, cutoff 45 to 75 min ahead
        Note over J,N: on conflict (kind, appointment_id) do nothing, returning the new ids only
        J->>D: dispatch_notifications(new ids)
        J-->>Cron: number inserted, commit
    else event trigger
        T->>N: booking_cancelled or booking_restored trigger: delete the earlier row of its kind
        T->>E: notify_* trigger (customer booking, cancel or undo, trainer cancel or cancel_occurrence with refunded and reason, top-up, adjustment, registration)
        E->>E: push_config(), recipient linked with a device, else return
        E->>N: insert the event row, on conflict do nothing
        E->>D: dispatch_notifications(new id)
        Note over T,E: trigger errors caught with raise warning, the action never fails
        T-->>T: commit
    end
    D->>Net: net.http_post(functions_url/send-push, ids, x-amrap-push-secret)
    Note over D,Net: errors caught with raise warning
    Net->>F: POST after commit
    F->>F: secret check, else 401
    F->>C: claim_notifications(ids) as service role
    C->>N: dispatched_at = now() where still null
    C-->>F: claimed rows x recipient subscriptions
    loop each subscription
        F->>P: encrypted payload, VAPID
        alt 404 or 410
            F->>F: delete the subscription
        else other error
            F->>F: log, keep the subscription
        else delivered
            P->>SW: push event
            SW->>SW: parsePush, showNotification(title and body from sl.ts, tag kind:id, renotify)
        end
    end
    opt the user taps the notification
        U->>SW: notificationclick
        SW->>A: focus a controlled window and navigate to the in-app url, else openWindow(url)
    end
    opt switch off or sign out
        U->>A: Izklopi obvestila, or /logout
        A->>S: delete this endpoint's row for the signed-in user
        A->>P: unsubscribe
    end
```
