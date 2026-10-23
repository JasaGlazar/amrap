# Auth and invite flow

How a customer gets an account (ADR 0006). The trainer UI for this step arrives in Stage 2;
in Stage 1 the owner issues the token with the SQL recipe in
[runbook.md](../runbook.md#invite-a-customer-stage-1-until-the-customers-screen-exists). The trainer creates an invite for an unlinked
customer record with `create_invite(customer_id)`, which returns a single-use token (24 random
bytes, hex) valid for 7 days; re-issuing replaces the previous token. The customer opens the
link, signs up with email and password (no confirmation email), and the app calls
`accept_invite(token)`, which locks the record by token, checks it, links the new auth user
(`customers.auth_user_id`) and clears the token. The app then reloads the user's own
`customers` row (the role comes from that row) and routes by role: the trainer sees the trainer
shell, a customer sees the customer home. A user with no `customers` row has no data access and
sees an "account not linked" page with a sign-out button.

If the sign-up already succeeded earlier but `accept_invite` did not run or was rejected (a
dropped request, or an invite replaced by a newer one), the auth user exists but is unlinked.
Opening the invite link again and entering the same email and password makes the page sign in
instead (sign-up answers `user_already_exists`) and then call `accept_invite`; a wrong password
shows the "account exists" message. If `accept_invite` itself rejects the token, the page shows
the mapped error ([rpcs.md](../rpcs.md#accept_invite)) and a continue link that ends on the
not-linked page; the trainer issues a new invite (`create_invite` replaces the token).

`create_invite` refuses a record that is already linked. To re-link a customer who lost access
(ADR 0007), the trainer first deletes the customer's auth user in the Supabase dashboard; the
foreign key `on delete set null` clears `customers.auth_user_id`, and the flow below starts
again with a new sign-up (steps in [runbook.md](../runbook.md#re-link-a-customer)).

```mermaid
sequenceDiagram
    actor T as Trainer
    actor C as Customer
    participant App as PWA
    participant Auth as Supabase Auth
    participant DB as Postgres RPCs

    opt re-link a customer who lost access (ADR 0007)
        T->>Auth: delete the customer's auth user (dashboard)
        Auth->>DB: on delete set null clears customers.auth_user_id
    end
    T->>App: Invite customer
    App->>DB: create_invite(customer_id)
    DB->>DB: is_trainer(), record exists and not linked, else AMRAP_FORBIDDEN / AMRAP_NOT_FOUND / AMRAP_ALREADY_LINKED
    DB-->>App: token (expires now() + 7 days, single use)
    App-->>T: invite link
    T->>C: send link (text message)
    C->>App: open link with token
    App->>Auth: sign up (email, password)
    Auth-->>App: session (no email confirmation)
    Note over App,Auth: user_already_exists: sign in with the same email and password instead
    App->>DB: accept_invite(token)
    DB->>DB: lock customers row where invite_token = token
    alt token valid, record unlinked, caller not linked
        DB->>DB: set auth_user_id = auth.uid(), clear invite_token and invite_expires_at
        DB-->>App: customer id
        App->>DB: reload own customers row (role)
        App-->>C: role-gated home
    else unknown, used (token cleared) or expired
        DB-->>App: AMRAP_INVITE_INVALID
        App-->>C: invite rejected, signed in but not linked
    else record already linked
        DB-->>App: AMRAP_INVITE_USED
        App-->>C: invite rejected
    else caller already linked to another customer
        DB-->>App: AMRAP_ALREADY_LINKED
        App-->>C: invite rejected
    end
```
