# Browser tests in CI — design

Date: 2026-11-19. Status: waiting for owner approval.

## Intent

A pull request should prove that the app works end to end before it merges. Today CI runs
database tests (pgTAP), unit tests (Vitest), edge function tests (Deno) and the docs check.
Nothing opens the app in a browser against a real database. This project adds that layer and
makes all checks required on `main`.

This is the second of three projects. It comes before self-registration, so that the
registration work can add its own browser test.

## Goals

1. A small set of browser tests runs the main customer and trainer flows against the built app
   and the local Supabase stack.
2. The tests run in GitHub Actions on every pull request and on pushes to `main`.
3. A failed run leaves a report with a trace, so a failure can be read without running it
   locally.
4. The same tests run locally with one command.
5. `main` requires every CI job to pass before a merge.

## Non-goals

- Replacing pgTAP or Vitest. Rules about money, capacity, the cutoff and roles stay in pgTAP,
  where time can be controlled. Browser tests check that the screens and the database work
  together.
- A separate API integration layer. pgTAP already tests the RPCs, and the browser tests cover
  the app calling them.
- Push delivery. It needs the edge runtime and a real push service. It stays a manual check on
  a phone.
- Tests against the hosted project. CI never touches it.
- Visual regression (screenshot comparison).
- Several browsers. See "Left to the builder" for when to add WebKit.

## Anti-goals

- Tests that fail at random. One flaky test teaches everyone to ignore the check.
- Tests that depend on each other's data or on the order they run in.
- Tests that depend on the day of the week or the time of day.
- A CI job so slow that people stop waiting for it. Target: under 5 minutes for the job.

## Constraints

- Supabase free tier, GitHub free plan. The repository is public, so standard GitHub runners
  cost nothing.
- The Supabase CLI version stays pinned to the one in `.github/workflows/ci.yml`.
- UI copy is Slovenian and changes often. Tests must not hardcode it.
- No test may be disabled to make a run pass.

## Approaches

**Test runner**

| Approach | Trade-off |
|---|---|
| A. Playwright (`@playwright/test`) | Starts the app itself, waits for elements without sleeps, records traces, has a GitHub Actions report. One new dev dependency. **Chosen.** |
| B. Cypress | Similar result, slower start in CI, weaker support for several signed-in users in one test (trainer and customer). Rejected. |
| C. Vitest browser mode | Reuses the existing runner, but it tests components, not a served app with real sign-in and routing. Rejected. |

**What the tests run against**

| Approach | Trade-off |
|---|---|
| A. Production build served by `vite preview`, local Supabase stack | Tests what is deployed, including the service worker. **Chosen.** |
| B. Vite dev server | Faster to start, but not the code that ships. Rejected. |
| C. Hosted project | Real environment, but tests would write to live data and need secrets in CI. Rejected. |

**Test data**

| Approach | Trade-off |
|---|---|
| A. Each test creates its own customer and data through a helper | Tests are independent and can run in any order or in parallel. **Chosen.** |
| B. Shared rows from `supabase/seeds/dev.sql` | No setup code, but tests change shared rows and then depend on order. Rejected. |
| C. `supabase db reset` before each test | Fully clean, but each reset takes many seconds. Rejected. |

## Design

### 1. Layout

```
app/
  e2e/
    fixtures.ts        # test helpers: create a customer, sign in, assign a fixed appointment
    auth.spec.ts
    customer.spec.ts
    trainer.spec.ts
  playwright.config.ts
```

- `@playwright/test` is a dev dependency of `app/`, pinned to an exact version like the other
  dependencies.
