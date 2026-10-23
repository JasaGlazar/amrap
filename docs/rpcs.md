# RPC reference

Every credit and capacity mutation goes through a Postgres function called over PostgREST
(`supabase.rpc(...)`). The migrations are the exact definition; this page is the contract the
app relies on.

## Conventions

- Every RPC is `language plpgsql security definer set search_path = ''` and runs in the
  caller's transaction, so each call is all-or-nothing.
- **Role check, always explicit.** `public.is_trainer()` decides whether the caller is the
  trainer. A customer may act only on their own record (`public.current_customer_id()`). An
  auth user without a `customers` row is neither, so every RPC except `accept_invite` rejects
  them with `AMRAP_FORBIDDEN`.
- **Errors.** Every rejection is `raise exception` with SQLSTATE `P0001` and a message of the
  form `AMRAP_<CODE>: <English detail>`. The app maps the token before the colon to Slovenian
  copy in `app/src/i18n/sl.ts`; the detail after it is for logs only and may change.
- **Grants.** The initial migration revoked default execute, so each RPC below is granted
  explicitly to `authenticated` and `service_role` (never `anon`), except
  `charge_due_appointments()`, which has no grant to `authenticated` or `anon`.
- Times are `timestamptz`. Weekday and start time of a slot template are interpreted in
  `settings.timezone` (weekday 0 = Monday, see [schema.md](schema.md#slot_templates)).

## Error tokens

| Token | Meaning | Raised by |
|---|---|---|
| `AMRAP_FORBIDDEN` | The caller's role does not allow this call, or a customer acts on someone else's record | all except `charge_due_appointments` |
| `AMRAP_INVALID_ARGUMENT` | A required argument is missing, out of range, or not allowed in this combination | `book`, `top_up`, `adjust` |
| `AMRAP_NOT_FOUND` | The referenced customer or slot template does not exist | `book`, `top_up`, `adjust` |
| `AMRAP_SLOT_INACTIVE` | The slot template is deactivated | `book` |
| `AMRAP_IN_PAST` | A customer tried to book a start that is not in the future | `book` |
| `AMRAP_SLOT_MISMATCH` | The start is not on the template's weekday and start time (in `settings.timezone`) | `book` |
| `AMRAP_BLOCKED` | The start falls inside a blocked period | `book` |
| `AMRAP_CAPACITY_FULL` | The slot occurrence already has `capacity` live appointments | `book` |
| `AMRAP_ALREADY_BOOKED` | The customer already has a live (`booked`/`charged`) appointment at that start | `book` |

## book

```sql
public.book(p_customer_id uuid, p_starts_at timestamptz,
            p_slot_template_id uuid default null, p_ends_at timestamptz default null) returns uuid
```

- **Who may call:** a customer for themselves (`p_customer_id = current_customer_id()`), or the
  trainer for any customer.
- **Rules, in the order they are checked:**
  1. A customer may book only themselves (`AMRAP_FORBIDDEN`).
  2. Arguments (`AMRAP_INVALID_ARGUMENT`): `p_customer_id` and `p_starts_at` are required. A
     customer must pass `p_slot_template_id`. `p_ends_at` is allowed only without a template
     (ad hoc, trainer only), and then it is required and must be after `p_starts_at`. With a
     template the duration always comes from the template.
  3. The customer must exist (`AMRAP_NOT_FOUND`).
  4. With a template: it must exist (`AMRAP_NOT_FOUND`) and be active (`AMRAP_SLOT_INACTIVE`);
     for a customer `p_starts_at` must be in the future (`AMRAP_IN_PAST`; the trainer may book
     past occurrences); `p_starts_at` in `settings.timezone` must fall on the template's
     `weekday` (`isodow - 1`) at its `start_time` (`AMRAP_SLOT_MISMATCH`).
  5. `p_starts_at` must not fall inside a blocked period, `starts_at <= p_starts_at < ends_at`
     (`AMRAP_BLOCKED`). Applies to the trainer and to ad-hoc bookings too.
  6. With a template: takes `pg_advisory_xact_lock(hashtext(template_id || '@' ||
     epoch(p_starts_at)))`, so concurrent bookings of one occurrence are serialized, then counts
     appointments of that template at that start with status `booked` or `charged`. If the
     count is `>= capacity` the booking fails (`AMRAP_CAPACITY_FULL`), for the trainer too.
     Ad-hoc bookings have no capacity. (The lock key uses the epoch rather than
     `p_starts_at::text` so it does not depend on the session's `TimeZone`.)
  7. Insert; a second live booking of the same customer at the same start hits
     `appointments_one_live_booking_idx` and is reported as `AMRAP_ALREADY_BOOKED`.
- **Side effects:** inserts one `appointments` row: `status = 'booked'`,
  `source = 'trainer'` when the trainer calls, else `'self_booked'`;
  `ends_at = p_starts_at + duration_minutes` with a template, else `p_ends_at`. No credit
  transaction (the charge happens at session start, see [jobs.md](jobs.md)). Returns the
  appointment id.
- **Diagram:** [architecture/booking-sequence.md](architecture/booking-sequence.md).

## top_up

```sql
public.top_up(p_customer_id uuid, p_amount int, p_note text default null) returns uuid
```

- **Who may call:** the trainer only.
- **Rules:** `p_amount > 0`; the customer must exist.
- **Errors:** `AMRAP_FORBIDDEN` (not the trainer), `AMRAP_INVALID_ARGUMENT` (amount null or
  `<= 0`), `AMRAP_NOT_FOUND` (no such customer).
- **Side effects:** inserts one `credit_transactions` row: `type = 'topup'`,
  `amount = p_amount`, `created_by = auth.uid()`, `note = p_note`. Returns its id.

## adjust

```sql
public.adjust(p_customer_id uuid, p_amount int, p_note text default null) returns uuid
```

- **Who may call:** the trainer only.
- **Rules:** `p_amount <> 0` (either sign); the customer must exist. This is also how the
  trainer waives a late-cancel charge: `adjust(customer, 1, note)`.
- **Errors:** `AMRAP_FORBIDDEN` (not the trainer), `AMRAP_INVALID_ARGUMENT` (amount null or
  0), `AMRAP_NOT_FOUND` (no such customer).
- **Side effects:** inserts one `credit_transactions` row: `type = 'adjustment'`,
  `amount = p_amount`, `created_by = auth.uid()`, `note = p_note`. Returns its id.

## Helpers

Role helpers used by RLS policies and by every RPC's role check. Both are `language sql
stable security definer set search_path = ''`, executable by `authenticated` and
`service_role` only (revoked from `public` and `anon`). Defined in
`20261023173423_initial_schema.sql`; see [schema.md](schema.md#helpers).

- `public.current_customer_id() returns uuid` — the `customers.id` linked to `auth.uid()`, or
  null when the caller has no customer record.
- `public.is_trainer() returns boolean` — true when the caller's customer record has
  `role = 'trainer'`.
