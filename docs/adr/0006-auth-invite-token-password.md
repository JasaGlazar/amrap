# 0006. Email/password auth with invite tokens

Status: Superseded in part by 0021
Date: 2026-10-23

## Context

Customers need accounts, but only people the trainer knows may join. Magic links and OTP
depend on email delivery. Supabase's default SMTP is limited to 2 emails per hour, is
best-effort and is not meant for production (Supabase docs, 2026-10-23). Custom SMTP is out of
scope for the free-tier constraint.

## Decision

- Authentication is email and password with email confirmations disabled. Magic links and OTP
  are not used.
- Customers join only through trainer-generated invite tokens. The trainer calls
  `create_invite`; the customer opens the link, signs up and the app calls `accept_invite`,
  which links the new auth user to the customer record. Tokens expire after 7 days and are
  single use.
- Public sign-up is technically possible, but yields an auth user with no `customers` row, and
  RLS grants such a user no data access.

## Consequences

- No emails are sent by the app in Stage 1, so the SMTP limit never matters.
- No self-service password reset in Stage 1. If a customer loses access, the trainer re-issues
  an invite to re-link the record (refined by ADR 0007: the trainer first deletes the
  customer's auth user, then re-invites).
- Because email is not confirmed, the email address is not proof of identity; the invite token
  is the proof, and it must be unguessable, single use and expiring.
- `accept_invite` must be tested for reuse and expiry rejection.
- Role is derived from the `customers` row (`is_trainer()`, `current_customer_id()`), not from
  user-editable auth metadata.
