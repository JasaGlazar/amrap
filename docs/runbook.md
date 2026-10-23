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

## Re-link a customer

When a linked customer loses access (forgotten password, lost device, wrong email), there is
no password reset (ADR 0006). `create_invite` refuses linked records (`AMRAP_ALREADY_LINKED`),
so the old auth user is removed first (ADR 0007).

1. In the app (or SQL editor), find the customer and note their `auth_user_id`:
   `select id, name, auth_user_id from public.customers where name ilike '%<name>%';`
2. In the Supabase dashboard open Authentication, Users, find the user with that UID, and
   delete it. The foreign key `on delete set null` clears `customers.auth_user_id`; the
   customer's appointments and credits stay as they are. Their push subscriptions are deleted.
3. Check the record is unlinked: the query from step 1 now shows `auth_user_id` null.
4. In the app, create an invite for the customer (`create_invite`) and send the new link.
5. The customer opens the link and signs up again with a new password (same or new email);
   `accept_invite` links the new auth user. They re-enable notifications on their device.

This does not work for the trainer: only the trainer can create invites. To re-link the
trainer, create a new auth user as in "Bootstrap the trainer" step 1, then run
`update public.customers set auth_user_id = '<new auth user uid>' where role = 'trainer';`
(after deleting the old auth user).

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
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION=22` |

Production branch is `main`. Pull request branches get preview deployments.

Set `VITE_SUPABASE_URL` (the project URL, `https://etzkbwqgjuipihypokjp.supabase.co`) and
`VITE_SUPABASE_ANON_KEY` (the project's anon key from the Supabase dashboard, Project Settings,
API) for both Production and Preview. Both are public by design; access is controlled by RLS.
If either is missing the app shows a start-up error page that names the missing variable
(and logs it to the console) instead of a blank page, so a misconfigured deploy is visible.
`NODE_VERSION=22` pins the build's Node version (`app/.node-version` says the same, and
`app/package.json` requires Node 22 or newer). Vite inlines the variables at build time, so
changing them needs a new deployment.

Cloudflare Pages already falls back to `index.html` for unknown paths when a site has no
`404.html`, so deep links such as `/invite/<token>` work natively. `app/public/_redirects`
(`/* /index.html 200`) is a belt-and-braces measure; after the first deployment check the build
log for the redirects being parsed (and that `/invite/test` loads the app) and delete the file
if it is flagged.

### Auth URL configuration (dashboard action for the owner)

The remote Supabase project does not read `supabase/config.toml`. After the first Pages
deployment, open the dashboard, Authentication, URL Configuration, and set Site URL to the
Pages production URL; add the Pages URL (and `https://*.<project>.pages.dev` if preview
deployments should work) to Redirect URLs. Email confirmations stay disabled (ADR 0006).
