# System context

AMRAP is a single-page PWA served by an assets-only Cloudflare Worker and used on the trainer's
and the customers' phones. All data, authentication and scheduled work live in one Supabase
project on the free plan: Postgres with RLS and `SECURITY DEFINER` RPCs, Supabase Auth, pg_cron
for the recurring jobs and edge functions that send web push through the browser vendors' push
services. See ADR 0005 for the stack choice, ADR 0012 for the hosting and ADR 0009 for push:
Postgres records each notification and calls the `send-push` edge function through pg_net.

```mermaid
flowchart LR
    trainer["Trainer phone (PWA)"]
    customer["Customer phones (PWA)"]
    subgraph cf["Cloudflare Workers static assets (free)"]
        spa["Vite + React SPA<br/>static assets, service worker"]
    end
    subgraph sb["Supabase (free plan)"]
        auth["Auth<br/>email/password"]
        pg[("Postgres<br/>RLS + RPCs")]
        cron["pg_cron<br/>jobs"]
        edge["Edge functions<br/>web push sender"]
    end
    push["Web push services<br/>(FCM / APNs / Mozilla)"]

    trainer -->|"loads app"| spa
    customer -->|"loads app"| spa
    trainer -->|"supabase-js: auth, RPC, reads"| auth
    trainer -->|"supabase-js: RPC, reads"| pg
    customer -->|"supabase-js: auth, RPC, reads"| auth
    customer -->|"supabase-js: RPC, reads"| pg
    auth --- pg
    cron -->|"charge_due_appointments (every 15 min), materialize_recurring (nightly)"| pg
    cron -->|"send_cutoff_reminders (every 15 min)"| pg
    cron -->|"prune_cron_history (daily)"| pg
    pg -->|"pg_net after commit: send-push with notification ids"| edge
    edge -->|"claim_notifications, delete expired subscriptions"| pg
    edge -->|"VAPID push"| push
    push -->|"notification"| trainer
    push -->|"notification"| customer
```
