# 0007. Re-link a customer by deleting their auth user

Status: Accepted
Date: 2026-10-23

## Context

ADR 0006 says that a customer who loses access (forgotten password, lost device, wrong email)
gets a re-issued invite. But `create_invite` rejects a customer record that is already linked
(`AMRAP_ALREADY_LINKED`), and `accept_invite` rejects a token on a linked record. Letting
`create_invite` re-issue for linked records would let anyone holding a fresh token take over an
existing account's record silently, and there is no self-service password reset (no SMTP,
ADR 0006).

## Decision

- `create_invite` keeps rejecting linked customers.
- To re-link, the trainer deletes the customer's auth user in the Supabase dashboard
  (Authentication, Users). The foreign key `customers.auth_user_id references auth.users on
  delete set null` clears the link; the customer record, its appointments and its ledger stay
  untouched.
- The trainer then calls `create_invite` for the now unlinked record and sends the new link;
  the customer signs up again with a new password (same or new email) and `accept_invite`
  links the new auth user.
- This refines only the "trainer re-issues an invite to re-link the record" consequence of
  ADR 0006; everything else in 0006 stands.

## Consequences

- Re-linking is a deliberate two-step trainer action in the dashboard, never a side effect of
  an invite, so an existing account cannot be hijacked through `create_invite`.
- Deleting the auth user also deletes that user's `push_subscriptions` (`on delete cascade`),
  so the customer re-enables notifications after signing up again, and sets
  `credit_transactions.created_by` to null on rows that user created (their own late cancels);
  amounts and types are unchanged, so balances are unaffected.
- The steps are in `docs/runbook.md` ("Re-link a customer"). A trainer-facing button for this
  would need an edge function with the service role key and is out of scope for Stage 1.
