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
| `scripts/` | repo scripts (docs check, added in Task 5) |
| `.github/workflows/` | CI (added in Task 5) |

Start with [docs/README.md](docs/README.md).

## Run locally

Requires Docker, the Supabase CLI and Node.js.

```sh
supabase start        # local Postgres, Auth, Studio
supabase db reset     # apply migrations and seeds
supabase test db      # run pgTAP tests
supabase gen types typescript --local > app/src/lib/database.types.ts   # after a schema change
cd app && npm i && npm run dev
```

The local seed (`supabase/seeds/dev.sql`) signs in as `trainer@amrap.local` or
`ana@amrap.local`, both with password `password`. Writing tests: see the "Testing" section of
[docs/harness.md](docs/harness.md#testing).

## Operations

Unpausing the free-tier project, bootstrapping the trainer, deploying migrations and
Cloudflare Pages settings are in [docs/runbook.md](docs/runbook.md).
