# Data model

Entity-relationship diagram of every table. The model is ledger-first: there is no balance
column; a customer's balance is `SUM(credit_transactions.amount)`, exposed by the view
`customer_balances` (ADR 0003). All tables are under RLS and all credit and capacity changes go
through RPCs. Column lists show the main fields; the migration is the exact definition and
`docs/schema.md` is the reference.

```mermaid
erDiagram
    customers {
        uuid id PK
        text name
        text phone
        text email
        text role "trainer or customer"
        uuid auth_user_id "nullable, unique"
        text invite_status
        text invite_token "nullable, single use"
        timestamptz invite_expires_at "nullable, 7 days"
    }
    slot_templates {
        uuid id PK
        int weekday
        time start_time
        int duration_minutes "default 60"
        int capacity "default 5"
        boolean active
    }
    recurring_rules {
        uuid id PK
        uuid customer_id FK
        uuid slot_template_id FK
        boolean active
    }
    appointments {
        uuid id PK
        uuid customer_id FK
        uuid slot_template_id FK "nullable, null for ad-hoc"
        timestamptz starts_at
        timestamptz ends_at
        text status "booked, charged, cancelled, cancelled_late, cancelled_by_trainer"
        text source "recurring, self_booked, trainer"
        uuid rule_id FK "nullable"
        timestamptz cancelled_at "nullable"
    }
    credit_transactions {
        uuid id PK
        uuid customer_id FK
        int amount
        text type "topup, session, late_cancel, refund, adjustment"
        uuid appointment_id FK "nullable, partial unique for session and late_cancel"
        uuid created_by FK
        text note
        timestamptz created_at
    }
    blocked_periods {
        uuid id PK
        timestamptz starts_at
        timestamptz ends_at
        text reason
    }
    settings {
        int id PK "single row"
        int late_cancel_hours "default 5"
        text timezone "default Europe/Ljubljana"
    }
    push_subscriptions {
        uuid id PK
        uuid user_id "auth user"
        text endpoint
        jsonb keys
    }

    customers ||--o{ recurring_rules : "has"
    slot_templates ||--o{ recurring_rules : "is repeated by"
    customers ||--o{ appointments : "books"
    slot_templates ||--o{ appointments : "hosts"
    recurring_rules ||--o{ appointments : "materializes"
    customers ||--o{ credit_transactions : "owns ledger"
    appointments ||--o{ credit_transactions : "charged by"
    customers ||--o{ credit_transactions : "created_by"
    customers ||--o{ push_subscriptions : "subscribes via auth_user_id"
```
