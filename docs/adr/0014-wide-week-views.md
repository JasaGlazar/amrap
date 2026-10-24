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

- **Only the week view widens, to the right.** An element with the class `wide` starts, from
  1024 px, at the content column's left edge, in line with the title, and grows to the right
  only, to `--content-wide` (80 rem) or up to one page gutter from the window's right edge
  (`(100vw + --content) / 2 − 2 × --space-4`), whichever is smaller. The title, tabs, section
  heading and forms stay on the 46 rem column, and so does the top bar, so nothing moves when
  the trainer changes tabs or screens, and the page keeps one left edge. The rule assumes the
  `wide` element's parent is the content column (a direct child of a section or of the page),
  since the formula derives the column's left edge from `--content`.
- **The wide element scrolls itself.** `wide` also carries `overflow-x: auto`: at any width,
  when what it holds needs more room than it has, it scrolls sideways inside its own box and
  the page never does. Below 1024 px it simply stays in the column. The Urnik grid keeps its
  day columns at least 7 rem and wide enough for its most slots side by side at 44 px each,
  with the hours column sticky while it scrolls. Stage 10's calendar puts `wide` on its own
  container and its own grid inside, without new layout rules.
- **Below 768 px there is no grid.** A phone gets a list grouped by day instead; the two are
  separate markup chosen by a media query in script (`useMediaQuery`), not two copies hidden by
  CSS, for the same reason as the single navigation in ADR 0011.

## Consequences

- Stage 10's calendar can reuse `wide` and `--content-wide` without a new layout rule. It
  did (issue #17): the trainer Koledar's week grid is a `wide` box from 1024 px, with a day
  view below 1024 px chosen the same way in script; its columns are at least 8.5 rem (so
  "Prosta mesta: 0 od 5" stays on one line), the whole week is visible from 1280 px, and at
  1024-1279 px it scrolls inside the box.
- `100vw` includes a classic scrollbar (about 15 px) while the column is centred on the
  visible area, so the right edge lands about half a scrollbar short of one gutter from the
  window; it stays inside the window for any scrollbar narrower than two gutters.
- At 1440 px the grid is about 66 rem wide (1056 px) rather than 80 rem: the right-hand
  margin of the centred column limits it, which keeps the page balanced on the title's edge.
- At 768-1023 px the trainer sees about five or six days at once and scrolls for the rest.
- `docs/screens.md` ("Wide views" in the shared rules, and Urnik) describes the result.
