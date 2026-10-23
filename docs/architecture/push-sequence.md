# Push sequence

How a notification travels from the database to a device (ADR 0009). A writer (here the
15-minute reminder job) records `notifications` rows with a unique `(kind, appointment_id)`
key and dispatches only the ids its insert returned, so re-runs and overlapping runs push
nothing new. `dispatch_notifications()` queues one pg_net request, which leaves only after the
writer's transaction commits, and never raises. The `send-push` edge function checks the shared
secret, claims the ids once with `claim_notifications()` (at most once per notification), and
sends to each of the recipient's subscriptions; a 404 or 410 from the push service deletes that
subscription. Without the Vault config the writer logs and records nothing. Details in
[notifications.md](../notifications.md).

```mermaid
sequenceDiagram
    participant Cron as pg_cron (every 15 min)
    participant J as send_cutoff_reminders()
    participant N as notifications
    participant D as dispatch_notifications()
    participant Net as pg_net
    participant F as send-push (edge function)
    participant C as claim_notifications()
    participant P as Push service
    participant SW as Service worker

    Cron->>J: select send_cutoff_reminders()
    J->>N: delete rows older than 30 days
    J->>J: push_config() and settings, else raise log, return 0
    J->>N: insert cutoff_reminder for booked, subscribed, cutoff 45 to 75 min ahead
    Note over J,N: on conflict (kind, appointment_id) do nothing, returning the new ids only
    J->>D: dispatch_notifications(new ids)
    D->>Net: net.http_post(functions_url/send-push, ids, x-amrap-push-secret)
    Note over D,Net: errors caught with raise warning, the job never fails
    J-->>Cron: number inserted, commit
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
        end
    end
```
