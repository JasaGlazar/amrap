# Browser Tests in CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright tests run the main customer and trainer flows against the built app and the local Supabase stack, locally with one command and in GitHub Actions on every pull request.

**Architecture:** Playwright lives in `app/e2e/`. Its config builds the app in a dedicated Vite mode, serves it with `vite preview`, and points it at the local stack through process environment variables. Each test creates its own customer, slot template and fixed appointment through a fixtures module, so tests are independent. A new `e2e` job in the existing workflow runs them.

**Tech Stack:** `@playwright/test` (exact version, newest that is at least two weeks old), Chromium with the "Pixel 7" device, `@supabase/supabase-js` (already a dependency), Supabase CLI 2.117.0 (pinned in CI).

**Spec:** `docs/superpowers/specs/2026-11-19-browser-tests-in-ci-design.md`

**Starts from:** `main` after the free slots overview is merged. Branch `feat/browser-tests-in-ci`.

## Global Constraints

- Tests never touch the hosted project. `app/.env.production.local` exists on the developer's machine and points at it, so the build must not load it: build with `vite build --mode e2e` and pass `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as process environment variables.
- Before writing config or API calls, read the current Playwright and Supabase documentation (Context7). Do not write option names from memory.
- No hardcoded UI copy in tests: import `sl` from `app/src/i18n/sl.ts` and use its strings as accessible names.
- No fixed waits (`waitForTimeout`). No skipped or disabled tests.
- Tests do not depend on each other, on their order, on the weekday or on the time of day.
- Dependencies are pinned to exact versions, like the rest of `app/package.json`.
- The Supabase CLI version in CI stays the one already in `.github/workflows/ci.yml`.
- The `e2e` job targets under 5 minutes; its timeout is 15 minutes.
- Docs are plain English with short sentences. Code comments stay minimal.
- Gates for every task: in `app/`: `npm run lint && npm run typecheck && npm test -- --run && npm run build && npm run e2e`; `bash scripts/check-docs.sh`.

## Review Focus

1. **The developer runs `npm run e2e` with `.env.production.local` present.** The built app must talk only to `127.0.0.1` or `localhost`. (Task 1: guard in the fixtures and a test that fails on any request to another Supabase host.)
2. **The local stack is not running.** The run fails at once with a message that says to run `supabase start`, not with thirty timeouts. (Task 1)
3. **Two tests run at the same time.** Each has its own customer and slot template, so neither sees the other's appointments or fills the other's session. (Task 1 fixtures; Task 2 runs with parallel workers)
4. **The run happens late on a Sunday or within 8 hours of the only session of a week.** A test still finds an appointment that can be cancelled for free, because fixed appointments exist four weeks ahead. (Task 2)
5. **A test fails in CI.** The uploaded report contains a trace that opens. (Task 3: prove it once with a deliberately failing commit on the branch, then remove it.)

## File Structure

| File | Responsibility |
|---|---|
| `app/playwright.config.ts` | one project (Pixel 7), web server (build in mode `e2e`, then preview), retries, reporters |
| `app/e2e/env.ts` | reads and checks the environment (local URL, anon key, service role key) |
| `app/e2e/fixtures.ts` | Playwright fixtures: admin client, `customer`, `fixedAppointment`, `signIn` |
| `app/e2e/auth.spec.ts`, `customer.spec.ts`, `trainer.spec.ts` | the flows |
| `app/tsconfig.e2e.json` | type-checks `e2e/` and `playwright.config.ts` |
| `.github/workflows/ci.yml` | new job `e2e` |

---

### Task 1: Playwright setup, fixtures and the sign-in flows

**Files:**
- Create: `app/playwright.config.ts`, `app/e2e/env.ts`, `app/e2e/fixtures.ts`, `app/e2e/auth.spec.ts`, `app/tsconfig.e2e.json`, `docs/adr/0019-playwright-browser-tests.md`
- Modify: `app/package.json`, `app/package-lock.json`, `app/tsconfig.json` (reference the new project), `app/vite.config.ts` (Vitest `exclude` for `e2e/**`), `app/eslint.config.js` (cover `e2e/`), `.gitignore` (`app/playwright-report/`, `app/test-results/`, `app/e2e/.auth/`), `docs/harness.md`, `docs/adr/README.md`

