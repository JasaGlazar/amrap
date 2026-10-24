# 0011. Responsive navigation and on-demand forms

Status: Accepted
Date: 2026-10-24

## Context

The owner tested the app on a laptop (2026-10-24) and found it unintuitive. The fixed bottom
tabs, right for a phone, looked like a phone app stretched across a wide window. Nastavitve put
slot templates, the cutoff, blocked periods and the notifications toggle on one long page, and
every "new X" form (template, blocked period, customer, ad-hoc appointment, recurring rule,
customer details) was always open, so the screens read as forms and their actions were hard to
find. The trainer calendar showed an open customer select with a disabled **Dodaj** under
every occurrence, so a week was one long column of pickers and a full slot looked like a free
one. The owner ruled: navigation in the top bar from tablet width with bottom tabs kept on
phones, Nastavitve split into sub-tabs, and every "new X" form opened on demand. Stage 6's
tokens, type and account menu stay as they are.

## Decision

- **One navigation, placed by CSS.** `AppShell` renders a single `nav` inside the top bar,
  between the wordmark and the account menu. From 768 px it sits there on one line, left
  aligned after the wordmark, with a 2 px `--ink` underline on the open screen's link; below
  768 px the same element is a fixed bar at the bottom with a 2 px bar on top of the open tab.
  Rendering two navigations (one per width) was rejected: screen readers and the tests would
  find both. The top bar spans the window with a hairline below it and keeps its content on the
  46 rem page column, so the wordmark lines up with the page text at every width.
- **Settings as routes.** Each settings topic is its own child route of `/t/nastavitve`
  (`urnik`, `odpoved`, `zaprto`, `obvestila`), reached through a row of tabs (a `nav` of
  links with `aria-current`) under the title; the bare path redirects to `urnik`. Routes rather
  than in-page tab state, so a tab can be linked, reloaded and gone back to, and each tab loads
  only its own data. The main navigation's **Nastavitve** stays current on all four.
- **Forms on demand, one pattern.** A shared `OnDemand` component shows a button named after
  the action at the right of the heading the form belongs to; pressing it replaces the button
  with the form, focus moves to the form's first field, **Prekliči** closes it, drops the
  input and returns focus to the button, and a successful save closes it and shows the
  screen's usual notice. The parent owns the open state, so it can close the form on success
  and keep one open at a time where that matters. Focus goes back to the button only when the
  close removed the focused control, so closing one control because another opened does not
  pull focus back. The button sits at the heading rather than under the list (as the first
  sketch had it) so the main action is visible without scrolling on every screen.
- **The trainer calendar's add control** is one small **Dodaj stranko** per occurrence that
  opens the select for that occurrence only. When the occurrence cannot take anyone, the button
  is disabled and says why with the customer calendar's words, **Zaprto** or **Polno**.
- **Customer detail** follows the trainer's order of use: the balance with the credits form
  beside it from 768 px, then appointments, recurring rules, recent sessions and the ledger,
  with the invite and the details lower down.

## Consequences

- Every screen has fewer things open at once, and its main action is a labelled button near
  the title. A form that is not open cannot be filled in by mistake, but opening it is one more
  tap.
- New "new X" forms use `OnDemand`; tests open the form through its button first.
- The content column stays 46 rem at 1440 px. The trainer calendar is a long single column at
  that width; a wider layout (for example days side by side) would be a separate decision.
- `docs/screens.md` documents the main navigation, the forms-on-demand rule and the settings
  routes; `docs/app-structure.md` the shell.
