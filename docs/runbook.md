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

The trainer is the only user not created through an invite. This is done once per environment.
The SQL below is a placeholder and is finalized in Task 2 once the schema exists.

1. Create the trainer's auth user in the dashboard (Authentication, Add user) with email and
   password.
2. Run in the SQL editor, replacing the placeholders:

```sql
-- PLACEHOLDER: finalized in Task 2
insert into customers (name, email, role, auth_user_id)
values ('<trainer name>', '<trainer email>', 'trainer', '<auth user uuid>');
```

3. Sign in to the app and confirm the trainer shell is shown.

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
