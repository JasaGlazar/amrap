# App structure

The customer and trainer app in `app/`: a Vite + React single-page PWA, deployed to
Cloudflare Pages ([runbook.md](runbook.md#cloudflare-pages-build-settings)). Routes and
screens are in [screens.md](screens.md), sign-in and role gating in [auth.md](auth.md).

## Folders

| Path | Holds |
|---|---|
| `src/main.tsx`, `src/start.tsx` | Entry point. `start()` mounts the router or the start-up error page ([auth.md](auth.md#start-up-error)). |
| `src/routes.tsx` | The route tree (React Router v7 data router). The tests render the same tree. |
| `src/data/` | Typed reads and RPC wrappers ([data-layer.md](data-layer.md)). |
| `src/auth/` | `AuthProvider`, `useAuth()`, the route guards ([auth.md](auth.md)). |
| `src/pages/` | One component per screen or state page. The shells (`CustomerPages.tsx`, `TrainerPages.tsx`) use `AppShell`: a top bar with the app name and a sign-out link, the page, and a fixed bottom navigation bar. Customer screens are in `pages/customer/`, trainer screens in `pages/trainer/`; the pieces both calendars use (`WeekNav`, `WeekSlots`, `CancelDialog`) are in `pages/shared/` ([screens.md](screens.md#customer-screens)). |
| `src/i18n/` | `sl.ts` (all copy), `errors.ts` (`fromError`), `fill.ts` (`fill` for `{name}` placeholders, `formatTimeUntil`), `index.ts` (exports `t` and the helpers). |
| `src/lib/` | `supabase.ts` (the one client), `database.types.ts` (generated), `keepAlive.ts`, `time.ts` ([time.md](time.md)), `useLoad.ts`. |
| `src/test/` | `fakeSupabase.ts` and the Vitest setup (`setup.ts`: jest-dom matchers, cleanup after each test). |
| `src/styles.css` | Plain CSS for the whole app. |
| `public/` | Icons and `_redirects` (SPA fallback). `scripts/generate-icons.mjs` (`npm run icons`) regenerates the icons. |

`start.tsx` takes `RouterProvider` from `react-router`, not `react-router/dom`, so the app and
the tests render the same component (the `/dom` variant only adds `flushSync` for transitions).

## i18n rule

Every user-visible string lives in `src/i18n/sl.ts` (Slovenian), grouped by screen; components
import `t` from `../i18n` and never hardcode copy. Identifiers, logs and RPC error details stay
English. `fromError(error)` turns an error into copy:

1. an `AMRAP_<TOKEN>` at the start of `error.message` (PostgREST puts the RPC's
   `AMRAP_<TOKEN>: detail` there) → `sl.errors[token]`;
2. else a Supabase Auth `error.code` → `sl.authErrors[code]`;
3. else `sl.genericError`.

`sl.test.ts` checks that every token in the [rpcs.md](rpcs.md#error-tokens) error table has
an entry in `sl.errors`, that every `sl.errors` key appears in backticks somewhere in
`rpcs.md`, that no string is empty, and that no `.ts`, `.tsx` or `.css` file in `src/` outside
`src/i18n/` (tests and `lib/database.types.ts` excepted) contains `č`, `š` or `ž` (a proxy for
hardcoded Slovenian).

## Data layer contract

- One client, `supabase` from `src/lib/supabase.ts`, typed with `Database` from the generated
  `database.types.ts` (regenerate with `supabase gen types typescript --local`).
- Pages read and write through `src/data/`: functions that take the client as their first
  argument, so tests pass the fake. Reads go to tables and views (RLS decides the rows); writes
  that touch credits or capacity go only through RPCs. Details: [data-layer.md](data-layer.md).
- Auth calls (`supabase.auth.*`) and `accept_invite` stay in the auth and invite code
  ([auth.md](auth.md)).

## Testing with the fake client

Vitest with jsdom (`npm test`). A test file replaces the client module:

```ts
vi.mock('./lib/supabase', async () => ({
  supabase: (await import('./test/fakeSupabase')).fakeSupabase,
}));
```

`fakeSupabase.ts` is an in-memory stand-in that answers only what the app asks for:

- `db` holds the state: the session, the signed-in user's customer row and balance
  (`db.customer`, `db.balance`), the `settings` row, injected errors, and `db.tables` with rows
  for `customers` and `customer_balances` (added to the signed-in row, for the trainer's
  lists), `recurring_rules`, `slot_templates`, `slot_occupancy`, `appointments`,
  `credit_transactions` and `blocked_periods`. The query fake supports `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `or`
  (comma-separated `column.operator.value`), `order` and `limit`, and applies them the way
  PostgREST would (timestamps compared as instants), so a test fails when the app selects the
  wrong rows; an unexpected table throws. `insert` (with `.select().single()`), `update` and
  `delete` with filters change `db.tables` (inserts get an id and the column defaults the app
  relies on).
- `fakeSupabase.rpc` simulates `book` (inserts a booked appointment and counts it in
  `slot_occupancy` when it has a template), `cancel` (marks it `cancelled`, or
  `cancelled_by_trainer` with a `refund` row when the trainer cancels a charged one, and
  uncounts it), `top_up` and `adjust` (add a ledger row), `create_invite` (sets and returns a
  token) and `activate_rule` / `deactivate_rule` (flip `active`; deactivating cancels the rule's
  future booked appointments). Any other RPC throws unless a test mocks it. Tests mock a rejection with `mockResolvedValueOnce({ data: null,
  error: { message: 'AMRAP_…: detail' } })`.
- `resetFake({ session?, customer? })` in `beforeEach` clears the state (tables empty,
  default settings) and the mocks and optionally starts signed in. `onAuthStateChange` delivers `INITIAL_SESSION` on a microtask,
  like the real client.
- `emitAuth(event, session)` simulates Supabase Auth announcing a change (sign-in, token
  refresh, sign-out).
- `makeSession`, `makeCustomer`, `authError` build fixtures; the `auth.signUp` /
  `signInWithPassword` mocks and any other RPC are set per test.
- `src/data/data.test.ts` and `trainer.test.ts` call the data layer with the fake directly
  (`fakeSupabase as unknown as Client`).

`routes.test.tsx` renders the real route tree in a `createMemoryRouter` and asserts on what the
user sees. Build-only plugins (the PWA service worker) are left out when `VITEST` is set.
