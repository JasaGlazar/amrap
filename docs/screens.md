# Screens

The app (`app/`) is one single-page app with role-gated areas. Routing is a React Router v7 data
router; the route tree is `app/src/routes.tsx` and the same tree is what the routing tests
render. Every user-visible string lives in `app/src/i18n/sl.ts` (Slovenian); the "Strings"
column names the key group in `t`. Every screen of `PLAN.md` "Screens" exists as of Stage 2.

## Route table

| Route | Who | Purpose | Strings | Status |
|---|---|---|---|---|
| `/login` | anyone; a signed-in user is sent to `/` | Email and password sign-in. A failed sign-in shows `authErrors` copy. | `login`, `authErrors` | Stage 1 |
| `/invite/:token` | anyone | Sign-up from an invite link: email, password, confirm password. Creates the auth user (or signs in when that account already exists but is unlinked), calls `accept_invite(token)`, reloads the customer record and goes to `/`. A rejected invite shows its `errors.AMRAP_*` copy. | `invite`, `errors`, `authErrors` | Stage 1 |
| `/logout` | anyone | Removes this device's push subscription (best effort), signs out and redirects to `/login` (a route loader). If signing out fails it stays and shows the error with a continue link. | `logoutFailed`, `common.continue`, `genericError` | Stage 1, push Stage 3 |
| `/` | signed in | Redirects to `/t` for the trainer or `/c` for a customer. | none | Stage 1 |
| (any route below `/`) | signed in, customer lookup failed | Error page with a retry button and a sign-out link to `/logout`. | `lookupFailed`, `common.signOut` | Stage 1 |
| (any route below `/`) | signed in, no `customers` row | "Account not linked" page with a sign-out link to `/logout`. Shown instead of the route, URL unchanged. | `notLinked`, `common.signOut` | Stage 1 |
| `/c` | customer | Customer shell: top bar with the app name and a sign-out link to `/logout`, bottom navigation (Home, Calendar, History). Index is Home: balance, next appointment, upcoming list with cancel, notifications toggle ([Customer screens](#customer-screens)). | `nav`, `customer`, `slot`, `time`, `cancelDialog`, `pushToggle` | Stage 2, push Stage 3 |
| `/c/koledar` | customer | Week calendar: book open slots, cancel own bookings. | `customer`, `calendar`, `slot`, `cancelDialog` | Stage 2 |
| `/c/zgodovina` | customer | Past and cancelled appointments with status, and the credit ledger. | `customer`, `history`, `appointmentStatus`, `transactionType`, `slot` | Stage 2 |
| `/t` | trainer | Trainer shell: the same top bar with sign-out, bottom navigation (Today, Calendar, Customers, Settings). Index is Today: debtors and today's occurrences with names ([Trainer screens](#trainer-screens)). | `nav`, `trainer`, `calendar`, `slot` | Stage 2 |
| `/t/koledar` | trainer | Week calendar of all customers: add a customer to an occurrence, ad-hoc appointments, cancel any appointment. | `trainer`, `calendar`, `slot`, `cancelDialog` | Stage 2 |
| `/t/stranke` | trainer | Customer list with balance and invite status; create a customer. | `trainer`, `customers` | Stage 2 |
| `/t/stranke/:id` | trainer | One customer: credits, invite link, recurring rules, upcoming appointments, details, ledger. | `customerDetail`, `customers`, `customer`, `slot`, `cancelDialog`, `transactionType` | Stage 2 |
| `/t/nastavitve` | trainer | Slot templates, cutoff hours, blocked periods, notifications toggle. | `settings`, `trainer`, `pushToggle` | Stage 2, push Stage 3 |
| anything else | anyone | Redirects to `/`. | none | Stage 1 |

## Customer screens

All three load their data through `app/src/data/` ([data-layer.md](data-layer.md)), show a
loading line first and `common.loadFailed` if any read fails. Dates and times are in
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
  the cancel dialog; a successful cancel shows `cancelDialog.done` (a status line). Empty:
  `customer.noUpcoming`.
- **Obvestila:** the notifications toggle with the customer hint (`pushToggle.customerHint`),
  see [Notifications toggle](#notifications-toggle).

### Calendar (`/c/koledar`)

- **Week:** Monday to Sunday in the gym timezone, starting with the current week. `‹` and `›`
  (named `calendar.previousWeek` / `nextWeek`) move by a week and stay in place while a week
  loads; `‹` is disabled on the current week. The heading shows the range (`26. 10. – 1. 11.`).
- **Data:** `loadWeek` with my customer id ([data-layer.md](data-layer.md#week)); blocked
  periods are checked past the week's end for an occurrence late on Sunday.
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
  line), a rejection shows its `errors.AMRAP_*` copy (an alert). Book buttons stay disabled
  until the booking has finished and the week has reloaded, so a double tap cannot book twice.
- **Cancel:** **Odpovej** opens the cancel dialog; success shows `cancelDialog.done`.

### Cancel dialog

- Shows the appointment (`slot.when`), the cutoff (`Brezplačna odpoved do {day} ob {time}`,
  `starts_at − settings.late_cancel_hours`) and either `cancelDialog.free` (now before the
  cutoff) or `cancelDialog.late` (`zaračunan 1 kredit`, from the cutoff on), like `cancel()`.
- It takes focus when it opens; Escape and **Nazaj** close it.
- **Odpovej termin** first re-checks free vs late against the current time. If the answer
  changed since the dialog opened (it stayed open past the cutoff), it only switches the copy
  and does not cancel; a second click confirms. Otherwise it calls `cancel`; on success the
  dialog closes and the screen reloads. If
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

## Trainer screens

The trainer reads every customer's rows (RLS `for all`); names come from `listCustomers` and
are matched to appointments by customer id. Load failures show `common.loadFailed`.

### Today (`/t`)

- **Data:** `loadWeek` for the current week (all customers), `listCustomers`, `allBalances`.
- **Debtors:** every customer with a negative balance, most negative first, each a link to
  their detail page with the balance in red. None: `trainer.noDebtors`.
- **Today's occurrences:** the week's occurrences on today's local date, each with remaining
  capacity (as in the customer calendar) and the names of the customers booked (`booked` or
  `charged`, the latter tagged `opravljeno`). Nothing today: `trainer.noSlotsToday`.
- **Termini zunaj urnika:** today's live appointments that match no shown occurrence, with
  time range, name and a tag: `po dogovoru` (ad hoc, no template) or `ni več v urniku` (their
  template was deactivated or its weekday or start time changed; they are still booked and the
  charge job still charges them). Shown only when there are any. Read-only; changes are made in
  the calendar.

### Calendar (`/t/koledar`)

- **Week:** like the customer calendar, but `‹` is never disabled: the trainer can open past
  weeks (to record a session after the fact; `book()` lets the trainer book past occurrences).
- **Data:** `loadWeek` without a customer id (all customers' live appointments) and
  `listCustomers`.
- **Occurrence row:** start, duration, remaining capacity, blocked state, then the booked
  customers (names, `opravljeno` for charged), each with **Odpovej**, and an add control: a
  customer select (named `Stranka za termin {when}`; customers already booked there are left
  out) with **Dodaj**, disabled while the occurrence is full or blocked or another booking is in
  flight. **Dodaj** calls `book(customer, startsAt, template)`; success shows `trainer.added`,
  a rejection its `errors.AMRAP_*` copy.
- **Termini zunaj urnika:** the week's live appointments that match no shown occurrence
  (`appointmentsOutsideSlots`): ad-hoc ones (`po dogovoru`) and bookings left behind by a
  deactivated or moved template (`ni več v urniku`), with day, time range and name, each with
  **Odpovej**. None: `trainer.noOther`.
- **Nov termin po dogovoru:** a form with customer, date
  (defaults to the week's Monday), start and end time. The date and times are converted with
  `zonedInstant` in the gym timezone ([time.md](time.md)); a time that does not exist that day
  shows `trainer.invalidTime`, an end not after the start `trainer.invalidRange`, no customer
  `trainer.missingCustomer`. Submit calls `book` without a template (`p_ends_at`); ad-hoc
  appointments have no capacity.
- **Cancel:** the cancel dialog in trainer mode: the customer's name, no cutoff, and
  `cancelDialog.noCharge` for a booked appointment or `cancelDialog.refund` ("s povračilom",
  +1 credit) for a charged one, matching what `cancel()` does for the trainer.

### Customers (`/t/stranke`)

- **Data:** `listCustomers` (customer records only, not the trainer's own row) and
  `allBalances`.
- **List:** by name; each row links to the detail page and shows the invite status
  (`customers.inviteStatus`: linked, pending = an unexpired token, none) and the balance (red
  when negative).
- **Nova stranka:** name (required, `customers.nameRequired`), phone and email (empty becomes
  null). Submit inserts the record through RLS (`createCustomer`) and opens its detail page.

### Customer detail (`/t/stranke/:id`)

- **Data:** `getCustomer`, `getSettings`, `balanceOf`, `ledgerOf`, `upcomingAppointments`,
  `rulesOf`, `allTemplates`. A missing record (or the trainer's own id) shows the load error
  with the back link.
- **Header:** name, balance (red with `dolg` when negative) and invite status.
- **Krediti:** one amount field and a note. **Dodaj kredite** calls `top_up` (a positive whole
  number, else `customerDetail.topUpInvalid`); **Popravi stanje** calls `adjust` (any non-zero
  whole number, negative subtracts; else `customerDetail.adjustInvalid`). Waiving a late
  cancel is an adjustment of +1.
- **Povabilo:** for an unlinked record, **Ustvari povabilo** calls `create_invite` and shows
  the full link `${location.origin}/invite/<token>` in a read-only field (focus selects it) with
  **Kopiraj** (clipboard; `customerDetail.copied`, or `customerDetail.copyFailed` when the
  browser refuses, e.g. without HTTPS) and the 7-day hint. A pending invite's link is shown on load, and the button
  becomes **Ustvari novo povabilo** (a new token replaces the old one). A linked record shows
  the re-link hint pointing to the runbook ("Re-link a customer", ADR 0007) instead.
- **Stalni termini:** the customer's recurring rules (`{weekday} ob {time}`, stopped ones
  greyed with `ustavljen`). **Ustavi** calls `deactivate_rule` (future booked instances are
  cancelled; the message shows how many); **Ponovno vključi** calls `activate_rule` (shows how
  many instances were created; cancelled dates stay cancelled, ADR 0008). The add control
  lists active templates that have no rule for this customer yet (a stopped rule is restarted
  with **Ponovno vključi**, not added again); **Dodaj stalni termin**
  inserts the rule and activates it, which materializes it right away.
- **Prihajajoči termini:** the customer's upcoming booked appointments, each with **Odpovej**
  (trainer cancel dialog).
- **Opravljeni termini (zadnjih 30 dni):** the customer's charged appointments that started in
  the last 30 days (`RECENT_DAYS`), newest first, each with **Odpovej**; the trainer cancel
  dialog says the credit is refunded (`cancelDialog.refund`), and `cancel()` adds the +1
  refund. Older charges are corrected with an adjustment.
- **Podatki:** name, phone, email; **Shrani** updates the record through RLS.
- **Zgodovina kreditov:** the ledger, as on the customer's History.

### Settings (`/t/nastavitve`)

- **Data:** `getSettings`, `allTemplates` (active and inactive), `upcomingBlocked` (periods
  that have not ended). Every write goes through RLS and shows `settings.saved` or the error.
- **Termini v tednu:** each template as `{weekday} ob {time} · {minutes} min · {capacity}
  mest`, inactive ones greyed with `neaktiven`, each with **Uredi** (the form inline). The form
  (also **Nov termin** below the list): weekday, start time, duration in minutes, capacity and
  an active checkbox. Validation: start time required, duration and capacity positive whole
  numbers (`settings.durationInvalid`, `settings.capacityInvalid`). There is no delete: a
  template that has appointments or rules cannot be deleted, so it is deactivated (customers no
  longer see or book it, materialization skips it). Changing a template's time or weekday does
  not move appointments already booked.
- **Stranded bookings:** saving a deactivation, or a weekday or start-time change, of an
  active template first counts its future `booked` appointments (`futureBookedCount`). If there
  are any, the form shows `settings.strandedWarning` with the count (they stay booked and
  charged and appear under "Termini zunaj urnika" in the trainer calendar) and saves only when
  **Shrani** is clicked again with the same values. The form is busy while the count is read;
  if the read fails, the section shows the error (`genericError` for a network failure) and
  nothing is saved. Capacity, duration and reactivation save at once.
- **Rok za brezplačno odpoved:** `settings.late_cancel_hours`, a whole number of hours, 0 or
  more (`settings.cutoffInvalid`). It applies to every later cancel and to the customers'
  cancel dialog.
- **Zaprta obdobja:** upcoming blocked periods with their range and reason, each with
  **Uredi** and **Izbriši** (deletes at once). The form (also **Novo zaprto obdobje**): from
  date and time, to date and time (in the gym timezone, via `zonedInstant`) and an optional
  reason; a time that does not exist that day or an end not after the start is rejected
  (`trainer.invalidTime`, `trainer.invalidRange`). A new block does not cancel appointments
  already booked in it; `book()` and materialization reject or skip later ones.
- **Obvestila:** the notifications toggle with the trainer hint (`pushToggle.trainerHint`).

## Notifications toggle

`pages/shared/PushToggle.tsx`, a card titled `pushToggle.title` on the customer Home and the
trainer Settings. It applies to this browser or installed app only. How push works end to end
is in [notifications.md](notifications.md).

| State | When | Shows |
|---|---|---|
| install hint | iOS and not opened from the home screen | `pushToggle.needsInstall` (Share, Add to Home Screen, open from there) |
| unsupported | no service worker, Push API or Notification API | `pushToggle.unsupported` |
| unavailable | the build has no `VITE_VAPID_PUBLIC_KEY` | `pushToggle.noKey` |
| blocked | the browser's notification permission is `denied` | `pushToggle.blocked` |
| off | supported, and no browser subscription, or one the server no longer has | `pushToggle.off` and **Vklopi obvestila** |
| on | a browser subscription that is saved for the signed-in user | `pushToggle.on` and **Izklopi obvestila** |

**Vklopi obvestila** asks for permission (only if not granted yet), subscribes the browser with
the VAPID key and saves it with `save_push_subscription`; a refusal shows `pushToggle.denied`
(then the state becomes blocked), a failed browser subscription `pushToggle.failed`, a server
error its `fromError` copy. **Izklopi obvestila** deletes this device's row and unsubscribes
the browser. Success shows `pushToggle.enabled` / `pushToggle.disabled` (a status line). The
state is loaded once and again after each action; the button is disabled while one runs.

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
- **PWA.** A custom service worker (`src/sw.ts`, vite-plugin-pwa `injectManifest`) precaches
  the build, updates itself (`skipWaiting` + `clientsClaim`, the `autoUpdate` behaviour) and
  shows push notifications ([notifications.md](notifications.md#service-worker)).
  `display: standalone`, manifest language `sl`, icons
  192 and 512 px. Cloudflare Pages falls back to `index.html` for unknown paths natively;
  `app/public/_redirects` is a belt-and-braces measure
  ([runbook.md](runbook.md#cloudflare-pages-build-settings)).
