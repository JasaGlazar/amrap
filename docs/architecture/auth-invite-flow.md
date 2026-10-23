# Auth and invite flow

How a customer gets an account (ADR 0006). The trainer creates an invite for a customer record
with `create_invite`, which returns a single-use token valid for 7 days. The customer opens the
link, signs up with email and password (no confirmation email), and the app calls
`accept_invite`, which links the new auth user to the customer record. After that the app routes
by role: the trainer sees the trainer shell, a customer sees the customer home. A user with no
`customers` row has no data access.

```mermaid
sequenceDiagram
    actor T as Trainer
    actor C as Customer
    participant App as PWA
    participant Auth as Supabase Auth
    participant DB as Postgres RPCs

    T->>App: Invite customer
    App->>DB: create_invite(customer_id)
    DB-->>App: token (7 days, single use)
    App-->>T: invite link
    T->>C: send link (text message)
    C->>App: open link with token
    App->>Auth: sign up (email, password)
    Auth-->>App: session (no email confirmation)
    App->>DB: accept_invite(token)
    alt token valid and unused
        DB->>DB: set customers.auth_user_id, mark invite used
        DB-->>App: customer linked
        App->>DB: read role via is_trainer()
        App-->>C: role-gated home
    else expired or already used
        DB-->>App: error
        App-->>C: invite rejected
    end
```
