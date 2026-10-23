# Data model

Entity-relationship diagram of every table. The model is ledger-first: there is no balance
column; a customer's balance is `SUM(credit_transactions.amount)`, exposed by the view
`customer_balances` (ADR 0003). Invite status is not stored; it is derived: linked when
`auth_user_id` is not null, pending when `invite_token` is not null and `invite_expires_at > now()`,
otherwise none. `push_subscriptions.user_id` and `credit_transactions.created_by` reference
`auth.users` (not drawn), so they reach a customer only indirectly through
`customers.auth_user_id`. All tables are under RLS and all credit and capacity changes go
through RPCs. Column lists show the main fields; the migration is the exact definition and
`docs/schema.md` is the reference.

```mermaid
erDiagram
    customers {
        uuid id PK
        text name
        text phone
        text email
        customer_role role "trainer or customer"
        uuid auth_user_id "nullable, unique, auth user"
        text invite_token "nullable, unique, single use, cleared on accept"
        timestamptz invite_expires_at "nullable, token expiry 7 days"
        timestamptz created_at
    }
    slot_templates {
        uuid id PK
        smallint weekday "0 = Monday"
        time start_time
        int duration_minutes "default 60"
        int capacity "default 5"
        boolean active
        timestamptz created_at
    }
    recurring_rules {
        uuid id PK
        uuid customer_id FK "unique with slot_template_id"
        uuid slot_template_id FK
        boolean active
        timestamptz created_at
    }
    appointments {
        uuid id PK
        uuid customer_id FK
        uuid slot_template_id FK "nullable, null for ad-hoc"
        timestamptz starts_at
        timestamptz ends_at "after starts_at"
        appointment_status status "booked, charged, cancelled, cancelled_late, cancelled_by_trainer"
        appointment_source source "recurring, self_booked, trainer"
        uuid rule_id FK "nullable"
        timestamptz cancelled_at "nullable"
        timestamptz created_at
    }
    credit_transactions {
        uuid id PK
        uuid customer_id FK
        int amount "non-zero, checked per type"
        transaction_type type "topup, session, late_cancel, refund, adjustment"
        uuid appointment_id FK "nullable, partial unique for session and late_cancel"
        uuid created_by "nullable, auth user"
        text note
        timestamptz created_at
    }
    blocked_periods {
        uuid id PK
        timestamptz starts_at
        timestamptz ends_at "after starts_at"
        text reason
        timestamptz created_at
    }
    settings {
        int id PK "single row"
        int late_cancel_hours "default 5"
        text timezone "default Europe/Ljubljana"
    }
    push_subscriptions {
        uuid id PK
        uuid user_id "auth user"
        text endpoint "unique"
        text p256dh
        text auth
        timestamptz created_at
    }

    customers ||--o{ recurring_rules : "has"
    slot_templates ||--o{ recurring_rules : "is repeated by"
    customers ||--o{ appointments : "books"
    slot_templates |o--o{ appointments : "hosts"
    recurring_rules |o--o{ appointments : "materializes"
    customers ||--o{ credit_transactions : "owns ledger"
    appointments |o--o{ credit_transactions : "charged by"
```
