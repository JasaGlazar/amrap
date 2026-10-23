# Runbook

Supabase project "AMRAP", ref `etzkbwqgjuipihypokjp`, eu-central-1, Free Plan.

## Unpause a paused Supabase project

The Free Plan pauses a project after about 7 days of low user-database activity (ADR 0005).
The app's keep-alive read on every load normally prevents this.

1. Open the Supabase dashboard and select the project "AMRAP".
2. Click the restore/unpause button on the paused-project banner.
3. Wait until the project status is healthy (a few minutes).
4. Open the app and sign in to confirm data is intact.

If the project stays paused past the restore window, download the backup from the dashboard
before it is removed.

## Bootstrap the trainer

The trainer is the only user not created through an invite. This is done once per environment,
after the initial schema migration is deployed. Locally, `supabase db reset` already seeds a
trainer (`trainer@amrap.local` / `password`, see `supabase/seeds/dev.sql`).

1. Create the trainer's auth user in the dashboard (Authentication, Users, Add user, Create new
   user) with email and password, and tick "Auto Confirm User". Copy the new user's UID.
2. Run in the SQL editor, replacing the placeholders:

```sql
insert into public.customers (name, email, role, auth_user_id)
values ('<trainer name>', '<trainer email>', 'trainer', '<auth user uid>');
```

3. Check the link: `select id, name, role from public.customers where role = 'trainer';`
   returns exactly the one row.
4. Sign in to the app and confirm the trainer shell is shown.

## Deploy migrations after merge

Migrations reach the remote project only after the PR is merged. Never from a feature branch.

1. `git checkout main && git pull`
2. `supabase link --project-ref etzkbwqgjuipihypokjp` (once per machine)
3. `supabase db push`
4. Verify in the dashboard that the migration is listed and the app still works.

## Cloudflare Pages build settings

| Setting | Value |
|---|---|
| Root directory | `app` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

Production branch is `main`. Pull request branches get preview deployments.
