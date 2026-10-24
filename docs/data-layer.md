# Data layer

Typed reads and RPC wrappers over the Supabase client, in `app/src/data/`. Pages call these
functions and never build queries themselves. RLS and the RPCs ([schema.md](schema.md),
[rpcs.md](rpcs.md)) are the security; this layer only shapes data for the screens.

## Contract

- Every function takes the client as its first argument (`Client` =
  `SupabaseClient<Database>`, `data/client.ts`). Pages pass `supabase` from `lib/supabase.ts`;
  tests pass the fake ([app-structure.md](app-structure.md#testing-with-the-fake-client)).
- **Reads** return plain objects with `Date`s for timestamps and camelCase fields (slot templates
  keep their column names, since `lib/time.ts` reads them directly). A failed query throws the
  PostgREST error; the page shows its load-failed state.
- **Actions** (RPCs and writes) never throw. They return `ActionResult<T>`: `{ ok: true, data }`
  (the RPC's or insert's result, which may be null), or `{ ok: false, message }` with the
  Slovenian copy from `fromError` (a thrown network error or an unknown database error becomes
  the generic message).
- Queries for "my" rows filter by the caller's customer id, because the trainer can read
  every customer's rows.
- Timestamps are sent as `toISOString()` and compared as instants ([time.md](time.md#model)).

## Reads

| Function | Source | Filter and order |
|---|---|---|
| `getSettings(client)` | `settings` | `id = 1`; returns `{ lateCancelHours, timeZone }`; throws when the row is missing |
| `activeTemplates(client)` | `slot_templates` | `active = true`, by `weekday`, `start_time` |
| `occupancyBetween(client, from, to)` | `slot_occupancy` | `from <= starts_at < to`. An occurrence nobody booked has no row: its count is 0. |
| `blockedBetween(client, from, to)` | `blocked_periods` | overlaps `[from, to)`: `starts_at < to` and `ends_at > from` |
| `upcomingAppointments(client, customerId, now)` | `appointments` | mine, `status = 'booked'`, `starts_at > now`, soonest first |
| `pastAppointments(client, customerId, now, from?)` | `appointments` | mine and not upcoming: `status <> 'booked'` or `starts_at <= now` (so a cancelled future appointment is history too), newest first; [paged](#paged-reads) |
| `liveAppointmentsBetween(client, from, to, customerId?)` | `appointments` | `status in ('booked', 'charged')`, `from <= starts_at < to`, by start; only that customer's when `customerId` is given (the trainer omits it) |
| `balanceOf(client, customerId)` | `customer_balances` | my row; 0 when there is none |
| `ledgerOf(client, customerId, from?)` | `credit_transactions` | mine, newest `created_at` first; [paged](#paged-reads) |
| `allBalances(client)` | `customer_balances` | every row the caller may see (the trainer: all), as a map from customer id to balance |
| `listCustomers(client)` | `customers` | `role = 'customer'` (not the trainer's own row), by name |
| `getCustomer(client, id)` | `customers` | one customer record; throws when missing |
| `rulesOf(client, customerId)` | `recurring_rules` | that customer's rules, oldest first |
| `allTemplates(client)` | `slot_templates` | active and inactive, by `weekday`, `start_time` |
| `upcomingBlocked(client, now)` | `blocked_periods` | `ends_at > now`, by start |
| `chargedSince(client, customerId, since, from?)` | `appointments` | that customer's `charged` appointments with `starts_at >= since`, newest first; [paged](#paged-reads) |
| `futureBookedCount(client, templateId, now)` | `appointments` | the number of `booked` appointments of that template with `starts_at > now` |
| `liveCountBetween(client, from, to, now)` | `appointments` | the number of live (`booked` or `charged`) appointments overlapping `[from, to)` that have not ended: `starts_at < to` and `ends_at` after both `from` and `now` |
| `hasPushSubscription(client, endpoint, userId)` | `push_subscriptions` | whether a row with that endpoint belongs to `userId` (the signed-in auth user); filtered by `user_id` because the trainer's RLS policy returns every user's rows |

`inviteStatus(customer, now)` derives a customer's invite status: `linked` (an auth user is
linked), `pending` (an invite token that has not expired) or `none`.

Appointments carry `customerId`, `slotTemplateId` (null for ad hoc), `startsAt`, `endsAt` and
`status`.

## Paged reads

The history lists grow without limit, so `pastAppointments`, `chargedSince` and `ledgerOf`
read one page at a time (`data/page.ts`). Each returns a `Page<T>`, `{ rows, more }`, of at
most `PAGE_SIZE` (10) rows starting at row `from` (default 0, the newest). The query asks
PostgREST for one row more than a page, `.range(from, from + PAGE_SIZE)` (both ends inclusive),
and `more` is whether that extra row came back; the extra row is dropped. There is no count
query. After the newest-first order (`starts_at` or `created_at`) the rows are ordered by `id`,
so rows with the same time (one charge run, for example) keep one order across pages. The next
page starts at `from` plus the rows read so far. Filters that depend on the time (`now` for
`pastAppointments`, `since` for `chargedSince`) take the value of the first page, so every
page of a list reads the same set.

Pages show them through `PagedList` (`pages/shared/PagedList.tsx`), see
[screens.md](screens.md#show-more).

## Week

`loadWeek(client, { now, weekOffset, start?, customerId? })` (`data/week.ts`) loads one
calendar week for both calendars: the settings, the week's Monday (`start` when given, as the
trainer calendar does from its `?dan` day; otherwise `weekOffset` weeks from the current week,
in `settings.timezone`), the active templates' occurrences that week ([time.md](time.md)), and
the live appointments in the week (only the customer's when `customerId` is given). Each
`WeekSlot` has its start and end, duration, capacity, `booked` (from `slot_occupancy`, 0
without a row), `free = max(0, capacity − booked)`, `past` (`startsAt <= now`) and `blocked`
(overlaps a blocked period). Blocked periods are read up to the week's end plus the longest
template duration, so an occurrence late on Sunday that runs into the next week is checked
too. `appointmentsIn(week, slot)` returns the week's appointments of that occurrence (same
template and start). `appointmentsOutsideSlots(week)` returns the week's appointments that
match no occurrence: ad-hoc ones and those of a template that was deactivated or moved to
another weekday or time.

`upcomingAppointments` and `pastAppointments` split my appointments into two disjoint sets: an
appointment that has started but is not charged yet (the charge job runs every 15 minutes) is
already history.

## Actions

| Function | RPC | Arguments |
|---|---|---|
| `book(client, { customerId, startsAt, slotTemplateId })` | `book` | `p_customer_id`, `p_starts_at` (`startsAt.toISOString()`), `p_slot_template_id` |
| `book(client, { customerId, startsAt, endsAt })` | `book` | ad hoc (trainer): `p_customer_id`, `p_starts_at`, `p_ends_at`, no template |
| `cancel(client, appointmentId)` | `cancel` | `p_appointment_id` |
| `topUp(client, customerId, amount, note)` | `top_up` | `p_customer_id`, `p_amount`, `p_note` (omitted when null) |
| `adjust(client, customerId, amount, note)` | `adjust` | same as `topUp` |
| `createInvite(client, customerId)` | `create_invite` | `p_customer_id`; `data` is the token |
| `activateRule(client, ruleId)` / `deactivateRule(client, ruleId)` | `activate_rule` / `deactivate_rule` | `p_rule_id`; `data` is the number inserted / cancelled |
| `savePushSubscription(client, { endpoint, p256dh, auth })` | `save_push_subscription` | `p_endpoint`, `p_p256dh`, `p_auth` |

Table writes go through RLS (the trainer's `for all` policies):

| Function | Write |
|---|---|
| `createCustomer(client, { name, phone, email })` | insert into `customers` (role defaults to `customer`); `data.id` is the new id |
| `updateCustomer(client, id, { name, phone, email })` | update that row |
| `addRule(client, customerId, templateId)` | insert into `recurring_rules` (active by default), then `activate_rule` on the new id, which materializes it right away; `data` is the number of appointments created |
| `saveTemplate(client, id \| null, fields)` | insert (`id` null) or update a `slot_templates` row (weekday, start time, duration, capacity, active). There is no delete: a template with appointments or rules cannot be deleted, so it is deactivated ([schema.md](schema.md)). |
| `saveBlocked(client, id \| null, { startsAt, endsAt, reason })` | insert or update a `blocked_periods` row |
| `deleteBlocked(client, id)` | delete a `blocked_periods` row |
| `setLateCancelHours(client, hours)` | update `settings.late_cancel_hours` |
| `deletePushSubscription(client, endpoint, userId)` | delete the `push_subscriptions` row with that endpoint and `user_id = userId`, so the trainer never deletes another user's row |

After an action the page reloads what it shows; nothing is updated optimistically.

## Loading in pages

A screen wraps its reads in one `useCallback` load function and passes it to `useLoad`
(`lib/useLoad.ts`), which returns `loading`, `error` (logged with `console.warn`) or `ok` with
the data, plus `reload()`, which returns a promise that settles once the reload has finished
(the calendar keeps its book buttons disabled until then). A reload keeps showing the current data until the new data
arrives; a new load function (for example another week in the calendar) shows `loading`
first. Only the newest run's result is applied. `useCustomer()` (`auth/AuthContext.ts`) gives
the signed-in customer's row below `RequireAuth`, so pages do not handle a missing row.
