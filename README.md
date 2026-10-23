# AMRAP

AMRAP is a free-to-run PWA for a small personal-training gym. It replaces the paper wall
sheets (prepaid session credits) and the whiteboard (appointments). Customers book open slots
and cancel in-app; credits are charged automatically at session start or on late cancel; the
trainer manages the weekly grid, customers, top-ups and adjustments. The UI is in Slovenian.

The design is in [PLAN.md](PLAN.md); the domain vocabulary is in [CONTEXT.md](CONTEXT.md).

## Layout

| Path | Contents |
|---|---|
| `supabase/` | migrations, seeds, pgTAP tests, edge functions |
| `app/` | Vite + React + TypeScript PWA |
| `docs/` | harness conventions, runbook, ADRs, architecture diagrams, component docs |
| `.claude/agents/`, `.claude/skills/` | project reviewer agent and skills |
| `scripts/` | repo scripts (`check-docs.sh`: migrations and functions must be documented; `test-functions.sh`: edge function checks) |
| `.github/workflows/` | CI (`ci.yml`: pgTAP, app, edge function and docs checks; see [docs/harness.md](docs/harness.md#ci)) |

Start with [docs/README.md](docs/README.md).

## Run locally

Requires Docker, the Supabase CLI and Node.js.

```sh
supabase start        # local Postgres, Auth, Studio
supabase db reset     # apply migrations and seeds
supabase test db      # run pgTAP tests
supabase gen types typescript --local > app/src/lib/database.types.ts   # after a schema change
```

### Edge functions (`supabase/functions/`)

`supabase start` serves them. Push needs secrets in `supabase/functions/.env` (gitignored):
copy `supabase/functions/.env.example` and add a VAPID pair, then restart the stack
([docs/notifications.md](docs/notifications.md#local-setup)).

```sh
bash scripts/test-functions.sh   # deno fmt/lint/check/test (local deno or the Docker image)
```

### The app (`app/`)

Requires Node.js 22 or newer. The app reads the Supabase URL and anon key from
`app/.env.local` and refuses to start without them; `app/.env.example` holds the values of the
local stack (`supabase status -o env` prints them again).

```sh
cd app
cp .env.example .env.local
npm ci
npm run dev           # http://localhost:5173
npm run lint          # eslint + prettier --check
npm run typecheck
npm test              # vitest
npm run build         # type-check and production build into app/dist
```

Push notifications need `VITE_VAPID_PUBLIC_KEY` in `app/.env.local` and a production build
(`npm run build && npm run preview`): the dev server registers no service worker
([docs/notifications.md](docs/notifications.md#local-setup)).

After `supabase start`, restart the stack once (`supabase stop && supabase start`) when
`supabase/config.toml` changed so Auth picks up the `site_url` of the dev server.

The local seed (`supabase/seeds/dev.sql`) signs in as `trainer@amrap.local` or
`ana@amrap.local`, both with password `password`. Writing tests: see the "Testing" section of
[docs/harness.md](docs/harness.md#testing).

## Operations

Unpausing the free-tier project, bootstrapping the trainer, deploying migrations and
Cloudflare Pages settings are in [docs/runbook.md](docs/runbook.md).
