# Auth in the app

How the app (`app/src/auth/`, `app/src/pages/`) knows who is signed in and what they may see.
Accounts are email/password with confirmations disabled. Customers join through a trainer invite
([ADR 0006](adr/0006-auth-invite-token-password.md)) or register themselves with the gym code
from the QR code in the gym ([ADR 0021](adr/0021-customers-register-with-a-gym-code.md)). The
database enforces every rule again with RLS and RPC role checks, so everything here is
navigation, not security. Routes and copy are in [screens.md](screens.md); the invite and
registration RPCs in [rpcs.md](rpcs.md); the sequences in
[architecture/auth-invite-flow.md](architecture/auth-invite-flow.md).

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
  refresh after `accept_invite` or `register_customer` wins over a slower lookup started before
  it.
- **`refresh()`** reloads the row for the user of the latest auth event, not a session a
  component captured earlier, so the invite and registration pages can sign up and then refresh
  in one handler.

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

`/login`, `/invite/:token`, `/registracija` and `/logout` are outside `RequireAuth`. `/login`
redirects a signed-in user to `/`; after a successful sign-in the session change does that
redirect, so the page only handles failures.

## Lookup failed vs not linked

The two states get different pages so an outage is never mistaken for an account without a
customer record. `LookupFailedPage` offers retry (`refresh()`) and sign out. `NotLinkedPage`
offers two links: **Dokončaj registracijo** to `/registracija` and sign out. Its text says to
ask the trainer, or to scan the QR code in the gym again to finish a registration. A person
whose browser closed between sign-up and `register_customer` scans the code, signs in if asked,
and finishes with name and phone ([Registration](#registration)). Without the code, the link
only shows the advice to scan it. A record the trainer deleted, or one that was never linked,
still needs the trainer (invite or re-link, see ADR 0007).

## Sign-out

`/logout` is a route loader: it first removes this device's push subscription with `disablePush`
for the user of `supabase.auth.getSession()`: with a user it deletes that user's row for this
endpoint and unsubscribes the browser; without a session it only unsubscribes, and the next
push's 404/410 removes the row. A failure is logged with `console.warn` and never stops the
sign-out (see [notifications.md](notifications.md#subscribing-in-the-app)). It then calls
`supabase.auth.signOut()` and redirects to `/login`. If signing out fails, the loader logs it
and returns the `fromError` message, and `LogoutFailedPage` shows it with a continue link. Every
sign-out control links to `/logout`: the account menu in the top bar of both shells, `NotLinkedPage` and
`LookupFailedPage`, so a failed sign-out is always shown.

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
   navigate to `/`, which lands on the customer Home with the
   [install card](screens.md#install-card) on top on a device where the app is not installed.

## Registration

`RegisterPage` (`/registracija?koda=<gym code>`). The QR code in the gym holds this link. The
page reads the code from the `koda` query parameter.

1. Loading → loading line. A signed-in user with a customer record → redirect to `/`. A
   failed customer lookup → `LookupFailedPage`. While a submit runs, the page keeps its form
   on screen even though signing up changes the auth state.
2. No `koda` → only `register.noCode` (scan the QR code in the gym). No form, so no account is
   created without a code.
3. Signed out → name, phone, email, password and password again, all required. Signed in
   without a record → name and phone only (the finish-registration case).
4. Client checks, before any request: name and phone trimmed, name 2 to 80 characters, phone
   6 to 30 characters (the bounds `register_customer` checks); for a new account also the
   password of at least 6 characters and both password fields equal.
5. Signed out: `supabase.auth.signUp({ email, password })`, as on the invite page. No session
   → `register.noSession`. If the account already exists, the page signs in with the same
   password and continues. A wrong password (`invalid_credentials`) shows
   `register.accountExists` with a link to `/login` and calls nothing more; no data of the
   existing account is shown. Other errors show their `authErrors` copy.
6. `registerCustomer` (`register_customer` with the trimmed name and phone and the code). A
   refusal shows its `errors.AMRAP_*` copy and the user stays on the page. A wrong or replaced
   code gives `AMRAP_REGISTRATION_CLOSED`, which also says to scan the code in the gym. If the
   account was just created, the page now shows the short form, so a retry needs no new
   sign-up.
7. `refresh()`, then navigate to `/`, which lands on the customer Home.

## Token refused as issued in the future

PostgREST answers a request whose JWT `iat` lies more than 30 seconds after its own clock with
HTTP 401 and the code `PGRST303` ("JWT issued at future"; `allowedSkewSeconds = 30` in
PostgREST's `Auth/Jwt.hs`, read on the main branch, not checked against the v16.2 image). In the
Stage 4 browser check on the local stack (PostgREST v16.2, Auth v2.196.0) this hit the first
requests right after a sign-in or sign-up (the customer lookup, `accept_invite`, the
keep-alive), with the body `{"code":"PGRST303",…,"message":"JWT issued at future"}`.

Cause: not found (a capped check, 2026-10-24). Auth and PostgREST run on the same Docker VM
clock, and fresh tokens had `iat` equal to the host time; a fresh token used at once, after 10
seconds and after 70 seconds of idle was accepted every time. One trace had two requests sent
in the same millisecond with the same token, one refused and one accepted, so it is not a
steady clock offset between the containers; a stale "now" inside PostgREST for a single request
fits, but was not reproduced. Whether the hosted project can show it is unknown.

Whatever the cause, the one client in `lib/supabase.ts` fetches through `retryIssuedAtFuture(fetch)`
(`global.fetch` of `createClient`): a response with status 401 whose JSON body has
`code: "PGRST303"` is retried exactly once, after one second, with the same request; the
retry's answer is returned whatever it is. Any other response, including other 401s and bodies
that are not JSON, is returned as it is without a retry. The body is read from a clone, so the
original response stays readable. Supabase Auth requests go through the same wrapper and never
match: Auth error bodies carry a numeric `code` (the HTTP status), not `PGRST303`.

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
