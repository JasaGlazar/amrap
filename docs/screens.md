# Screens

The app (`app/`) is one single-page app with role-gated areas. Routing is a React Router v7 data
router; the route tree is `app/src/routes.tsx` and the same tree is what the routing tests
render. Every user-visible string lives in `app/src/i18n/sl.ts` (Slovenian); the "Strings"
column names the key group in `t`. Rows marked **placeholder** exist in Stage 1 as navigable
stubs and are built out in Stage 2 (see `PLAN.md`, "Screens").

## Route table

| Route | Who | Purpose | Strings | Status |
|---|---|---|---|---|
| `/login` | anyone; a signed-in user is sent to `/` | Email and password sign-in. A failed sign-in shows `authErrors` copy. | `login`, `authErrors` | Stage 1 |
| `/invite/:token` | anyone | Sign-up from an invite link: email, password, confirm password. Creates the auth user (or signs in when that account already exists but is unlinked), calls `accept_invite(token)`, reloads the customer record and goes to `/`. A rejected invite shows its `errors.AMRAP_*` copy. | `invite`, `errors`, `authErrors` | Stage 1 |
| `/logout` | anyone | Signs out and redirects to `/login` (a route loader, no UI). | none | Stage 1 |
| `/` | signed in | Redirects to `/t` for the trainer or `/c` for a customer. | none | Stage 1 |
| (any route below `/`) | signed in, no `customers` row | "Account not linked" page with a sign-out button. Shown instead of the route, URL unchanged. | `notLinked`, `common.signOut` | Stage 1 |
| `/c` | customer | Customer shell with bottom navigation (Home, Calendar, History). Home shows the balance from `customer_balances` (red when negative) and "no upcoming appointments". | `nav`, `customer` | Home balance Stage 1; upcoming list placeholder |
| `/c/calendar` | customer | Book open slots, cancel with free/late warning. | `customer.calendarTitle`, `common.comingSoon` | placeholder |
| `/c/history` | customer | Past appointments and readable ledger. | `customer.historyTitle`, `common.comingSoon` | placeholder |
| `/t` | trainer | Trainer shell with bottom navigation (Today, Calendar, Customers, Settings). Index is Today. | `nav`, `trainer` | placeholder |
| `/t/calendar` | trainer | Week view of all customers, capacity per slot. | `trainer.calendarTitle`, `common.comingSoon` | placeholder |
| `/t/customers` | trainer | Balances, ledger, top-up, adjust, invite link. | `trainer.customersTitle`, `common.comingSoon` | placeholder |
| `/t/settings` | trainer | Slot templates, cutoff hours, blocked periods. | `trainer.settingsTitle`, `common.comingSoon` | placeholder |
| anything else | anyone | Redirects to `/`. | none | Stage 1 |

## Access rules

- `RequireAuth` wraps every route except `/login`, `/invite/:token` and `/logout`. While the
  stored session and the customer record are loading it shows a loading line, so a reload never
  flashes the login page. No session redirects to `/login`; a session without a `customers` row
  shows the not-linked page.
- `RequireRole('customer' | 'trainer')` wraps `/c` and `/t`. A user of the other role is
  redirected to `/`, which sends them to their own area.
- The role comes from the signed-in user's `customers` row (`role`), selected by
  `auth_user_id`; it is never read from auth metadata (ADR 0006). The database enforces the
  same split with RLS and RPC role checks, so the guards are navigation, not security.

## Behaviour shared by all screens

- **Keep-alive.** Once per signed-in user per page load, `AuthProvider` runs
  `select id from settings limit 1` (ADR 0005). A failure is logged with `console.warn` and
  never blocks the app. Token refreshes do not repeat it.
- **Error copy.** `fromError(error)` turns a PostgREST error (`AMRAP_<TOKEN>: detail`) or a
  Supabase Auth error code into Slovenian copy; anything else gets `genericError`.
- **Environment.** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required; the app
  throws at start-up without them ([runbook.md](runbook.md#cloudflare-pages-build-settings)).
- **PWA.** `registerType: 'autoUpdate'`, `display: standalone`, manifest language `sl`, icons
  192 and 512 px. Cloudflare Pages serves `index.html` for every path through
  `app/public/_redirects`.