- Scripts in `app/package.json`: `e2e` (build, then run) and `e2e:ui` (Playwright's local UI).
- Vitest must not pick up `app/e2e/`; the Vitest config excludes it.
- `playwright.config.ts` starts `vite preview` through Playwright's `webServer` option and
  points the build at the local stack with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

### 2. Browser

One project: Chromium with a phone profile (Playwright's "Pixel 7"). The app is used on phones,
and the customer screens are designed for phone width.

### 3. Test data

`fixtures.ts` gives each test what it needs:

- **A fresh customer:** an auth user and a linked `customers` row with a unique email, created
  with the Supabase admin API and the local service role key. The key comes from an environment
  variable that CI fills from `supabase status`. It is the local demo key, not a secret.
- **The trainer:** the seeded `trainer@amrap.local` from `supabase/seeds/dev.sql`.
- **A fixed appointment:** the helper signs in as the trainer through the API and calls the
  real RPCs (`activate_rule` on a new recurring rule), so the appointments are created the same
  way as in production. The helper makes its own slot template for the test, so slots never
  fill up across tests.
- **Sign-in:** through the real login page once per role per test file, then reused with
  Playwright's stored session state.

Appointments come from the materialization job, which creates the next four weeks from today.
A test picks "the first upcoming appointment that starts later than the cutoff", so it does not
depend on the weekday or the hour.

### 4. First flows

| File | Flow |
|---|---|
| `auth.spec.ts` | Trainer signs in and lands on `/t`. Customer signs in and lands on `/c`. A wrong password shows the error. A customer who opens `/t` is sent to `/c`. |
| `customer.spec.ts` | A customer with a fixed appointment sees it on Home. They cancel one, it moves to the cancelled list, they undo it, and it is back in the upcoming list. The calendar shows free places and has no book button (see `2026-11-26-free-slots-overview-design.md`). |
| `trainer.spec.ts` | The trainer assigns a fixed appointment to a customer on the customer's page; the customer then sees it. The trainer cancels one appointment with a reason; the customer sees it as cancelled by the trainer in History with the reason. |

The registration project adds `registration.spec.ts`.

### 5. Rules that keep the tests stable

- Find elements by role and accessible name. Take the names from `app/src/i18n/sl.ts` by
  import, never as typed strings, so a copy change does not break a test.
- No fixed waits. Use Playwright's built-in waiting on elements and URLs.
- One retry in CI, none locally. A trace is recorded on the retry.
- Tests run in parallel locally and with two workers in CI.
- A test that fails only sometimes is fixed or its cause is reported. It is never skipped.

### 6. CI job

A new job `e2e` in `.github/workflows/ci.yml`:

1. Check out, set up the pinned Supabase CLI, `supabase start` with the same excluded services
   as the `db` job.
2. Set up Node from `app/.node-version` with the npm cache, `npm ci`.
3. Install Chromium for Playwright with its system packages. Cache the browser download by
   Playwright version.
4. `npm run e2e`.
5. On failure, upload the Playwright HTML report and traces as an artifact, kept 7 days.

Timeout 15 minutes. The job runs beside the existing jobs, not after them.

### 7. Required checks

After the job has passed on `main` once, the owner turns on branch protection for `main`:
require the jobs `db`, `app`, `functions`, `docs` and `e2e`, and require branches to be up to
date before merging. This is a GitHub setting (or one `gh api` call), described in
`docs/harness.md`. It is an owner action, because it changes how every later merge works.

### 8. Docs

`docs/harness.md` gets a "Browser tests" section: what they cover, what they do not, how to run
them, how to read a failed run, and the rules in section 5. The "Testing" table gets a row per
spec file. One ADR records the choice of Playwright and the test-data approach.

## Left to the builder

- Exact helper names and the shape of `fixtures.ts`.
- Whether the build step in CI reuses the `app` job's build or builds again (building again is
  simpler; choose that unless it costs more than a minute).
- Check current Playwright and Supabase documentation for the config options before writing
  them; do not write them from memory.
- A WebKit phone project (closer to iPhone Safari) can be added later if a Safari-only bug gets
  through. It is not part of this project.

## Owner actions

- Turn on branch protection after the first green run on `main`.
