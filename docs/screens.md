# Screens

The app (`app/`) is one single-page app with role-gated areas. Routing is a React Router v7 data
router; the route tree is `app/src/routes.tsx` and the same tree is what the routing tests
render. Every user-visible string lives in `app/src/i18n/sl.ts` (Slovenian); the "Strings"
column names the key group in `t`. Rows marked **placeholder** are navigable stubs that are
built out later in Stage 2 (see `PLAN.md`, "Screens").

## Route table

| Route | Who | Purpose | Strings | Status |
|---|---|---|---|---|
| `/login` | anyone; a signed-in user is sent to `/` | Email and password sign-in. A failed sign-in shows `authErrors` copy. | `login`, `authErrors` | Stage 1 |
| `/invite/:token` | anyone | Sign-up from an invite link: email, password, confirm password. Creates the auth user (or signs in when that account already exists but is unlinked), calls `accept_invite(token)`, reloads the customer record and goes to `/`. A rejected invite shows its `errors.AMRAP_*` copy. | `invite`, `errors`, `authErrors` | Stage 1 |
| `/logout` | anyone | Signs out and redirects to `/login` (a route loader). If signing out fails it stays and shows the error with a continue link. | `logoutFailed`, `common.continue`, `genericError` | Stage 1 |
| `/` | signed in | Redirects to `/t` for the trainer or `/c` for a customer. | none | Stage 1 |
| (any route below `/`) | signed in, customer lookup failed | Error page with a retry button and a sign-out link to `/logout`. | `lookupFailed`, `common.signOut` | Stage 1 |
| (any route below `/`) | signed in, no `customers` row | "Account not linked" page with a sign-out link to `/logout`. Shown instead of the route, URL unchanged. | `notLinked`, `common.signOut` | Stage 1 |
| `/c` | customer | Customer shell: top bar with the app name and a sign-out link to `/logout`, bottom navigation (Home, Calendar, History). Index is Home: balance, next appointment, upcoming list with cancel ([Customer screens](#customer-screens)). | `nav`, `customer`, `slot`, `time`, `cancelDialog` | Stage 2 |
| `/c/koledar` | customer | Week calendar: book open slots, cancel own bookings. | `customer`, `calendar`, `slot`, `cancelDialog` | Stage 2 |
| `/c/zgodovina` | customer | Past and cancelled appointments with status, and the credit ledger. | `customer`, `history`, `appointmentStatus`, `transactionType`, `slot` | Stage 2 |
| `/t` | trainer | Trainer shell: the same top bar with sign-out, bottom navigation (Today, Calendar, Customers, Settings). Index is Today. | `nav`, `trainer` | placeholder |
| `/t/calendar` | trainer | Week view of all customers, capacity per slot. | `trainer.calendarTitle`, `common.comingSoon` | placeholder |
| `/t/customers` | trainer | Balances, ledger, top-up, adjust, invite link. | `trainer.customersTitle`, `common.comingSoon` | placeholder |
| `/t/settings` | trainer | Slot templates, cutoff hours, blocked periods. | `trainer.settingsTitle`, `common.comingSoon` | placeholder |
| anything else | anyone | Redirects to `/`. | none | Stage 1 |

## Customer screens

All three load their data through `app/src/data/` ([data-layer.md](data-layer.md)), show a
loading line first and `customer.loadFailed` if any read fails. Dates and times are in
`settings.timezone` ([time.md](time.md)). After a booking or a cancel the screen reloads its
data.

### Home (`/c`)

- **Data:** `getSettings`, `balanceOf`, `upcomingAppointments` (mine, `booked`, in the future).
- **Balance:** the number from `customer_balances`; when negative it is red with a `dolg` tag
  (`customer.debt`).
- **Next appointment:** the soonest upcoming one, `slot.when` (`ponedeljek, 26. oktober ob
  07:00`) and the time left (`čez 2 d 9 h`, computed when the page loaded). Hidden when there is
  none.
- **Upcoming list:** every upcoming appointment, soonest first, each with **Odpovej**, which opens
  the cancel dialog. Empty: `customer.noUpcoming`.

### Calendar (`/c/koledar`)

- **Week:** Monday to Sunday in the gym timezone, starting with the current week. `‹` and `›`
  (named `calendar.previousWeek` / `nextWeek`) move by a week; `‹` is disabled on the current
  week. The heading shows the range (`26. 10. – 1. 11.`).
- **Data:** `getSettings`, `activeTemplates`, and for the week's range `occupancyBetween`,
  `blockedBetween`, `liveAppointmentsBetween`.
- **Occurrences:** one row per active template in that week, grouped by day (days without any
  are left out; a week without any shows `calendar.noSlots`). A start time in the spring-forward
  gap has no occurrence that week. Each row shows the start time, duration and
  `Prosta mesta: {free} od {capacity}` with `free = capacity − booked_count` (an occurrence
  without a `slot_occupancy` row has `booked_count` 0).
- **States of a row:**

  | State | Shown |
  |---|---|
  | free and in the future | **Rezerviraj**, enabled |
  | full (`free = 0`) | **Polno**, disabled |
  | started or past | **Rezerviraj**, disabled; the row is greyed out |
  | overlaps a blocked period | `· Zaprto`, **Rezerviraj** disabled; greyed out |
  | my live booking | `Rezervirano` tag, plus **Odpovej** while it is `booked` and in the future |

- **Booking:** `book(my id, startsAt, template id)`; success shows `calendar.booked` (a status
  line), a rejection shows its `errors.AMRAP_*` copy (an alert). Book buttons are disabled
  while a booking is in flight.
- **Cancel:** **Odpovej** opens the cancel dialog; success shows `calendar.cancelled`.

### Cancel dialog

- Shows the appointment (`slot.when`), the cutoff (`Brezplačna odpoved do {day} ob {time}`,
  `starts_at − settings.late_cancel_hours`) and, computed when the dialog opens, either
  `cancelDialog.free` (now before the cutoff) or `cancelDialog.late` (`zaračunan 1 kredit`,
  from the cutoff on), like `cancel()`.
- **Odpovej termin** calls `cancel`; on success the dialog closes and the screen reloads. If
  the server rejects it (for example the appointment was charged or cancelled meanwhile), the
  dialog shows the `errors.AMRAP_*` copy and disables the confirm button; **Nazaj** closes it and
  reloads.

### History (`/c/zgodovina`)

- **Data:** `getSettings`, `pastAppointments`, `ledgerOf`.
- **Termini:** every appointment of mine that is not upcoming (past, or cancelled in any way),
  newest first, with date and time and the status label (`appointmentStatus`: Rezervirano for a
  started one not charged yet, Opravljeno, Odpovedano, Pozna odpoved, Odpovedal trener).
- **Krediti:** the ledger, newest first: type label (`transactionType`), the note if any, the
  date and time, and the amount with its sign (`+8`, `−1`; negative in red).

## Access rules

How the guards and the auth state work is in [auth.md](auth.md).

- `RequireAuth` wraps every route except `/login`, `/invite/:token` and `/logout`. While the
  stored session and the customer record are loading it shows a loading line, so a reload never
  flashes the login page. No session redirects to `/login`; a session without a `customers` row
  shows the not-linked page.
- `RequireRole('customer' | 'trainer')` wraps `/c` and `/t`. A user of the other role is
  redirected straight to their own home (`/t` or `/c`).
- If the customers lookup fails (network, server error, paused project) `RequireAuth` shows an
  error page with a retry button and a sign-out link instead of the not-linked page, so an
  outage is not mistaken for an unlinked account.
- The role comes from the signed-in user's `customers` row (`role`), selected by
  `auth_user_id`; it is never read from auth metadata (ADR 0006). The database enforces the
  same split with RLS and RPC role checks, so the guards are navigation, not security.

## Behaviour shared by all screens

- **Keep-alive.** Once per signed-in user per page load, `AuthProvider` runs
  `select id from settings limit 1` (ADR 0005). A failure is logged with `console.warn` and
  never blocks the app. Token refreshes do not repeat it.
- **Error copy.** `fromError(error)` turns a PostgREST error (`AMRAP_<TOKEN>: detail`) or a
  Supabase Auth error code into Slovenian copy; anything else gets `genericError`.
- **Environment.** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required. Without
  them `start.tsx` shows a start-up error page (`startupError`) naming the missing variable
  instead of a blank page ([runbook.md](runbook.md#cloudflare-pages-build-settings)).
- **PWA.** `registerType: 'autoUpdate'`, `display: standalone`, manifest language `sl`, icons
  192 and 512 px. Cloudflare Pages falls back to `index.html` for unknown paths natively;
  `app/public/_redirects` is a belt-and-braces measure
  ([runbook.md](runbook.md#cloudflare-pages-build-settings)).
