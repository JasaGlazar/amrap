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
- **Actions** (`book`, `cancel`) never throw. They return `ActionResult`: `{ ok: true }`, or
  `{ ok: false, message }` with the Slovenian copy from `fromError` (a thrown network error
  becomes the generic message).
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
| `pastAppointments(client, customerId, now)` | `appointments` | mine and not upcoming: `status <> 'booked'` or `starts_at <= now` (so a cancelled future appointment is history too), newest first |
| `liveAppointmentsBetween(client, customerId, from, to)` | `appointments` | mine, `status in ('booked', 'charged')`, `from <= starts_at < to` |
| `balanceOf(client, customerId)` | `customer_balances` | my row; 0 when there is none |
| `ledgerOf(client, customerId)` | `credit_transactions` | mine, newest `created_at` first |

`upcomingAppointments` and `pastAppointments` split my appointments into two disjoint sets: an
appointment that has started but is not charged yet (the charge job runs every 15 minutes) is
already history.

## Actions

| Function | RPC | Arguments |
|---|---|---|
| `book(client, { customerId, startsAt, slotTemplateId })` | `book` | `p_customer_id`, `p_starts_at` (`startsAt.toISOString()`), `p_slot_template_id` |
| `cancel(client, appointmentId)` | `cancel` | `p_appointment_id` |

After an action the page reloads what it shows; nothing is updated optimistically.

## Loading in pages

A screen wraps its reads in one `useCallback` load function and passes it to `useLoad`
(`lib/useLoad.ts`), which returns `loading`, `error` (logged with `console.warn`) or `ok` with
the data, plus `reload()`. A reload keeps showing the current data until the new data
arrives; a new load function (for example another week in the calendar) shows `loading`
first. Only the newest run's result is applied. `useCustomer()` (`auth/AuthContext.ts`) gives
the signed-in customer's row below `RequireAuth`, so pages do not handle a missing row.