**Interfaces:**
- Produces (from `app/e2e/fixtures.ts`):
  - `test`, `expect` — the extended Playwright test object every spec imports.
  - fixture `customer: { id: string; name: string; email: string; password: string }` — a fresh auth user (admin API, email confirmed) and its linked `customers` row with a unique email `e2e-<random>@test.local`. Removed after the test (delete the auth user and the row; best effort).
  - fixture `fixedAppointment: { templateId: string; ruleId: string }` — a new active slot template with capacity 5 and a recurring rule for `customer`, created the way the app does it: signed in as the trainer through the API, the same calls as `addRule` in `app/src/data/rules.ts` (insert the rule, then `activate_rule`). The template is deactivated after the test.
  - `signIn(page: Page, who: { email: string; password: string }): Promise<void>` — fills the real login page and waits for the role's home URL.
  - `TRAINER = { email: 'trainer@amrap.local', password: 'password' }` (from `supabase/seeds/dev.sql`).
- Produces (from `app/e2e/env.ts`): `env: { supabaseUrl: string; anonKey: string; serviceRoleKey: string }`, read from `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, with the local demo values as defaults. It throws when the URL host is not `127.0.0.1` or `localhost`.
- Scripts in `app/package.json`: `"e2e": "playwright test"`, `"e2e:ui": "playwright test --ui"`.

- [ ] **Step 1: Install.** `npm install --save-dev --save-exact @playwright/test@<version>` in `app/`, then `npx playwright install chromium`.
- [ ] **Step 2: Write `auth.spec.ts`** (it fails until the config and fixtures exist):
  - `the trainer signs in and lands on /t`
  - `a customer signs in and lands on /c`
  - `a wrong password shows the sign-in error` — the alert has the app's copy for invalid credentials (take the key from `sl.ts`).
  - `a customer who opens /t is sent to /c`
  - `the app only talks to the local Supabase stack` — collect `page.on('request')` during a customer sign-in; every request whose URL contains `/auth/v1` or `/rest/v1` has host `127.0.0.1` or `localhost`.
- [ ] **Step 3: Run `npm run e2e`.** Expected: fails (no config).
- [ ] **Step 4: Write `env.ts`, `fixtures.ts`, `playwright.config.ts`.**
  Config decisions: `testDir: 'e2e'`; one project with `devices['Pixel 7']`; `fullyParallel: true`; `workers: process.env.CI ? 2 : undefined`; `retries: process.env.CI ? 1 : 0`; `trace: 'on-first-retry'`; `forbidOnly: !!process.env.CI`; reporter `html` (never opens by itself) plus `github` in CI and `list` locally; `webServer` runs `npx vite build --mode e2e && npx vite preview --port 4173 --strictPort` with `env` carrying `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `env.ts`, `reuseExistingServer: false`, and `baseURL: 'http://localhost:4173'`.
  A `globalSetup` calls the local REST endpoint once and throws `Local Supabase is not running. Run "supabase start" first.` when it gets no answer (Review Focus 2).
  Before relying on it, confirm in the Vite docs that process environment variables take priority over `.env` files and that mode `e2e` does not load `.env.production.local`.
