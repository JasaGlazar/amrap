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
| `src/pages/` | One component per screen or state page. The shells (`CustomerPages.tsx`, `TrainerPages.tsx`) use `AppShell`: a top bar with the framed wordmark, the main navigation and the account menu (theme and sign-out), then the install card and the page. The navigation is one `nav` that CSS places: in the top bar from 768 px, a fixed bar at the bottom below that ([screens.md](screens.md#main-navigation)). The settings screen is a small layout of its own (`trainer/Settings.tsx`: title, tab row, `Outlet`) over one component per tab (`SettingsTemplates`, `SettingsCutoff`, `SettingsBlocked`, `SettingsNotifications`), each a child route ([ADR 0011](adr/0011-responsive-navigation-and-on-demand-forms.md)). Customer screens are in `pages/customer/`, trainer screens in `pages/trainer/`; the pieces several screens use (`WeekNav`, `WeekSlots`, `CancelDialog`, `LedgerList`, `Amount`, `NoticeLine`, `PushToggle`, `InstallCard`, `AccountMenu`, `BrandMark`, `OnDemand`, and `modal.ts` with `useModal`, the dialogs' focus, Escape and scroll lock) are in `pages/shared/` ([screens.md](screens.md#customer-screens)). |
| `src/i18n/` | `sl.ts` (all copy), `errors.ts` (`fromError`), `fill.ts` (`fill` for `{name}` placeholders, `formatTimeUntil`, `plural`, the signed numbers `formatAmount` and `formatBalance`), `index.ts` (exports `t` and the helpers). |
| `src/install/` | Install onboarding: the `beforeinstallprompt` capture and store, the install mode, the per-device dismissal ([Install onboarding](#install-onboarding)). |
| `src/theme/` | The per-device theme preference and applying it to the page ([Theme](#theme)). |
| `src/push/` | Web push in the browser: `render.ts` (notification copy, used by the service worker), `support.ts`, `browser.ts`, `subscribe.ts` ([notifications.md](notifications.md#subscribing-in-the-app)). |
| `src/sw.ts` | The service worker: precache, outdated-cache cleanup, `index.html` for navigations, self-update, push and notification click ([notifications.md](notifications.md#service-worker)). Type-checked by `tsconfig.sw.json` with the `WebWorker` lib and left out of `tsconfig.app.json` and `tsconfig.test.json`. |
| `src/lib/` | `supabase.ts` (the one client; retries a `PGRST303` answer once, [auth.md](auth.md#token-refused-as-issued-in-the-future)), `database.types.ts` (generated), `keepAlive.ts`, `time.ts` ([time.md](time.md)), `customerSearch.ts` (Stranke search and filters, [screens.md](screens.md#customers-tstranke)), `schedule.ts` (template minutes, the week grid's axis and lanes, the overlap check, [time.md](time.md#formatting)), `useMediaQuery.ts` (`useMediaQuery(query)` over `matchMedia`, false where it is missing as in jsdom; `wideScreen` is the 768 px query, `weekGrid` the 1024 px one that switches the trainer Koledar from its day view to its week grid; tests stub `window.matchMedia` to choose a view), `useLoad.ts`, `device.ts` (`deviceEnvironment()`: iOS, Android, standalone; used by push support and the install card). |
| `src/test/` | `fakeSupabase.ts`, `fakePush.ts` (a fake `PushPlatform`), `fakeInstall.ts` (a fake `InstallPlatform`, a prompt event, in-memory storage) and the Vitest setup (`setup.ts`: jest-dom matchers; after each test it unmounts, clears `localStorage` and removes `data-theme` from `<html>`). |
| `src/styles.css` | Plain CSS for the whole app: the two `@font-face` rules ([Font](#font)), the colour tokens and both themes, then the components. |
| `public/` | The gym logo, the wordmark and the icons cut from it ([Brand assets](#brand-assets)), and `_redirects` (SPA fallback). |

`start.tsx` takes `RouterProvider` from `react-router`, not `react-router/dom`, so the app and
the tests render the same component (the `/dom` variant only adds `flushSync` for transitions).

## Install onboarding

What the install card shows is in [screens.md](screens.md#install-card). The code in
`src/install/`:

- `capture.ts`: `createInstallStore(storage)` holds the captured prompt event, whether the app
  was installed on this device and whether the card was dismissed (both read from storage at
  start), with `subscribe` / `getState` for `useSyncExternalStore`; `install()` calls `prompt()`
  synchronously inside the tap (Chrome needs the user gesture), keeps the event while the dialog
  is open (a second call meanwhile returns `unavailable`) and drops it once the browser answers,
  since it cannot be reused. `listenForInstallPrompt(target, store)` handles
  `beforeinstallprompt` (`preventDefault()`, keep the event) and `appinstalled`. `main.tsx`
  registers it before `start()`, because Chrome can fire the event before React has rendered
  anything. The event type is declared locally (Chromium only, not in `lib.dom`).
- `mode.ts`: `installMode({ standalone, ios, android, installed, hasPrompt })`, pure.
- `flags.ts`: the per-device flags `amrap.install.dismissed` and `amrap.install.installed`
  (`isFlagSet` / `setFlag`), every access in try/catch.
- `platform.ts`: `installPlatform` (`lib/device.ts` detection and the app's one store over
  `window.localStorage`) and `InstallContext`, whose default is `installPlatform`.
- `useInstall.ts`: `useInstall()` → `{ mode, cardShown, install, dismiss }`, used by
  `InstallCard` and by `PushToggle` (the iOS hint depends on whether the card is shown).

## Theme

Colours, the two themes and their contrast are in
[screens.md](screens.md#behaviour-shared-by-all-screens) and
[ADR 0010](adr/0010-visual-identity-and-themes.md). The preference is per device:

- `src/theme/theme.ts`: `readTheme(storage)` / `saveTheme(storage, theme)` over
  `amrap.theme` in `localStorage` (`system | light | dark`; anything else reads as `system`),
  every access in try/catch like the install flags, so a browser that blocks storage simply
  follows the system. `applyTheme(document, theme)` sets `<html data-theme>` for `light` and
  `dark`, removes it for `system`, and sets both `<meta name="theme-color">` tags to the
  chosen theme's paper (for `system`, each tag gets the paper of its own
  `prefers-color-scheme` media query).
- `index.html` has a small inline script that does the same from storage before the first
  paint, so a stored dark theme never flashes white. `theme.test.ts` runs that script in jsdom,
  so the two copies cannot drift apart.

## Brand assets

Committed images in `public/`, all cut from the gym's logo `logo.png` (447 × 447, white on
black) with macOS `sips`, so no image tool is added to the build
([ADR 0010](adr/0010-visual-identity-and-themes.md)). Run from `app/`:

| File | Command | Used by |
|---|---|---|
| `brand-mark.png` (267 × 78) | `sips -c 78 267 --cropOffset 172 90 public/logo.png --out public/brand-mark.png` | `pages/shared/BrandMark.tsx`: the top bar (1.75 rem high) and the `h1` of `/login` and `/invite/:token` (3 rem), alt text `app.name` |
| `icon-512.png` | `sips -Z 380 public/brand-mark.png --out public/icon-512.png && sips -p 512 512 --padColor 060807 public/icon-512.png` | the manifest (`any` and `maskable`) |
| `icon-192.png` | `sips -Z 142 public/brand-mark.png --out public/icon-192.png && sips -p 192 192 --padColor 060807 public/icon-192.png` | the manifest, the favicon and `apple-touch-icon` |

`sips -c` and `-p` take height then width, and `--cropOffset` y then x. The crop is the frame's
outer edge (its first and last row and column are the frame line's anti-aliased edge), so the
frame lines up with the page text and the frame is exactly the image height on screen (28 px in
the top bar). The frame line is about 3 px in the image, about 1 CSS px in the top bar. The logo's black is `#060807`, not pure black: the icons are
padded with that colour so there is no seam, and `filter: var(--mark-filter)` on the mark adds
`contrast(1.1)`, which takes it to `#000000` on black paper (the light theme also inverts it,
so it is black on white). In the icons the wordmark is 378 px of 512, its corners at
38.3 % of the size from the centre, inside the 40 % maskable safe zone. The manifest's
`background_color` is black (the splash screen matches the icon) and `theme_color` the light
paper; at run time the `theme-color` meta tags follow the theme ([Theme](#theme)).

## Font

Archivo, one variable family with a width axis (62-125 %) and a weight axis (100-900), from
`@fontsource-variable/archivo` (pinned) so it is served from the app's own origin and works
offline ([ADR 0010](adr/0010-visual-identity-and-themes.md)). The package's `wdth.css` would
also pull the Vietnamese subset, so `styles.css` declares its own two `@font-face` rules
(family `Archivo Variable`, `font-stretch: 62% 125%`) for the `latin` and `latin-ext` files of
the `wdth` cut, with the package's `unicode-range`s; Vite resolves the package paths in `url()`
and emits the two woff2 files (about 90 and 86 kB) into `dist/assets/`. Slovenian text needs
both (č, š and ž are in `latin-ext`). `vite.config.ts` adds `woff2` to the service worker's
precache glob. The type scale and the display treatment are in
[screens.md](screens.md#behaviour-shared-by-all-screens).

## i18n rule

Every user-visible string lives in `src/i18n/sl.ts` (Slovenian), grouped by screen; components
import `t` from `../i18n` and never hardcode copy. Identifiers, logs and RPC error details stay
English. `fromError(error)` turns an error into copy:

1. an `AMRAP_<TOKEN>` at the start of `error.message` (PostgREST puts the RPC's
   `AMRAP_<TOKEN>: detail` there) → `sl.errors[token]`;
2. else a Supabase Auth `error.code` → `sl.authErrors[code]`;
3. else `sl.genericError`.

Copy conventions:

- Messages address the user formally ("vi": "Vpišite", "Obrnite se"); buttons, menu items and
  select placeholders use the short form ("Rezerviraj", "Izberi stranko").
- One Slovenian word per domain term ([CONTEXT.md](../CONTEXT.md) has the English ones):
  termin (appointment and slot), rezervacija (booking), kredit (credit), stanje kreditov
  (balance), dodati kredite / nakup kreditov (top-up), popravek (adjustment), pozna odpoved
  (late cancel), vračilo (refund), rok za brezplačno odpoved (cutoff), stalni termin
  (recurring rule), zaprto obdobje (blocked period), povabilo (invite).
- A noun after a count takes its Slovenian plural form: the string is a `Plural`
  (`{ one, two, few, other }`, each a template with `{count}`) and the component calls
  `plural(forms, count)` from `i18n/fill.ts`, which picks the form with
  `Intl.PluralRules('sl')` (1 mesto, 2 mesti, 3 mesta, 5 mest). Copy that avoids the noun
  ("Novih terminov: {count}") needs no plural. A noun that agrees with a list rather than a
  shown count ("s terminom …", "s terminoma … in …", "s termini …") is an object keyed
  `single` / `pair` / `several` without `{count}` (`settings.overlapWarning`), picked by the
  list's length, so `sl.test.ts` does not take it for a `Plural`.
- Punctuation: `…` after a space for "in progress" lines, en dash for ranges, `»«` around the
  names of buttons and screens quoted in a sentence. Dates and times as in [time.md](time.md).

`sl.test.ts` checks that every token in the [rpcs.md](rpcs.md#error-tokens) error table has
an entry in `sl.errors`, that every `sl.errors` key appears in backticks somewhere in
`rpcs.md`, that no string is empty, that every `Plural` has all four forms and each contains
`{count}`, and that no `.ts`, `.tsx` or `.css` file in `src/` outside
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
  (`db.customer`, `db.balance`), the `settings` row, injected errors (`customersError`,
  `settingsError`, and `readErrors` keyed by table for any other read; `writeErrors` keyed by
  table makes every insert, update and delete on it return that error), and `db.tables` with
  rows for `customers` and `customer_balances` (added to the signed-in row, for the trainer's
  lists), `recurring_rules`, `slot_templates`, `slot_occupancy`, `appointments`,
  `credit_transactions`, `blocked_periods` and `push_subscriptions`. The query fake supports
  `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `or` (comma-separated `column.operator.value`),
  `order`, `limit` and `range(from, to)` (both ends inclusive, as in PostgREST), and applies
  them the way PostgREST would (timestamps compared as instants), so a test fails when the
  app selects the wrong rows; an unexpected table throws.
  `insert` (with `.select().single()`), `update` and `delete` with filters change `db.tables`
  (inserts get an id and the column defaults the app relies on).
- `fakeSupabase.rpc` simulates `book` (inserts a booked appointment and counts it in
  `slot_occupancy` when it has a template), `cancel` (marks it `cancelled`, or
  `cancelled_by_trainer` with a `refund` row when the trainer cancels a charged one, and
  uncounts it), `top_up` and `adjust` (add a ledger row), `create_invite` (sets and returns a
  token) and `activate_rule` / `deactivate_rule` (flip `active`; deactivating cancels the rule's
  future booked appointments) and `save_push_subscription` (upserts the signed-in user's row by
  endpoint). Any other RPC throws unless a test mocks it. Tests mock a rejection with
  `mockResolvedValueOnce({ data: null, error: { message: 'AMRAP_…: detail' } })`.
- `holdTable(table)` holds every read and write of that table (`then`, `single`,
  `maybeSingle`) until the returned function is called, to test what a screen shows while a
  request runs; `resetFake` drops any hold.
- `resetFake({ session?, customer? })` in `beforeEach` clears the state (tables empty, default
  settings) and the mocks and optionally starts signed in. `onAuthStateChange` delivers
  `INITIAL_SESSION` on a microtask, like the real client.
- `emitAuth(event, session)` simulates Supabase Auth announcing a change (sign-in, token
  refresh, sign-out).
- `auth.getSession` returns the current `db.session` (the `/logout` loader reads it).
- `makeSession`, `makeCustomer`, `authError` build fixtures; the `auth.signUp` /
  `signInWithPassword` mocks and any other RPC are set per test.
- `src/data/data.test.ts` and `trainer.test.ts` call the data layer with the fake directly
  (`fakeSupabase as unknown as Client`).

Install tests wrap what they render in `InstallContext.Provider` with
`fakeInstallPlatform({ device?, dismissed? })` from `fakeInstall.ts` (`firePrompt(outcome)`
captures a fake prompt event); `routes.test.tsx`'s `renderAt` does the same with a desktop
default (no card) unless a test passes its own.

Push tests pass `fakePlatform(...)` from `fakePush.ts` to `PushToggle` (its `platform` prop) or
to `enablePush` / `disablePush`, so they need no browser push APIs; `push/logout.test.tsx` mocks
`push/browser` for the `/logout` loader.

`routes.test.tsx` renders the real route tree in a `createMemoryRouter` and asserts on what the
user sees. Build-only plugins (the PWA service worker) are left out when `VITEST` is set.
