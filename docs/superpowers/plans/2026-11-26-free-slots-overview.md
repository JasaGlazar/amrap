# Free Slots Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every customer sees the week grid with free places; the book button shows only when `settings.customer_booking_enabled` is true.

**Architecture:** The customer calendar already loads the settings through `loadWeek` (`Week.settings: GymSettings`). The calendar itself decides whether to show book buttons from `settings.customerBookingEnabled`. The route guard and the settings read in the customer shell, both added by PR #30, are removed. No database change.

**Tech Stack:** React, React Router, Vitest with the fake Supabase client in `app/src/test/fakeSupabase.ts`.

**Spec:** `docs/superpowers/specs/2026-11-26-free-slots-overview-design.md`

**Starts from:** `main` after PR #30 (`feat/minimal-customer-scope`) is merged. Branch `feat/free-slots-overview`.

## Global Constraints

- No migration, no RPC change. `book()` keeps refusing customers while the setting is off.
- Customers see counts only, never who is in a session.
- UI copy is Slovenian in `app/src/i18n/sl.ts`; every new or changed string gets its row in `docs/copy-review.md` (changed strings also a row in its "Changes" table).
- Docs are plain English with short sentences. Code comments stay minimal.
- Never weaken an assertion. Tests that describe removed behaviour are replaced, not skipped.
- Gates: in `app/`: `npm run lint && npm run typecheck && npm test -- --run && npm run build`; `bash scripts/check-docs.sh`; `supabase test db` stays green.

## Review Focus

1. **Booking was turned off after the screen loaded.** A stale tab still has book buttons; a tap shows the `AMRAP_BOOKING_DISABLED` copy. (Existing test "shows the booking-off copy when booking was turned off after the screen loaded" must stay.)
2. **The settings read fails.** The calendar shows `common.loadFailed` and no book button; Home and History still open from the navigation.
3. **A full session while booking is off.** It shows »Polno«, not an empty action area that looks free.
4. **The customer's own appointment while booking is off.** »Rezervirano« and »Odpovej« still show, and the cancel dialog works.
5. **A past or blocked session while booking is off.** It shows no »Polno« tag unless it is full, and keeps the muted style.

---

### Task 1: Read-only customer calendar

**Files:**
- Modify: `app/src/pages/CustomerPages.tsx`, `app/src/routes.tsx`, `app/src/pages/customer/Calendar.tsx`, `app/src/i18n/sl.ts`
- Test: `app/src/routes.test.tsx`, `app/src/pages/customer/customer.test.tsx`
- Docs: `docs/screens.md`, `docs/app-structure.md` (if it names `CustomerBookingRoute`), `docs/copy-review.md`, `docs/pilot.md`, `docs/runbook.md` ("Turn customer booking on")

**Interfaces:**
- Consumes: `Week.settings.customerBookingEnabled: boolean` from `loadWeek` (`app/src/data/week.ts`).
- Produces: `CustomerShell` with a fixed navigation (Domov, Koledar, Zgodovina) and no settings read. `CustomerBookingRoute` and the booking context no longer exist. New copy key `calendar.viewOnly`.

- [ ] **Step 1: Write the failing tests.**
  In `routes.test.tsx`, replace the PR #30 tests "leaves the calendar out of the navigation while booking is off", "sends /c/koledar to /c while booking is off", "neither shows nor leaves /c/koledar while the settings load", "treats booking as off when the settings read fails, and Home still renders" and "keeps Home working while the settings load" with:
  - `shows Koledar in the customer navigation while booking is off`
  - `opens /c/koledar while booking is off` (URL stays `/c/koledar`, the week grid renders)
  - `the customer shell reads no settings of its own` (open `/c/zgodovina` with `db.settingsError` set: the navigation and History render)

  Keep "opens /c/koledar while booking is on". Remove "reads settings once after sign-in, not again on token refresh" and "does not read settings while signed out" only if they test the shell's read that this task deletes; if they test another reader, keep them.

  In `customer.test.tsx`, `describe('calendar')`, with `customer_booking_enabled: false` in the fake settings:
  - `shows free places and no book button while booking is off` — the `calendar.spots` text shows for a free session; `queryByRole('button', { name: t.calendar.book })` is null.
  - `shows the view-only hint while booking is off` — `t.calendar.viewOnly` is in the page; with booking on it is not.
  - `marks a full session as full while booking is off` — the row shows `t.calendar.full` and it is not a button.
  - `keeps cancel on the customer's own appointment while booking is off` — »Odpovej« opens the dialog.
  - `shows no book button when the settings read fails` — `common.loadFailed` shows.

  The existing calendar tests that book a slot set `customer_booking_enabled: true` in their own setup.
- [ ] **Step 2: Run `npm test -- --run`.** Expected: the new tests fail (the link is hidden, the route redirects, the book button exists).
- [ ] **Step 3: Implement.**
  - `CustomerPages.tsx`: delete the booking context, `loadSettings`, `useLoad` and `CustomerBookingRoute`. `CustomerShell` returns `AppShell` with the three fixed items.
  - `routes.tsx`: `{ path: 'koledar', element: <CustomerCalendar /> }`.
  - `Calendar.tsx`: `const canBook = state.data.settings.customerBookingEnabled`. In `actions`, after the "mine" branch: when `canBook` is false, return `<span className="tag">{t.calendar.full}</span>` for a full session and `null` otherwise; when true, the button as today. Above the grid, when the load is ok and `canBook` is false, one `<p className="status">{t.calendar.viewOnly}</p>`.
  - `sl.ts`: `calendar.viewOnly: 'Za prost termin se dogovorite s trenerjem.'`
- [ ] **Step 4: Run the gates.** Expected: all pass.
- [ ] **Step 5: Docs.** `docs/screens.md`: the customer navigation always has Koledar; the calendar's two states (booking off: counts, »Polno«, hint, own appointments; booking on: as before). `docs/pilot.md`: the customer steps mention the free-places view. `docs/runbook.md`: the calendar is always visible and the setting only adds the book buttons. `docs/copy-review.md`: the new string.
- [ ] **Step 6: Check at phone width.** Run the local stack and the dev server, sign in as `ana@amrap.local`, open Koledar at 360 px with booking off and on. Report what was seen. (The orchestrator does this step, not the implementer.)
- [ ] **Step 7: Commit** — `feat: show customers the free places while booking is off`.