- [ ] **Step 5: Run `npm run e2e`.** Expected: 5 passed. Run it three times in a row; all three pass.
- [ ] **Step 6: Run the other gates.** Vitest must not collect `e2e/`; `tsc -b` type-checks `e2e/`; ESLint covers `e2e/`.
- [ ] **Step 7: Docs.** `docs/harness.md`: new section "Browser tests" (what they cover and what they do not: time rules stay in pgTAP, push delivery stays manual; how to run; the rules from the spec's section 5; how the fixtures make data) and the "Testing" table row for `auth.spec.ts`. ADR 0019: Playwright over Cypress and Vitest browser mode; built app over dev server; per-test data over shared seeds; the `--mode e2e` build and why.
- [ ] **Step 8: Commit** — `test: add Playwright with fixtures and the sign-in flows`.

---

### Task 2: Customer and trainer flows

**Files:**
- Create: `app/e2e/customer.spec.ts`, `app/e2e/trainer.spec.ts`
- Modify: `app/e2e/fixtures.ts` (only if a helper is missing), `docs/harness.md`

**Interfaces:**
- Consumes: `test`, `expect`, `customer`, `fixedAppointment`, `signIn`, `TRAINER` from Task 1.

- [ ] **Step 1: Write `customer.spec.ts`.**
  - `a customer sees their fixed appointments on Home` — with `fixedAppointment`, the list under `sl.customer.upcomingTitle` (use the real key) has at least three rows.
  - `a customer cancels an appointment and restores it` — on the **last** upcoming row (always more than the cutoff away) tap »Odpovej«, confirm in the dialog; the row appears under the cancelled list with the undo button; tap it; the row is back in the upcoming list and the status line shows `sl.customer.restored`.
  - `the calendar shows free places and no book button` — open Koledar from the navigation; move forward one week; a row for the fixture's template shows the `calendar.spots` text; no button named `sl.calendar.book` exists.
- [ ] **Step 2: Write `trainer.spec.ts`.**
  - `the trainer assigns a fixed appointment and the customer sees it` — with `customer` only (no `fixedAppointment`; create the slot template through the admin client in the test): the trainer opens `/t/stranke/<customer.id>`, adds a fixed appointment for that template through the form; then, in a second browser context, the customer signs in and sees upcoming appointments on Home.
  - `the trainer cancels an appointment with a reason and the customer sees it` — with `fixedAppointment`: the trainer cancels the customer's next appointment from the trainer calendar or the customer's page with the reason `E2E razlog`; the customer's History shows that appointment with the trainer-cancel status and the reason.
- [ ] **Step 3: Run `npm run e2e`.** Expected: all pass. Run three times in a row; then once with `--workers=4 --repeat-each=3`. All pass (Review Focus 3 and 4). A test that fails once is fixed at its cause, not retried.
- [ ] **Step 4: Docs.** `docs/harness.md` "Testing" table rows for both files.
- [ ] **Step 5: Commit** — `test: cover the customer and trainer flows in the browser`.

---

### Task 3: CI job

**Files:**
- Modify: `.github/workflows/ci.yml`, `docs/harness.md` ("CI" section)

**Interfaces:**
- Consumes: `npm run e2e` (Task 1); the `supabase start` line of the existing `db` job.

- [ ] **Step 1: Add the job `e2e`** beside the others, `timeout-minutes: 15`:
  1. `actions/checkout@v4`
  2. `supabase/setup-cli@v1` with version `2.117.0`, then `supabase start -x studio,imgproxy,logflare,vector,edge-runtime`
  3. `actions/setup-node@v4` as in the `app` job, then `npm ci` (working directory `app`)
  4. Cache `~/.cache/ms-playwright` keyed by the `@playwright/test` version from `package-lock.json`; `npx playwright install --with-deps chromium`
  5. Export `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env` into `$GITHUB_ENV` (check the variable names the pinned CLI prints)
  6. `npm run e2e`
  7. `actions/upload-artifact@v4` with `if: ${{ !cancelled() && failure() }}`, path `app/playwright-report/`, `retention-days: 7`
- [ ] **Step 2: Push the branch and open a draft pull request** so the workflow runs. (Orchestrator step: needs the owner's go-ahead to push.) Expected: `e2e` is green; note its duration.
- [ ] **Step 3: Prove the report.** Push one commit that makes one assertion fail; confirm the job fails, the artifact exists and its trace opens; revert that commit (Review Focus 5).
- [ ] **Step 4: Docs.** `docs/harness.md` "CI": the new job, where to find the report of a failed run, and the owner action below.
- [ ] **Step 5: Commit** — `ci: run the browser tests on every pull request`.

## Owner actions after merge

- After the first green run on `main`, turn on branch protection for `main`: require `db`, `app`, `functions`, `docs` and `e2e`, and require branches to be up to date. `docs/harness.md` describes the setting.
