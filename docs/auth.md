# Auth in the app

How the app (`app/src/auth/`, `app/src/pages/`) knows who is signed in and what they may see.
Accounts are email/password with confirmations disabled; customers join only through a trainer
invite ([ADR 0006](adr/0006-auth-invite-token-password.md)). The database enforces every rule
again with RLS and RPC role checks, so everything here is navigation, not security. Routes and
copy are in [screens.md](screens.md); the invite RPCs in [rpcs.md](rpcs.md#accept_invite); the
sequence in [architecture/auth-invite-flow.md](architecture/auth-invite-flow.md).

## Session loading

`AuthProvider` (wraps every route, `routes.tsx` `Root`) subscribes to
`supabase.auth.onAuthStateChange`. The session is `undefined` until the first event
(`INITIAL_SESSION`) has delivered the stored session, then a `Session` or `null`. The callback
only stores the session: calling Supabase from inside it can deadlock the auth client. A
sign-out event (`null`) also drops the loaded customer row.

## Customer-row lookup

For each signed-in user id, the provider selects `customers` where `auth_user_id` is that id
(`maybeSingle`). The filter is needed because RLS lets the trainer read every row. The row
carries the role; auth metadata is never read for it (ADR 0006).

- **Not linked:** the query succeeds with no row → `customer = null`, `lookupFailed = false`.
- **Lookup failed:** the query returns an error or throws (network, server, paused project) →
  `customer = null`, `lookupFailed = true`, logged with `console.warn`.
- **Ordering:** each load gets a sequence number and only the newest one is applied, so the
  refresh after `accept_invite` wins over a slower lookup started before it.
- **`refresh()`** reloads the row for the user of the latest auth event, not a session a
  component captured earlier, so the invite page can sign up and then refresh in one handler.

`AuthState` (`useAuth()`) exposes `loading` (true until the session is known and, for a
signed-in user, the lookup for that user has finished), `session`, `customer`, `lookupFailed`,
`role` (`customer.role` or null) and `refresh`.

## Role gating

`auth/guards.tsx` provides three layout routes:

| Guard | Behaviour |
|---|---|
| `RequireAuth` | loading → loading line (a reload never flashes the login page); no session → `/login`; lookup failed → `LookupFailedPage`; not linked → `NotLinkedPage` (URL unchanged); else the child routes. |
| `RequireRole role` | inside `RequireAuth`: a user of the other role is redirected to their own home (`homePath`: `/t` trainer, `/c` customer). |
| `RoleRedirect` | the `/` route: redirects to `homePath(role)`. |

`/login`, `/invite/:token` and `/logout` are outside `RequireAuth`. `/login` redirects a
signed-in user to `/`; after a successful sign-in the session change does that redirect, so the
page only handles failures.

## Lookup failed vs not linked

The two states get different pages so an outage is never mistaken for an account without a
customer record. `LookupFailedPage` offers retry (`refresh()`) and sign out; `NotLinkedPage`
offers sign out only (the trainer has to invite or re-link the record, see ADR 0007).

## Sign-out

`/logout` is a route loader: it calls `supabase.auth.signOut()` and redirects to `/login`. If
signing out fails, the loader logs it and returns the `fromError` message, and
`LogoutFailedPage` shows it with a continue link. Every sign-out control links to `/logout`:
the top bar of both shells, `NotLinkedPage` and `LookupFailedPage`, so a failed sign-out is
always shown.

## Invite acceptance

`InvitePage` (`/invite/:token`):

1. Client checks: password at least 6 characters (`minimum_password_length` in
   `supabase/config.toml`) and both password fields equal.
2. `supabase.auth.signUp({ email, password })`. With confirmations disabled this returns a
   session; if it does not, the page shows `invite.noSession`.
3. If the account already exists (`user_already_exists`), an earlier attempt may have created it
   without linking it (a dropped request, or an invite that was replaced), so the page signs in
   with the same password and continues. A wrong password (`invalid_credentials`) means the
   account is someone else's, and the page shows the sign-up error instead.
4. `accept_invite(token)` links the auth user to the customer record. A rejection shows its
   `errors.AMRAP_*` copy and, since the user is now signed in, a continue link.
5. `refresh()` (the provider cached "not linked" while the account was being created), then
   navigate to `/`.

## Keep-alive

Once per signed-in user per page load (not on token refresh), the provider calls
`keepAlive()` (`lib/keepAlive.ts`): `select id from settings limit 1`. The Supabase Free Plan
pauses an idle project ([ADR 0005](adr/0005-supabase-free-tier-cloudflare-pages.md)); the read
keeps it active. A failure is logged with `console.warn` and never blocks the app.

## Start-up error

`lib/supabase.ts` throws at import time when `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`
is missing. `start.tsx` imports the route tree (which imports the client) dynamically inside a
`try`, so that failure renders `StartupErrorPage` with the message instead of a blank page,
and logs it with `console.error`.
