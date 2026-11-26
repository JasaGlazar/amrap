# 0020. Playwright browser tests against the built app and the local stack

Status: Accepted
Date: 2026-11-26

## Context

CI runs pgTAP, Vitest, the Deno tests and the docs check. None of them opens the app in a
browser against a real database. A change could pass every check and still break sign-in or a
screen that calls an RPC. The UI copy is Slovenian and changes often, so tests that type copy
break for no reason. The developer's machine has `app/.env.production.local`, which points at
the hosted project. Tests must never write to it.

## Decision

- Use Playwright (`@playwright/test`), pinned to an exact version. Cypress gives a similar
  result but starts slower in CI and handles two signed-in users in one test (trainer and
  customer) less well. Vitest browser mode tests components, not a served app with real
  sign-in and routing.
- Test the production build served by `vite preview`, not the Vite dev server. The build is
  the code that ships, service worker included.
- Each test makes its own data through fixtures in `app/e2e/fixtures.ts`: a fresh customer
  (auth user and `customers` row) and, when needed, its own slot template with a recurring
  rule. The rule is created as the trainer with the app's own calls (`activate_rule`). Shared
  rows from `supabase/seeds/dev.sql` would make tests depend on each other and on their order.
  A `supabase db reset` before each test would take many seconds.
- Build in Vite mode `e2e` (`vite build --mode e2e`) and pass `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` as process environment variables. Vite loads `.env.[mode].local`
  only for its own mode, so mode `e2e` keeps `.env.production.local` out. In mode `e2e`,
  `app/vite.config.ts` also sets `envDir: false`, so the build reads no `.env` file at all.
- Build into `app/dist-e2e` and serve it from there, so a production build in `app/dist`
  that waits for deploy is never replaced.
- `app/e2e/env.ts` refuses any Supabase URL whose host is not `127.0.0.1` or `localhost`.
  Every browser context in a test aborts requests to any other host. The test then fails and
  lists those hosts.
- Tests find elements by role and accessible name, with the names imported from
  `app/src/i18n/sl.ts`.

## Consequences

- A pull request proves that sign-in and the main screens work against a real database.
- One more dev dependency and a Chromium download (cached in CI).
- Rules about time (the cutoff, charging, materialization) stay in pgTAP, where time can be
  controlled. Push delivery stays a manual check on a phone.
- The local stack allows 1000 sign-ins and sign-ups per 5 minutes per IP address
  (`supabase/config.toml`). The fixtures sign the trainer in through the API once per worker,
  but very many reruns in a row can still hit the limit.
- A WebKit phone project can be added later if a Safari-only bug gets through.
