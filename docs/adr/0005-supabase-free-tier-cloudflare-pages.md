# 0005. Supabase free tier and Cloudflare Pages

Status: Superseded in part by 0012
Date: 2026-10-23

## Context

AMRAP must cost EUR 0 to run. It needs a transactional database with row-level security,
authentication, scheduled jobs (charging, materialization, reminders) and static hosting for a
PWA. Firebase was evaluated: scheduled functions require the paid Blaze plan, and Firestore
fits a transactional credit ledger poorly.

## Decision

- Backend: Supabase Free Plan (Postgres 17, Auth, RLS, edge functions, pg_cron).
- Frontend: Vite + React + TypeScript SPA hosted on Cloudflare Pages free tier.
- Firebase is rejected.

## Consequences

- Supabase pauses a Free Plan project after about 7 days of low user-database activity
  (Supabase docs, checked 2026-10-23). Mitigation: the frontend does a lightweight
  authenticated read on every load (keep-alive). Whether pg_cron activity alone counts as
  activity is unverified, so we do not rely on it.
- A paused project is unpaused from the Supabase dashboard; the steps are in `docs/runbook.md`.
- The database goes read-only above 500 MB; at this data volume that is far away, but it must
  be watched.
- No paid add-ons and no custom SMTP (see ADR 0006).
- Migrations reach the remote project only after merge to `main` (`supabase db push` from
  `main`), never from a feature branch.
- Local development needs Docker for `supabase start`.
