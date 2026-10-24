# 0012. Cloudflare Workers static assets instead of Cloudflare Pages

Status: Accepted
Date: 2026-10-25

Supersedes the Cloudflare Pages part of [ADR 0005](0005-supabase-free-tier-cloudflare-pages.md);
the Supabase part stands.

## Context

ADR 0005 planned Cloudflare Pages with a Git integration. Nothing was ever deployed there. The
owner installed and signed in to the Cloudflare CLI, `cf` (OAuth). `cf deploy` deploys
Workers; for Pages `cf` only manages existing projects and cannot upload. Cloudflare now
documents Workers with static assets as the way to host a static site or SPA; the SPA
fallback AMRAP needs exists there, and so do `_headers` and `_redirects`. There is no custom
domain yet: the app goes on the free `*.workers.dev` address.

Findings from the Cloudflare docs (checked 2026-10-25):

- **SPA fallback.** `assets.not_found_handling = "single-page-application"` (in `cf`'s
  `cloudflare.config.ts`: `assets.notFoundHandling`) answers a path with no matching file with
  `/index.html` and `200 OK`, without a Worker script
  ([SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/),
  [routing](https://developers.cloudflare.com/workers/static-assets/#routing-behavior)).
- **`_redirects` and `_headers`** are honoured natively from the assets directory
  ([redirects](https://developers.cloudflare.com/workers/static-assets/redirects/),
  [headers](https://developers.cloudflare.com/workers/static-assets/headers/)). Redirects "are
  always followed, regardless of whether or not an asset matches the incoming request", so the
  Pages-era rule `/* /index.html 200` would answer every script, stylesheet and `sw.js` with
  `index.html`.
- **Caching.** Every asset is served with `Cache-Control: public, max-age=0, must-revalidate`
  and an `ETag` (default headers, same page): browsers keep a copy but revalidate it on each
  use. `index.html` and `sw.js` are therefore never served stale, so a new deploy reaches an
  installed PWA at its next service worker update check.
- **Free plan.** Requests that match a static asset are free and unlimited and never invoke a
  Worker; the 100,000 requests/day limit counts Worker invocations
  ([billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)).
  On Workers Free a version holds up to 20,000 files of at most 25 MiB each
  ([limits](https://developers.cloudflare.com/workers/platform/limits/#static-assets)); the build
  has 15 files, the largest about 320 kB. Over a limit, Free returns errors (for example 429)
  and does not bill.
- **`cf` projects.** `cf dev`, `cf build` and `cf deploy` read `cloudflare.config.ts`, not
  `wrangler.jsonc`. In a directory with a Vite config `cf` runs `vite build` and expects the
  Cloudflare Vite plugin (beta); without a framework it builds with Wrangler, which takes the
  assets directory from `wrangler.config.ts` (experimental). `cf` keeps its own login and does
  not share it with Wrangler ([cf projects](https://developers.cloudflare.com/cf/projects/),
  [cf for Wrangler users](https://developers.cloudflare.com/cf/wrangler/)).
- **Custom domains** on a Worker need the domain to be an active zone on the account, with its
  nameservers on Cloudflare; unlike Pages, a domain whose DNS stays elsewhere is not supported
  ([custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).

## Decision

- The app is served by an assets-only Worker named `amrap` on the Workers Free plan, at
  `amrap.<account subdomain>.workers.dev`. No Worker script, no bindings, no observability, no
  custom domain.
- The deploy configuration lives in `app/deploy/`, a small package of its own:
  `cloudflare.config.ts` (name, compatibility date, `workersDev`, the SPA setting),
  `wrangler.config.ts` (assets from `../dist`) and `package.json` pinning `cf` and `wrangler`
  exactly. It has no Vite config, so `cf` uploads the app's own build unchanged; the app's
  dependencies, its Vite config and CI stay as they are.
- The build runs locally with the public build-time values in the gitignored
  `app/.env.production.local`; `cf deploy` from `app/deploy/` uploads `app/dist`. Steps,
  rollback and the usage check are in the runbook ("Cloudflare Workers deploy").
- `app/public/_redirects` is deleted; the SPA setting replaces it. No `_headers` file: the
  default revalidating headers are what the service worker needs.
- Deploys are manual (the `release-checklist` skill) until the owner adds a Cloudflare API
  token for GitHub Actions.

## Consequences

- No Git integration and no preview deployment per pull request; a merge to `main` is live
  only after someone runs the deploy.
- `cloudflare.config.ts` and `wrangler.config.ts` are beta interfaces and may change. The
  fallback is a `wrangler.jsonc` with the same settings and `npx wrangler@4.152.0 deploy`
  after `wrangler login` (runbook).
- Hashed files under `/assets/` are revalidated on every use too. A `_headers` rule with a
  long `max-age` would save those round trips; it is optional and not done.
- Supabase Auth's Site URL and Redirect URLs must name the workers.dev URL (an owner action)
  and change again when a domain is chosen. A domain needs its nameservers moved to
  Cloudflare (a free zone); buying it elsewhere is fine.
