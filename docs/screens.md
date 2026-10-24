# Screens

The app (`app/`) is one single-page app with role-gated areas. Routing is a React Router v7 data
router; the route tree is `app/src/routes.tsx` and the same tree is what the routing tests
render. Every user-visible string lives in `app/src/i18n/sl.ts` (Slovenian); the "Strings"
column names the key group in `t`. Every screen of `PLAN.md` "Screens" exists as of Stage 2.

## Route table

| Route | Who | Purpose | Strings | Status |
|---|---|---|---|---|
| `/login` | anyone; a signed-in user is sent to `/` | Email and password sign-in: heading **Prijava**, button **Prijavi se** (a heading and its button never say the same thing). A failed sign-in shows `authErrors` copy. | `login`, `authErrors` | Stage 1 |
| `/invite/:token` | anyone | Sign-up from an invite link (heading **Nov račun**, button **Ustvari račun**): email, password, confirm password. Creates the auth user (or signs in when that account already exists but is unlinked), calls `accept_invite(token)`, reloads the customer record and goes to `/`. A rejected invite shows its `errors.AMRAP_*` copy. | `invite`, `errors`, `authErrors` | Stage 1 |
| `/logout` | anyone | Removes this device's push subscription (best effort), signs out and redirects to `/login` (a route loader). If signing out fails it stays and shows the error with a continue link. | `logoutFailed`, `common.continue`, `genericError` | Stage 1, push Stage 3 |
| `/` | signed in | Redirects to `/t` for the trainer or `/c` for a customer. | none | Stage 1 |
| (any route below `/`) | signed in, customer lookup failed | Error page with a retry button and a sign-out link to `/logout`. | `lookupFailed`, `common.signOut` | Stage 1 |
| (any route below `/`) | signed in, no `customers` row | "Account not linked" page with a sign-out link to `/logout`. Shown instead of the route, URL unchanged. | `notLinked`, `common.signOut` | Stage 1 |
| `/c` | customer | Customer shell: top bar with the framed wordmark and the [account menu](#account-menu) (theme, sign-out), the [install card](#install-card), the [main navigation](#main-navigation) (Home, Calendar, History). Index is Home: balance, next appointment, upcoming list with cancel, notifications toggle ([Customer screens](#customer-screens)). | `nav`, `account`, `install`, `customer`, `slot`, `time`, `cancelDialog`, `pushToggle` | Stage 2, push Stage 3, install Stage 4, account menu Stage 6, nav in the top bar Stage 7 |
| `/c/koledar` | customer | Week calendar: book open slots, cancel own bookings. | `customer`, `calendar`, `slot`, `cancelDialog` | Stage 2 |
| `/c/zgodovina` | customer | Past and cancelled appointments with status, and the credit ledger. | `customer`, `history`, `appointmentStatus`, `transactionType`, `slot` | Stage 2 |
| `/t` | trainer | Trainer shell: the same top bar with the [account menu](#account-menu), the [install card](#install-card), the [main navigation](#main-navigation) (Today, Calendar, Customers, Settings). Index is Today: debtors and today's occurrences with names ([Trainer screens](#trainer-screens)). | `nav`, `account`, `install`, `trainer`, `calendar`, `slot` | Stage 2, install Stage 4, account menu Stage 6, nav in the top bar Stage 7 |
| `/t/koledar` | trainer | Week calendar of all customers: add a customer to an occurrence, ad-hoc appointments, cancel any appointment. | `trainer`, `calendar`, `slot`, `cancelDialog`, `common` | Stage 2, add control and forms on demand Stage 7 |
| `/t/stranke` | trainer | Customer list with balance and, for customers without an account, invite status; search and filters kept in the query (`?q=…&f=…`); create a customer. | `trainer`, `customers`, `common` | Stage 2, form on demand Stage 7, search and filters Stage 9 |
| `/t/stranke/:id` | trainer | One customer: balance and credits, upcoming appointments, recurring rules, recent sessions, ledger, invite link, details. | `customerDetail`, `customers`, `customer`, `slot`, `cancelDialog`, `transactionType`, `common` | Stage 2, order and forms on demand Stage 7 |
| `/t/nastavitve` | trainer | Settings, one tab per topic ([Settings](#settings-tnastavitve)); the bare path redirects to `/t/nastavitve/urnik`. | `settings` | Stage 2, tabs Stage 7 |
| `/t/nastavitve/urnik` | trainer | Tab **Urnik**: slot templates, a week grid from 768 px and day groups below. | `settings`, `trainer` | Stage 2, own route Stage 7, week grid Stage 9 |
| `/t/nastavitve/odpoved` | trainer | Tab **Odpoved**: cutoff hours. | `settings` | Stage 2, own route Stage 7 |
| `/t/nastavitve/zaprto` | trainer | Tab **Zaprta obdobja**: blocked periods. | `settings`, `trainer`, `slot` | Stage 2, own route Stage 7 |
| `/t/nastavitve/obvestila` | trainer | Tab **Obvestila**: notifications toggle. | `pushToggle` | Stage 3, own route Stage 7 |
| anything else | anyone | Redirects to `/`. | none | Stage 1 |

## Customer screens

All three load their data through `app/src/data/` ([data-layer.md](data-layer.md)), show a
loading line first and `common.loadFailed` if any read fails. Dates and times are in
`settings.timezone` ([time.md](time.md)). After a booking or a cancel the screen reloads its
data.

### Home (`/c`)

- **Data:** `getSettings`, `balanceOf`, `upcomingAppointments` (mine, `booked`, in the future).
- **Balance:** the label, then the number from `customer_balances` (a
  [signed number](#behaviour-shared-by-all-screens), `−3`) in the frame, 3.5 rem condensed;
  when negative it is red with a `dolg` tag (`customer.debt`).
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
  without a `slot_occupancy` row has `booked_count` 0). The duration, the places and `Zaprto`
  are unbreakable parts and each `·` separator ends the part before it: a narrow row wraps
  between parts, never inside one, and a wrapped line never starts with `·`.
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

- Below 768 px it is a bottom sheet (top corners rounded, safe-area padding at the bottom);
  from 768 px it is centred, with all corners rounded and a margin from the window edges.
- Shows the appointment (`slot.when`), the cutoff (`Brezplačna odpoved do {day} ob {time}`,
  `starts_at − settings.late_cancel_hours`) and either `cancelDialog.free` (now before the
  cutoff) or `cancelDialog.late` (`zaračunan bo 1 kredit`, from the cutoff on), like `cancel()`.
- While it is open the page behind it does not scroll (`overflow: hidden` on the root element,
  restored to its previous value on close). iOS Safari has ignored this for touch scrolling in
  some versions; checked on a real iPhone as an owner action.
- It takes focus when it opens and keeps Tab and Shift+Tab inside, also when focus has left it
  (for example the focused **Odpovej termin** was disabled after a server error: the next Tab
  goes to the first enabled button, Shift+Tab to the last). Escape and **Nazaj** close it. On
  close, focus returns to the button that opened it when that button still exists and had
  focus (keyboard, desktop browsers); on iOS a tap does not focus a button, so there is
  nothing to return to.
- **Odpovej termin** first re-checks free vs late against the current time. If the answer
  changed since the dialog opened (it stayed open past the cutoff), it only switches the copy
  and does not cancel; a second click confirms. Otherwise it calls `cancel`; on success the
  dialog closes and the screen reloads. If
  the server rejects it (for example the appointment was charged or cancelled meanwhile), the
  dialog shows the `errors.AMRAP_*` copy and disables the confirm button; **Nazaj** closes it and
  reloads.

### History (`/c/zgodovina`)

- **Data:** `getSettings`, `pastAppointments`, `ledgerOf` (the first page of each).
- **Termini** and **Krediti** each show the newest 10 rows and **Pokaži več**
  ([below](#show-more)); the empty lines stay as they were.
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
  their detail page with the balance in red (`−3`, the same minus as the ledger). None:
  `trainer.noDebtors`.
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
  customers (names, `opravljeno` for charged), each with **Odpovej**, and one small **Dodaj
  stranko** (`trainer.addCustomer`) at the right, on the same line as `Ni prijavljenih strank.`
  when nobody is booked. Pressing it replaces it with the add control ([on
  demand](#forms-on-demand)): a customer select (named `Stranka za termin {when}`, focused;
  customers already booked there are left out), **Dodaj** (disabled, neutral grey, until a
  customer is chosen and while another booking is in flight) and **Prekliči**. One add control
  is open at a time: opening another closes the first, and so does moving to another week.
  **Dodaj** calls `book(customer, startsAt, template)`; success closes the control and shows
  `trainer.added`, a rejection keeps it open and shows its `errors.AMRAP_*` copy (unless the
  reload shows the occurrence full or blocked now: then the control closes into the disabled
  button). When the
  occurrence cannot take anyone, the button is disabled and says why instead: **Zaprto**
  (`calendar.blocked`, it overlaps a blocked period), **Polno** (`calendar.full`, no free
  place) or **Ni strank za dodajanje** (`trainer.noneToAdd`: every customer is already booked
  there, or there are no customers yet, as on the first day before Stranke is filled in). A
  reload that leaves any of these closes an open control. Past occurrences keep the button (the trainer records a session after the fact).
- **Termini zunaj urnika:** the week's live appointments that match no shown occurrence
  (`appointmentsOutsideSlots`): ad-hoc ones (`po dogovoru`) and bookings left behind by a
  deactivated or moved template (`ni več v urniku`), with day, time range and name, each with
  **Odpovej**. None: `trainer.noOther`.
- **Nov termin po dogovoru:** a button at the right of the title opens, under the title, a
  form ([on demand](#forms-on-demand)) with customer, date (defaults to the shown week's
  Monday), start and end time. Moving to another week closes the form (what was typed is
  dropped) and the button is disabled while that week loads, so the form never shows without
  the week it belongs to. The date and times are converted with
  `zonedInstant` in the gym timezone ([time.md](time.md)); a time that does not exist that day
  shows `trainer.invalidTime`, an end not after the start `trainer.invalidRange`, no customer
  `trainer.missingCustomer`. **Dodaj termin** calls `book` without a template (`p_ends_at`);
  ad-hoc appointments have no capacity. Success closes the form and shows `trainer.added`.
- **Cancel:** the cancel dialog in trainer mode: the customer's name, no cutoff, and
  `cancelDialog.noCharge` for a booked appointment or `cancelDialog.refund` ("z vračilom",
  +1 credit) for a charged one, matching what `cancel()` does for the trainer.

### Customers (`/t/stranke`)

- **Data:** `listCustomers` (customer records only, not the trainer's own row) and
  `allBalances`.
- **List:** by name in Slovenian order (`localeCompare(…, 'sl')`, so Č follows C); each row
  links to the detail page and shows the balance (red when
  negative; a positive or zero balance is plain ink, so debtors stand out). A tag shows the invite status only while the
  customer has no account (`customers.inviteStatus`: pending = an unexpired token, none); a
  linked account is the normal end state and has no tag.
- **Search** (`customers.search`, a `role="search"` block under the title, so **Nova stranka**
  keeps the title row to itself on a phone): one `type="search"` field, 16 px,
  `autoComplete="off"`, filtering the list already loaded as the trainer types
  (`lib/customerSearch.ts`). Case and diacritics are ignored (`normalize('NFD')` without the
  combining marks, and đ as d), so "zupancic" finds "Zupančič". A query of words matches when
  every word is in the name or the email ("novak ana" finds "Ana Novak"). A query of digits
  (spaces, `+`, `-`, `/`, `.` and brackets allowed) matches the phone instead, ignoring spaces,
  with `+386` and `00386` read as a leading 0 (only after `+` or `00`, so "386 111" still
  finds "040 386 111" and "386" alone is not every number), so "040111" finds
  "+386 40 111 111".
- **Filters:** a segmented control (`customers.filterLabel`, buttons with `aria-pressed`):
  **Vsi**, **Dolžniki** (balance below 0) and **Brez računa** (no account; a customer with
  a pending invite is in it too and keeps the **Povabilo čaka** tag, so there is no separate
  filter for invites). A filter combines with the search. The pressed segment is framed in
  `--ink` on paper, not filled, so the screen keeps one black button.
- **Count and empty state:** above the list, `customers.total` ("9 strank") or, while a
  search or filter narrows it, `customers.shown` ("Prikazanih 7 od 9"), both plural forms of
  the shown count, in a `role="status"` line that stays in place, so a screen reader hears
  the new count as the trainer types. When nothing matches, the same line says
  `customers.noMatches`, with **Počisti iskanje** under it, which empties the search, returns to **Vsi** and puts focus in
  the search field. With no customers at all the list says `customers.noCustomers`.
- **List state in the URL:** the search is `q` and the filter `f` (`dolzniki`, `brez`; none
  for **Vsi**), written with `replace`, so typing never adds history entries and the browser's
  back button leaves the list as a whole. Each row link carries the list's query string in its
  navigation state, so both the browser's back button and **Nazaj na stranke** on the detail
  page return to the same search and filter. The field keeps its own value while typing (the
  URL follows), so the caret stays where the trainer types; any navigation other than the
  field's own replace (for example **Stranke** in the main navigation, or the browser's back
  button to a list that was searched) sets it from the URL.
- **Nova stranka:** a button at the right of the page title opens, under the title, a form
  ([on demand](#forms-on-demand)): name (required, `customers.nameRequired`), phone and email (empty becomes
  null), and an optional starting balance from the paper sheet (`customers.startingBalance`, a
  whole number that may be negative, else `customers.startingInvalid`; nothing is created then).
  A value the browser cannot read as a number (`validity.badInput`, for example `2,5` or `3-`
  typed on a phone keyboard, which reaches the app as an empty value) is rejected the same way
  instead of being taken as "no starting balance".
  Submit inserts the record through RLS (`createCustomer`). A positive starting balance is then
  recorded with `top_up`, a negative one with `adjust`, both with the note
  `customerDetail.startingNote`; empty or 0 records nothing. Then the detail page opens. If the
  credit call fails, the detail page still opens (the customer exists once) and its **Krediti**
  section shows `customerDetail.startingFailed` with the error, with the amount and the note
  already filled in, so one tap records it. The message comes through the navigation state,
  which the detail page clears at once, so a reload does not show it again.

### Customer detail (`/t/stranke/:id`)

- **Data:** `getCustomer`, `getSettings`, `balanceOf`, `ledgerOf` and `chargedSince` (the
  first page of each), `upcomingAppointments`, `rulesOf`, `allTemplates`. A missing record (or the trainer's own id) shows the load error
  with the back link.
- **Back link:** **Nazaj na stranke** returns to the list with the search and filter it was
  opened from (the list's query string in the navigation state, kept when the page clears its
  starting-balance message).
- **Order:** the back link and the name, then the balance with **Krediti** beside it, then
  **Prihajajoči termini**, **Stalni termini**, **Opravljeni termini**, **Zgodovina kreditov**,
  and lower down **Povabilo** and **Podatki** (set up once, rarely changed).
- **Balance:** the label `Stanje kreditov` and the invite status tag on one line and the framed
  balance below (red with `dolg` when negative), on the page rather than in a card. From 768 px
  the balance and the **Krediti** card sit side by side (a two-column grid: the balance as wide
  as it needs, the card the rest); below 768 px the card comes under the balance.
- **Krediti:** always open (the screen's main action): one amount field and a note. **Dodaj kredite** calls `top_up` (a positive whole
  number, else `customerDetail.topUpInvalid`); **Popravi stanje** calls `adjust` (any non-zero
  whole number, negative subtracts; else `customerDetail.adjustInvalid`). Waiving a late
  cancel is an adjustment of +1. While the customer has no ledger rows the note is prefilled
  with `customerDetail.startingNote`, so a starting balance entered here is marked the same
  way; it can be edited or cleared.
- **Prihajajoči termini:** the customer's upcoming booked appointments, each with **Odpovej**
  (trainer cancel dialog).
- **Stalni termini:** the customer's recurring rules (`{weekday} ob {time}`, stopped ones
  greyed with a `ustavljen` tag next to the text). **Ustavi** calls `deactivate_rule` (future booked instances are
  cancelled; the message shows how many); **Ponovno vključi** calls `activate_rule` (shows how
  many instances were created; cancelled dates stay cancelled, ADR 0008). The add control
  lists active templates that have no rule for this customer yet (a stopped rule is restarted
  with **Ponovno vključi**, not added again). **Dodaj stalni termin** at the right of the heading
  opens it ([on demand](#forms-on-demand)): a card **Nov stalni termin** with the select
  (`customerDetail.ruleTemplate`), **Dodaj stalni termin** (disabled until a template is
  chosen) and **Prekliči**; submitting inserts the rule and activates it, which materializes it
  right away, and closes the card.
- **Opravljeni termini (zadnjih 30 dni):** the customer's charged appointments that started in
  the last 30 days (`RECENT_DAYS`), newest first, each with **Vrni kredit**
  (`customerDetail.refund`; the action is a cancel with a refund, so it is not labelled
  **Odpovej**); the trainer cancel dialog says the credit is refunded (`cancelDialog.refund`),
  and `cancel()` adds the +1 refund. Older charges are corrected with an adjustment. The newest
  10 and **Pokaži več** ([below](#show-more)).
- **Zgodovina kreditov:** the ledger, as on the customer's History, 10 at a time with **Pokaži
  več**.
- **After an action** (credits, a cancel or refund, a rule) the page reloads, and both paged
  lists start again from their newest 10.
- **Povabilo:** for an unlinked record, **Ustvari povabilo** calls `create_invite` and shows the
  full link `${location.origin}/invite/<token>` in a read-only field (focus selects it) with
  **Kopiraj** (clipboard; `customerDetail.copied`, or `customerDetail.copyFailed` when the
  browser refuses, e.g. without HTTPS) and the 7-day hint. A pending invite's link is shown on
  load, and the button becomes **Ustvari novo povabilo** (a new token replaces the old one). A
  linked record shows the re-link hint instead (`customerDetail.relinkHint`): if the customer
  loses access, the app administrator removes the old account, then the trainer creates a new
  invite on this page. The procedure is runbook "Re-link a customer" (ADR 0007).
- **Podatki:** phone and email as text (`customerDetail.notGiven` when empty; the name is the
  title). **Uredi podatke** at the right of the heading opens the form ([on
  demand](#forms-on-demand)) with name, phone and email filled in; **Shrani** updates the record
  through RLS, closes the form and shows `customerDetail.saved`; an error stays in the form.

### Settings (`/t/nastavitve`)

- **Layout:** the title **Nastavitve**, then a row of tabs, a `nav` named
  `settings.sectionsLabel`: **Urnik** (`urnik`), **Odpoved** (`odpoved`), **Zaprta obdobja**
  (`zaprto`), **Obvestila** (`obvestila`), each a link to its own route with
  `aria-current="page"` on the open one (`--ink` with a 2 px underline on the row's 1 px
  `--line`; the others `--muted`). Below 768 px the tabs spread across the column (wrapping on a screen
  too narrow for one line), from 768 px
  they sit left aligned. `/t/nastavitve` redirects to `/t/nastavitve/urnik` (replacing the
  history entry), and the main navigation's **Nastavitve** stays current on every tab.
- **Data:** each tab loads only what it shows: **Urnik** `allTemplates` (active and inactive),
  **Odpoved** `getSettings`, **Zaprta obdobja** `getSettings` (the timezone) and
  `upcomingBlocked` (periods that have not ended). Every write goes through RLS and shows
  `settings.saved` or the error.
- **Termini v tednu** (tab **Urnik**): every template, active and inactive, in one of two
  layouts chosen by the window width (`useMediaQuery('(min-width: 48rem)')`, so only one is
  in the page and a screen reader or a test never meets both):
  - **From 768 px, a week grid** (`TemplateWeek.tsx`, `WeekGrid`): seven columns,
    **Ponedeljek** to **Nedelja** (`weekdayHeading`, each an `h3` naming its column, a
    `section`, so a screen reader can move day by day), and a time axis on the left from the
    earliest start to the latest end, rounded out to the hour (`axisRange` in
    `lib/schedule.ts`), with a hairline per hour. Each template is a block placed by its start
    and sized by its duration (5 rem an hour, so a 60-minute block holds its text), showing
    `settings.timeRange` ("07:00–08:00", breaking only after the dash) and the places
    (`settings.places`). Blocks that overlap in time sit side by side within the column
    (`dayLanes`: a group of slots that overlap one another shares the column in lanes, a lane
    is reused once it is free; touching slots do not share). An inactive template is muted
    (paper background, a dotted edge, muted text) with the `neaktiven` tag. Each block is a
    `button` whose name says everything its position shows (`settings.blockLabel`:
    "Ponedeljek 07:00, 60 min, 5 mest, uredi", with ", neaktiven" when inactive and
    ", prekrivanje" when it overlaps). The axis is `aria-hidden`.
  - **Overlap mark:** an active template that overlaps another active one on the same day
    (`overlappingIds`, the same rule as the warning below) has a 2 px dashed `--ink` edge
    instead of the solid one and the tag `settings.overlapping` ("prekrivanje"), in both
    themes and not by colour. A line above the grid explains the edges that are in it:
    `settings.overlapLegend` while any slots overlap, `settings.inactiveLegend` while any
    template is inactive. The block's tags are set in the condensed cut; a lane too
    narrow for them (under 4.75 rem, which slots side by side usually are) hides its tags
    by a container query, and the dashed or dotted edge and the
    button's name still carry them.
  - **Tap size:** every block is at least 44 × 44 px (`--tap`). Height: a block shorter
    than that (a 15- or 30-minute slot) is drawn 44 px tall and may cover the top of a slot
    right after it; the focused block is drawn above its neighbours. Width: the grid passes
    the most slots side by side on any day (`--max-lanes`) and every day column is at least
    that many lanes of 44 px plus their 4 px gaps (and never under 7 rem), so a lane is never
    narrower than a tap target. The grid is a [wide view](#behaviour-shared-by-all-screens):
    from 1024 px it starts at the title's left edge and grows to the right; when its columns
    need more room than it has (768-1023 px, or many lanes), it scrolls sideways inside its
    own box, the hours column staying in place, and the page itself never scrolls sideways.
  - **Clicking a block** opens the edit form (`settings.editTemplate`) in a dialog
    (`TemplateDialog.tsx`, the cancel dialog's overlay and focus rules through
    `pages/shared/modal.ts`): focus moves to its first field (**Dan**), Tab stays inside,
    **Prekliči** or Escape closes it (not while a save or count runs) and focus returns to
    the block; a successful save closes it, the section shows `settings.saved` and focus is on
    the block again (found by its template id if the save moved it to another day). A
    rejected save shows its error inside the dialog only (not again behind it). The dialog
    never grows past the window (`max-height` with its own scroll), so **Shrani** stays
    reachable with both warnings on a phone held sideways, which is past 768 px. Empty cells do nothing; **Nov termin**
    stays the way to add a template.
  - **Below 768 px, day groups** (`DayGroups`): one `h3` per day that has templates
    (**Ponedeljek** first, days without templates left out), then compact rows by start time:
    the start in the display type, `settings.slotDetails` ("60 min · 5 mest", capacity in its
    plural form: 1 mesto, 2 mesti, 3 mesta, 5 mest), the `neaktiven` or `prekrivanje` tag next
    to the text, and
    **Uredi** (named like the grid's block), which opens the form in place of the row with
    focus in its first field (**Dan**); **Prekliči** or a successful save puts focus back on
    that row's **Uredi** (found by its template id, as the form replaced it).
- **Nov termin** at the right of the section heading opens the same form empty
  ([on demand](#forms-on-demand)): weekday, start time, duration in minutes, capacity and
  an active checkbox. Validation: start time required, duration and capacity positive whole
  numbers (`settings.durationInvalid`, `settings.capacityInvalid`). There is no delete: a
  template that has appointments or rules cannot be deleted, so it is deactivated (customers no
  longer see or book it, materialization skips it). Changing a template's time or weekday does
  not move appointments already booked.
- **Overlapping slots:** saving a template (new or edited) that is active first looks for
  other active templates on the same weekday whose range `[start, start + duration)`
  intersects its own (`overlapsWith` in `lib/schedule.ts`, over the templates already loaded;
  there is no database rule, since two groups at once can be intended). Touching ranges
  (07:00-08:00 and 08:00-09:00) do not overlap, inactive templates are ignored on both sides,
  and an edited template is never compared with itself. An edit warns only about overlaps
  the save would add: a slot that already overlapped another keeps that without asking
  again, so changing the capacity of an intended overlap saves at once. If there are any, the
  form shows `settings.overlapWarning` naming the other slots (`settings.overlapSlot`,
  "ponedeljek ob 07:00 (60 min)", joined with `Intl.ListFormat('sl')`; `single`, `pair` or
  `several` for terminom, terminoma, termini), followed by `settings.confirmAgain`, and saves
  only when **Shrani** is clicked again with the same values; changed values are checked
  again. Together with stranded bookings (below) both warnings show at once, overlap first,
  and one more **Shrani** saves; the "tap Shrani again" sentence then comes once, at the end
  of the stranded warning.
- **Stranded bookings:** saving a deactivation, or a weekday or start-time change, of an
  active template first counts its future `booked` appointments (`futureBookedCount`). If there
  are any, the form shows `settings.strandedWarning` with the count (they stay booked and
  charged and appear under "Termini zunaj urnika" in the trainer calendar) and saves only when
  **Shrani** is clicked again with the same values. The form is busy while the count is read;
  if the read fails, the section shows the error (`genericError` for a network failure) and
  nothing is saved. Capacity, duration and reactivation save at once.
- **Rok za brezplačno odpoved** (tab **Odpoved**): `settings.late_cancel_hours`, a whole number of hours, 0 or
  more (`settings.cutoffInvalid`). It applies to every later cancel and to the customers'
  cancel dialog.
- **Zaprta obdobja** (tab **Zaprta obdobja**): upcoming blocked periods with their range and reason, each with
  **Uredi** and **Izbriši** (deletes at once) on one line at the right; the text wraps.
  **Novo zaprto obdobje** at the right of the section heading opens the same form empty
  ([on demand](#forms-on-demand)): from date and time, to date and time (in the gym
  timezone, via `zonedInstant`) and an optional reason; a time that does not exist that day or an end not after the start is rejected
  (`trainer.invalidTime`, `trainer.invalidRange`). A new block does not cancel appointments
  already booked in it; `book()` and materialization reject or skip later ones. So saving a new
  or edited period first counts the live appointments that overlap it and have not ended yet
  (`liveCountBetween`; sessions already held are not counted); if there are any, the section
  shows `settings.blockedOverlapWarning` with the count (they stay booked and are charged unless
  the trainer cancels them in the calendar) and saves only when **Shrani** is clicked again with
  the same range. A changed range is counted again; a failed count shows the error and saves
  nothing; **Prekliči** on an edit clears the warning, so the next save counts again.
- **Obvestila** (tab **Obvestila**): the notifications toggle with the trainer hint
  (`pushToggle.trainerHint`).

## Show more

The four history lists (customer History: **Termini**, **Krediti**; customer detail:
**Opravljeni termini**, **Zgodovina kreditov**) show 10 rows at a time through `PagedList`
(`pages/shared/PagedList.tsx`, reads in [data-layer.md](data-layer.md#paged-reads)). Upcoming
lists (customer Home, **Prihajajoči termini**) are short and show everything.

- **Pokaži več** (`common.showMore`, a secondary button) sits under the list while the last
  page read said there are more rows; it is gone once the list is complete. A list of 10 or
  fewer never shows it, and an empty list keeps its empty line.
- **Loading:** pressing it sets the label to `common.loading` and `aria-disabled="true"` (the
  disabled look) and ignores further presses until the page arrives. It is not `disabled`, so
  focus stays on it.
- **Loaded:** the next rows are added under the ones already shown (earlier rows stay, in the
  same order; a row that is already shown is not added twice) and focus moves to the first new
  row (rows take focus only from script, `tabindex="-1"`), so a keyboard or screen-reader user
  carries on reading there, also when the button disappears.
- **Failed:** an error line `common.loadFailed` (`role="alert"`) appears above the button,
  the rows shown stay, and the button is usable again for a retry; a successful retry removes
  the line.
- A reload of the screen (after an action) replaces the list with its first page.

## Forms on demand

A form that creates something, or edits details that rarely change, is not on the screen
until it is asked for (`pages/shared/OnDemand.tsx`,
[ADR 0011](adr/0011-responsive-navigation-and-on-demand-forms.md)). Where it is used: **Nov termin**
(Urnik), **Novo zaprto obdobje** (Zaprta obdobja), **Nova stranka** (Stranke, at the page
title), **Nov termin po dogovoru** (Koledar, at the page title), **Dodaj stalni termin** and
**Uredi podatke** (customer detail; the latter a secondary button without `+`), and **Dodaj
stranko** on each
occurrence of the trainer calendar (a small secondary button at the right of the occurrence).

- **Closed:** one button named after the action, at the right of the heading the form belongs
  to; on a narrow screen it wraps below the heading. Its weight follows the heading: a
  page-level action in the page head is the one primary (black) button (**Nova stranka**,
  **Nov termin po dogovoru**; on customer detail the always-open **Dodaj kredite** plays that
  part), a section-level one is secondary, outlined (**Nov termin**, **Novo zaprto obdobje**,
  **Dodaj stalni termin**, **Uredi podatke**, the calendar's small **Dodaj stranko**). "New"
  actions carry a `+`, **Uredi podatke** does not. So a screen never has two black buttons
  competing for the main action.
- **Open:** pressing it replaces the button with the form, as a card under the heading,
  above the list; focus moves to the form's first field. The form has **Prekliči** next to
  its submit button (`settings.cancelEdit` in Nastavitve, `common.cancel` elsewhere).
- **Prekliči** closes it, drops what was typed (the next open starts empty) and returns focus
  to the button. It is disabled, like the submit button, while a save or the count before one
  (stranded or overlapping bookings) runs, so a late answer never lands on a closed or
  reopened form.
- **A successful save** closes it, returns focus to the button and shows the screen's usual
  result notice (`settings.saved`, `trainer.added`, …); **Nova stranka** opens the new
  customer's page instead. A rejected save or a warning that asks for a second
  **Shrani** keeps it open.
- When the close turns the button into a disabled one (the calendar's add control after a
  rejected booking whose reload shows **Polno**, **Zaprto** or **Ni strank za dodajanje**),
  focus goes to the occurrence row instead (each row can take focus, `tabindex="-1"`, and is
  named by its day and time), so it never falls back to the top of the page.
- Closing one form because another opened (the trainer calendar's add control, one open at a
  time) leaves focus in the form that opened.

## Main navigation

`AppShell` renders one `nav` (named `nav.customerLabel` or `nav.trainerLabel`) inside the top
bar, between the wordmark and the account menu; CSS alone places it, so tests and screen
readers find one navigation at every width
([ADR 0011](adr/0011-responsive-navigation-and-on-demand-forms.md)).

- **From 768 px:** the links sit in the top bar on one line after the wordmark, left aligned;
  the account menu stays at the right end. The bar spans the window with a 1 px `--line` edge
  below it, and its wordmark lines up with the page text (the same 46 rem column). Links are
  16 px, weight 600, `--muted`; the open screen's link is `--ink` with a 2 px `--ink` underline
  that sits on the bar's edge. There is no bottom bar and no bottom padding for one.
- **Below 768 px:** the same links are a fixed bar at the bottom (14 px, weight 600, equal
  widths), above the bottom safe-area inset, with a 1 px `--line` edge on top; the open
  screen's tab is `--ink` with a 2 px `--ink` bar on top. The page keeps bottom padding so the
  bar never covers the last item.
- The open screen's link has `aria-current="page"` (React Router's `NavLink`); a link stays
  current on the routes below it (**Nastavitve** on every settings tab, **Stranke** on a
  customer), except **Danes** and **Domov**, which match their own path only.

## Account menu

`pages/shared/AccountMenu.tsx`, at the right end of the top bar in both shells: a square button
named `account.menu` (**Račun**, a person icon) that opens a small panel below it with:

- **Videz** (`account.appearance`): a radio group **Sistem** / **Svetlo** / **Temno**
  (`account.theme`). Choosing one applies it at once and remembers it on this device
  ([app-structure.md](app-structure.md#theme)); **Sistem** follows the device setting. The
  panel stays open, so the change is seen in place.
- **Odjava** (`common.signOut`): a link to `/logout`, as the bare link in the top bar was
  before.

Keyboard and pointer: Enter or Space on the button opens the panel and puts focus on the chosen
theme (arrow keys move within the group, Tab goes on to **Odjava**). Escape closes it and returns
focus to the button; pressing the button again, a click or tap outside it, or Tab out of it also
closes it (focus then stays where the user put it). The button has `aria-expanded` and
`aria-controls`; the panel is a plain disclosure, not an ARIA menu, so the radios and the link
keep their native roles.

## Install card

`pages/shared/InstallCard.tsx`, rendered by `AppShell` above every customer and trainer screen
(an `aside`, a complementary landmark named `install.title`), so it is also the first thing a
new customer sees after accepting an invite. It says why to install (`install.why`) and, on iOS,
where push works only in the home-screen app, what that means for the role:
`install.iosWhyCustomer` (no reminder before a charge without it) or `install.iosWhyTrainer`
(booking and cancel notifications). Then, by mode:

| Mode | When | Shows |
|---|---|---|
| hidden | the app runs standalone (opened from the home screen), or it was installed on this device (`appinstalled` or an accepted prompt, remembered in `amrap.install.installed`, so a browser tab opened later does not offer it again) | nothing |
| prompt | the browser fired `beforeinstallprompt` (Chromium: Android Chrome, desktop Chrome and Edge) | **Namesti aplikacijo**, which opens the browser's install dialog |
| ios | iOS, not standalone | the Share steps (`install.iosShare`, `install.iosAdd`, `install.openFromHome`) and `install.iosOtherBrowsers` |
| android-manual | Android without a prompt (another browser, or the prompt was declined) | the browser menu steps (`install.androidMenu`, `install.androidAdd`, `install.openFromHome`) |
| none | any other browser without a prompt (desktop Safari, Firefox) | nothing |

- **Ne zdaj** hides the card on this device for good (`localStorage` key
  `amrap.install.dismissed`). Storage that cannot be read counts as not dismissed and a failed
  write is logged (`console.warn`); either way the card hides until the next load. The same
  applies to the installed flag. An app removed from the home screen later stays "installed"
  for the card on that device until its site data is cleared.
- The browser's prompt can be shown once. While its dialog is open the card stays as it is (a
  second tap does nothing). Accepted, the card hides; declined, the prompt is dropped and the
  card falls back to the Android menu steps (Android) or disappears (desktop)
  until the browser offers a new prompt.
- On iOS the [notifications toggle](#notifications-toggle) refers to the card while it is shown
  instead of repeating the steps.
- Code layout (the prompt listener, the store, the mode) is in
  [app-structure.md](app-structure.md#install-onboarding).

## Notifications toggle

`pages/shared/PushToggle.tsx`, a card titled `pushToggle.title` on the customer Home and the
trainer Settings. It applies to this browser or installed app only. How push works end to end
is in [notifications.md](notifications.md).

| State | When | Shows |
|---|---|---|
| install hint | iOS and not opened from the home screen | `pushToggle.needsInstallSeeCard` (the steps are in the install card above) while the [install card](#install-card) is shown, else `pushToggle.needsInstall` (Share, Add to Home Screen, open from there) |
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

- **Phone layout and accessibility** (Stage 4 Task 17; every new screen follows these):
  - no horizontal scroll at 360 px wide; the fixed bottom navigation (below 768 px) never
    covers the last item;
  - every tap target (buttons, links outside running text, inputs, selects, checkbox labels)
    is at least 44 × 44 px (`--tap` in `styles.css`);
  - everything focusable shows a 3 px `--ink` ring on `:focus-visible` (not the dialog box
    itself, which only receives focus so screen readers start there);
  - text contrast at least 4.5:1, control borders at least 3:1, in both themes (see
    [Colour and themes](#colour-and-themes)); greyed rows use the muted colour, never opacity;
  - inputs are 16 px, so iOS does not zoom on focus; a number that may be negative uses
    `type="number"` without `inputMode="numeric"` (the iOS numeric pad has no minus key);
    fields the trainer fills in about someone else (customer name, phone, email, credit note,
    blocked-period reason) have `autoComplete="off"`, best effort: some browsers and password
    managers ignore it;
  - in a row, text wraps anywhere but buttons and amounts never wrap or shrink; a row's
    buttons stay on one line together, and a tag sits next to the text it describes;
  - links are `--ink` and underlined (never the browser's default blue); navigation links
    are marked by position and the current-page bar instead;
  - a disabled button is neutral, whatever its kind: surface background, muted text, no
    outline and no opacity; on a card it keeps a 1 px `--line` outline so it still reads as a
    button. An enabled secondary button has a 1 px `--control-line` outline, so an enabled
    and a disabled one are told apart (for example the week arrows);
  - safe-area insets on the top bar, the page sides, the bottom navigation and the dialog;
    the top bar's sides take the larger of the inset and the page column's edge;
  - errors are `role="alert"`, results `role="status"`.

- **Wide views.** Pages keep the 46 rem column (`--content`) at every width, and the top bar
  lines up with it. A week view that needs more room (the Urnik week grid, Stage 9) carries
  the class `wide`: from 1024 px it starts at the column's left edge, in line with the title,
  and grows to the right only, to `--content-wide` (80 rem) or up to one page gutter from the
  window's right edge, whichever is smaller; the title, tabs and section heading above it stay
  on the column ([ADR 0014](adr/0014-wide-week-views.md)). At any width, when its content
  needs more room than that, it scrolls sideways inside its own box (`.wide` carries the
  `overflow-x`), so the page itself never does. `wide` assumes its parent is the content
  column.

- **Brand mark.** The framed AMRAP wordmark (`public/brand-mark.png`, alt `app.name`) replaces
  the plain "AMRAP" text: at the left of the top bar in both shells, and as the `h1` above the
  heading on `/login` and `/invite/:token`. It is black on white in the light theme and white on
  black in the dark theme.

- **Type.** One family, Archivo ([app-structure.md](app-structure.md#font)), tabular figures
  everywhere so times and amounts line up. Scale (tokens `--text-xs` to `--text-2xl`): 0.8125
  rem tags, 0.875 secondary text, small buttons and the bottom navigation, 1 body, `h3` and the
  top-bar navigation,
  1.25 `h2` (weight 700) and slot times, 1.75 `h1` (2 from 768 px), 3.5 the balance. The
  display treatment, width 75 and weight 800 in `--ink`, echoes the wordmark and is kept for
  page titles (`h1`), the balance and slot times; everything else is width 100, weight 400 with
  600 for emphasis (labels, buttons, amounts). Sentence case throughout: no all-caps or
  letter-spaced labels.

- **The frame.** The logo's rectangle, 2 px `--ink` with square corners, is the one strong
  element: it is in the wordmark and around the balance on customer Home and customer detail
  (the balance sits on the page, not in a card). Everything else is quiet: controls, cards,
  tags and the dialog have a 6 px radius (`--radius`), only the dialog has a shadow (in the
  light theme; in the dark theme `--shadow` is transparent and the dialog's `--line` edge shows
  it), and there are no gradients.

- **Colour and themes.** Black, white and grey from the gym logo
  ([ADR 0010](adr/0010-visual-identity-and-themes.md)); red only for debt, late cancels and
  destructive buttons, green only for "opravljeno", added credits and saved notices. Every
  colour is a token on `:root` in `styles.css`; no component sets a colour of its own. The dark
  values apply under `prefers-color-scheme: dark` unless `<html data-theme="light">`, and
  always under `data-theme="dark"`; `color-scheme` follows, so native controls and scroll
  bars match. Contrast of the pairs the app uses (WCAG ratio, light / dark):

  | Pair | Light | Dark | Needs |
  |---|---|---|---|
  | `--text` on `--paper` / `--surface` | 17.0 / 15.4 | 17.9 / 15.5 | 4.5 |
  | `--ink` on `--paper` / `--surface` (headings, primary button text reversed) | 21 / 18.9 | 21 / 18.1 | 4.5 |
  | `--muted` on `--paper` / `--surface` | 6.4 / 5.8 | 8.3 / 7.2 | 4.5 |
  | `--debt` on `--paper` / `--surface` / `--debt-bg` | 6.1 / 5.5 / 5.4 | 8.3 / 7.2 / 6.4 | 4.5 |
  | `--paper` on `--debt` (destructive button) | 6.1 | 8.3 | 4.5 |
  | `--done` on `--paper` / `--surface` / `--done-bg` | 5.4 / 4.8 / 4.7 | 10.3 / 8.8 / 7.6 | 4.5 |
  | `--control-line` on `--paper` / `--surface` (input, select, secondary button and account button edges) | 3.7 / 3.3 | 4.4 / 3.8 | 3 |

  `--line` (row dividers, card and dialog edges, tags, the debtor chips on Danes, whose text
  identifies them) is decorative and needs no ratio.

- **Spacing.** One scale in `styles.css`, `--space-1` to `--space-7` (4, 8, 12, 16, 24, 32,
  48 px). Components carry no outer margins; the context sets the gap:
  - on a page: blocks `--space-6` apart, the back link `--space-2` above the title, the title
    `--space-5` above the first block, the week navigation `--space-5` above the next block, a
    page-level heading `--space-3` above its content;
  - in a section: the heading `--space-3` above its content, blocks `--space-4` apart; a list
    is shown only when it has items (otherwise the empty line); a form opened inside a list
    row (**Uredi**) sits `--space-3` from the rows around it;
  - in a form card: the heading, fields, notices and buttons are all `--space-4` apart (the
    form gap, so also heading to first field);
  - in a card that is not a form: text lines stay together, and a form, a notice or a button
    sits `--space-3` below the text above it.

  A form's submit button (or its row of buttons) is full width below 480 px and its natural
  width from 480 px.

- **Signed numbers.** Balances and ledger amounts are formatted with `Intl.NumberFormat('sl-SI')`,
  which writes the minus as U+2212 (`−3`), never a hyphen: `formatBalance` for a balance (`4`,
  `0`, `−3`) and `formatAmount` for a change (`+8`, `−1`), both in `i18n/fill.ts`. The shared
  `Amount` span colours them: negative `--debt`; a positive change (`+8`, added credits)
  `--done`; a balance of 0 or more stays plain ink, since green is kept for opravljeno, added
  credits and saved notices.

- **Keep-alive.** Once per signed-in user per page load, `AuthProvider` runs
  `select id from settings limit 1` (ADR 0005). A failure is logged with `console.warn` and
  never blocks the app. Token refreshes do not repeat it.
- **Error copy.** `fromError(error)` turns a PostgREST error (`AMRAP_<TOKEN>: detail`) or a
  Supabase Auth error code into Slovenian copy; anything else gets `genericError`.
- **Environment.** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required. Without
  them `start.tsx` shows a start-up error page (`startupError`) naming the missing variable
  instead of a blank page ([runbook.md](runbook.md#cloudflare-pages-build-settings)).
- **PWA.** A custom service worker (`src/sw.ts`, vite-plugin-pwa `injectManifest`) precaches the
  build, serves `index.html` for every navigation (deep links work offline), updates itself
  (`skipWaiting` + `clientsClaim`, the `autoUpdate` behaviour) and shows push notifications
  ([notifications.md](notifications.md#service-worker)). `display: standalone`, manifest
  language `sl`, icons 192 and 512 px (the framed wordmark on black), the font precached so
  the app looks the same offline. The [install card](#install-card) guides installing it.
  Cloudflare Pages falls back to `index.html` for unknown paths natively;
  `app/public/_redirects` is a belt-and-braces measure
  ([runbook.md](runbook.md#cloudflare-pages-build-settings)).
