# 0014. Wide week views

Status: Accepted
Date: 2026-10-25

## Context

Every page sits in one 46 rem column (`--content`), and the top bar lines up with it
([ADR 0011](0011-responsive-navigation-and-on-demand-forms.md)). The owner asked for a week
grid in Nastavitve → Urnik from 768 px (issue #16): seven day columns side by side, with
overlapping slots side by side inside a column. In 46 rem, minus the time axis, a day column
is about 95 px and an overlapping half about 45 px, too narrow for "07:00–08:00". Stage 10
will put the trainer Koledar into days side by side too and needs the same room. Widening the
whole page (title, tabs and top bar) on one tab would move the wordmark, the title and the
settings tabs sideways every time the trainer switches between Urnik and the other tabs.

## Decision

- **Only the week view widens.** An element with the class `wide` grows, from 1024 px, to
  `--content-wide` (80 rem) or the window minus the page gutters (`100vw − 2 × --space-4`),
  whichever is smaller, centred on the page column. The title, tabs, section heading and
  forms stay on the 46 rem column, and so does the top bar, so nothing moves when the trainer
  changes tabs or screens.
- **Below 1024 px the view stays in the column.** Its day columns keep a minimum width
  (7 rem in the Urnik grid, room for "07:00–" in an overlapping half), and the view scrolls
  sideways inside its own box when the column is narrower; the page never scrolls sideways.
  The hours column stays in place while it scrolls.
- **Below 768 px there is no grid.** A phone gets a list grouped by day instead; the two are
  separate markup chosen by a media query in script (`useMediaQuery`), not two copies hidden by
  CSS, for the same reason as the single navigation in ADR 0011.

## Consequences

- Stage 10's calendar can reuse `wide` and `--content-wide` without a new layout rule.
- `100vw` includes a classic scrollbar, but the grid is centred on a column that is itself
  centred on the visible area, so it still keeps about half a gutter from each edge.
- At 768-1023 px the trainer sees about five or six days at once and scrolls for the rest.
- `docs/screens.md` ("Wide views" in the shared rules, and Urnik) describes the result.
