# 0010. Visual identity and themes

Status: Accepted
Date: 2026-10-24

## Context

Until Stage 5 the app used a placeholder look: a teal accent, system fonts, a white "A" on teal
as the PWA icon and the plain text "AMRAP" in the top bar. After Stage 5 the owner saw no
meaningful change and asked for the app to read as the gym's brand. The gym's logo
(`app/public/logo.png`) is white on black: a heavy, condensed wordmark inside a thin
rectangular frame, with a grey tagline. The owner ruled (2026-10-24): black, white and grey,
red only for debt and late cancels, a muted green only for "opravljeno" and added credits,
light by default following the system, with a switch. Constraints: Supabase and Cloudflare
free tiers only, the app works offline as a PWA, Slovenian copy needs č, š and ž, and no new
build tools for images.

## Decision

- **Palette from the logo.** Pure black is the brand ink (no tinted near-black). Every colour is
  a token on `:root` in `app/src/styles.css` (`--paper`, `--surface`, `--ink`, `--text`,
  `--muted`, `--line`, `--control-line`, `--debt` / `--debt-bg`, `--done` / `--done-bg`,
  `--overlay`, `--shadow`); components never set a colour of their own. Every text pair passes
  4.5:1 and every control edge 3:1 in both themes (values in
  [screens.md](../screens.md#behaviour-shared-by-all-screens)).
- **Two themes.** Dark values apply under `@media (prefers-color-scheme: dark)` for
  `:root:not([data-theme="light"])` and always under `:root[data-theme="dark"]`. The choice is
  per device in `localStorage` (`amrap.theme` = `system | light | dark`); an inline script in
  `index.html` sets `data-theme` before the first paint, so there is no flash of the wrong theme.
  The control is in the account menu in the top bar.
- **One typeface.** Archivo, self-hosted from `@fontsource-variable/archivo` (variable width
  and weight, Latin and Latin Extended only), precached by the service worker so it works
  offline. A condensed heavy cut (width 75, weight 800) echoes the wordmark for page titles, the
  balance and slot times; the body is width 100.
- **The frame is the one strong element.** The logo's rectangular frame (2 px `--ink`, square
  corners) appears on the wordmark in the top bar and around the balance. Everything else is
  quiet: 6 px radius, no shadows except the dialog, no gradients, no all-caps labels.
- **No new image tools.** The wordmark (`public/brand-mark.png`) and the PWA icons are cropped
  and padded from the logo with macOS `sips`; the hand-written icon generator
  (`scripts/generate-icons.mjs`) is removed. The light theme shows the white-on-black mark
  through `filter: invert(1)`, so there is one image for both themes; a `contrast(1.1)` in the
  same filter takes the logo's near-black background (`#060807`) to the pure black of the
  paper.

## Consequences

- A colour change is a token change, and its contrast is recomputed and recorded in
  `screens.md`.
- The font adds about 100 kB (two woff2 files) to the first load and the precache.
- Replacing the logo means re-running the `sips` commands in
  [app-structure.md](../app-structure.md#brand-assets) by hand; they need a Mac.
- Pages that are not in the app shell (sign-in, invite, error pages) follow the theme too,
  since the tokens live on `:root`.
