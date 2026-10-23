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
| `AMRAP_INVALID_ARGUMENT` | A required argument is missing or out of range | `top_up`, `adjust` |
| `AMRAP_NOT_FOUND` | The referenced customer does not exist | `top_up`, `adjust` |

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
