# 0017. Centred wide views

Status: Accepted
Date: 2026-10-25

Supersedes the "only the week view widens, to the right" part of
[ADR 0014](0014-wide-week-views.md); the rest of it (the box scrolls itself, no grid below
768 px) stands.

## Context

ADR 0014 started a `wide` box at the content column's left edge and grew it to the right only.
On a laptop (1440 px) that put the trainer Koledar's week grid about 350 px right of the
centred top bar, title and week arrows, with almost no margin on the right: the owner read it
as the calendar being shifted to the right. Two alternatives were tried in the browser:
centring the `wide` box on the column, and widening the whole shell (top bar and every page)
to `--content-wide` from 1024 px. The second lines everything up but stretches every list and
form (on Stranke a name sits about 1200 px from its balance), so it would need its own
narrower width per page.

## Decision

- **The wide box grows equally to both sides of the column.** From 1024 px a `wide` element is
  `min(--content-wide, 100vw − 2 × --space-6)` wide and centred on its parent with a negative
  left margin (`(100% − width) / 2`). The top bar, title, tabs, week arrows and forms stay on
  the 46 rem column, so nothing moves when the trainer changes screens or tabs; only the week
  grid sticks out, by the same amount on each side.
- **The parent only has to be centred on the column**, since the margin is computed from the
  parent's own width; it no longer has to be the column itself.

## Consequences

- At 1440 px the Koledar grid is 80 rem (1280 px) with 80 px on each side; below 1344 px it is
  the window minus 32 px on each side, and at 1024-1279 px the Koledar grid still scrolls
  sideways inside its box.
- The Urnik week grid (Nastavitve) uses the same box and is centred the same way.
- The page keeps two left edges on wide screens (the column's and the grid's), which the owner
  chose over a wider shell.
- With a classic scrollbar (about 15 px) `100vw` counts the scrollbar while the column is
  centred on the visible area, so each side's margin is about 8 px smaller than 32 px; it
  stays inside the window.
- `docs/screens.md` ("Wide views") describes the result.
