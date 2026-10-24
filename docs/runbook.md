# Runbook

Supabase project "AMRAP", ref `etzkbwqgjuipihypokjp`, eu-central-1, Free Plan.

## Unpause a paused Supabase project

The Free Plan pauses a project after about 7 days of low user-database activity (ADR 0005;
Supabase docs checked 2026-10-24: "a few user requests to the database each day" is typically
enough). The app's keep-alive read on every signed-in load normally prevents this
([auth.md](auth.md#keep-alive)). Supabase emails the owner roughly a week before pausing and
again once paused. On the warning email, open the project in the dashboard or the app to
generate activity; that is enough to prevent the pause.

While paused, the app cannot load data (it shows the lookup-failed page), pg_cron does not run,
and the edge function is unreachable. To restore:

1. Open the Supabase dashboard and select the project "AMRAP".
2. Click the restore button on the paused-project banner (one click; available for 1 year
   after the pause).
3. Wait until the project status is healthy (a few minutes).
4. Open the app and sign in to confirm data is intact.
5. In the SQL editor, check that the jobs are back and running:
   `select jobname, schedule, active from cron.job;` (three jobs) and, after the next quarter
   hour, `select jobid, status, start_time from cron.job_run_details order by start_time desc
   limit 10;`.
6. Catch up by hand instead of waiting: `select public.materialize_recurring();` (creates the
   instances the nightly runs missed) and `select public.charge_due_appointments();`.
7. Push: check the Vault rows (`select name from vault.secrets where name like 'amrap_%';`, two
   rows) and the function secrets (`supabase secrets list --project-ref etzkbwqgjuipihypokjp`);
   both are project data and survive the pause. Trigger one notification as in
   [Turn on push notifications](#turn-on-push-notifications) step 6.

What the pause changes for the business:

- Every `booked` appointment whose start passed during the pause is charged by the first
  charge run after the restore, as the rules say (nobody cancelled it). Customers could not
  cancel while the app was down, so the trainer reviews those sessions and cancels the ones that
  did not happen (trainer cancel of a charged appointment refunds it).
- Reminders whose window passed during the pause are not sent afterwards; the job only looks
  45 to 75 minutes ahead.
- Recurring instances are only created from today onward, so occurrences that fell inside the
  pause stay missing (nothing to charge).

If the project stays paused for more than a year, the one-click restore is gone: download the
database backup from the project dashboard and restore it into a new project (Supabase guide
"Restore a project paused for more than 1 year"); that is a new project ref, so the app's
environment variables, the push secrets and the Vault rows have to be set again.

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

## Invite a customer

The trainer does this in the app:

1. **Stranke** (`/t/stranke`): fill in **Nova stranka** (name; phone and email optional) and
   tap **Dodaj stranko**. The customer's page opens.
2. Under **Povabilo** tap **Ustvari povabilo**. The full link
   (`https://<pages-domain>/invite/<token>`) appears with **Kopiraj**; it is valid for 7 days.
   **Ustvari novo povabilo** replaces it (the old link stops working).
3. Send the link to the customer (text message). They open it, sign up with email and
   password and land on their home screen; the list then shows them as linked.

A linked customer has no invite button; see [Re-link a customer](#re-link-a-customer).

### Fallback: SQL editor

If the app is unavailable, the owner can do the same in the Supabase SQL editor.

1. Insert the customer record and note its id:

```sql
insert into public.customers (name, email, phone)
values ('<name>', '<email>', '<phone or null>')
returning id;
```

2. Issue a token (24 random bytes as hex, valid 7 days, replaces any earlier token). This is
   the same update `create_invite` performs:

```sql
update public.customers
set invite_token = encode(extensions.gen_random_bytes(24), 'hex'),
    invite_expires_at = now() + interval '7 days'
where id = '<id>' and auth_user_id is null and role = 'customer'
returning invite_token;
```

   No row returned means the record is already linked (see "Re-link a customer") or is
   not a customer record.
3. Send the customer `https://<pages-domain>/invite/<token>`.

`create_invite` itself cannot be called from the SQL editor: the editor runs without a JWT,
so `is_trainer()` is false and the function raises `AMRAP_FORBIDDEN`. The alternative is to
call it as the signed-in trainer from the browser devtools console of the running app. The
app does not expose its client globally, so `supabase.rpc('create_invite', { p_customer_id })`
only works where the client is in scope (a local dev server); on the deployed app use a plain
request with the trainer's session token:

```js
const { access_token } = JSON.parse(localStorage.getItem('sb-etzkbwqgjuipihypokjp-auth-token'));
fetch('https://etzkbwqgjuipihypokjp.supabase.co/rest/v1/rpc/create_invite', {
  method: 'POST',
  headers: { apikey: '<anon key>', Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_customer_id: '<id>' }),
}).then((r) => r.json()).then(console.log);
```

## Re-link a customer

When a linked customer loses access (forgotten password, lost device, wrong email), there is
no password reset (ADR 0006). `create_invite` refuses linked records (`AMRAP_ALREADY_LINKED`),
so the old auth user is removed first (ADR 0007).

1. Find the customer's `auth_user_id` in the SQL editor (the app does not show it):
   `select id, name, auth_user_id from public.customers where name ilike '%<name>%';`
2. In the Supabase dashboard open Authentication, Users, find the user with that UID, and
   delete it. The foreign key `on delete set null` clears `customers.auth_user_id`; the
   customer's appointments and credits stay as they are. Their push subscriptions are deleted.
3. Check the record is unlinked: the query from step 1 now shows `auth_user_id` null, and in
   the app the customer's status is no longer "Povezan račun".
4. Issue a new invite on the customer's page and send the new link, as in
   [Invite a customer](#invite-a-customer).
5. The customer opens the link and signs up again with a new password (same or new email);
   `accept_invite` links the new auth user. They re-enable notifications on their device.

This does not work for the trainer: only the trainer can create invites. To re-link the
trainer, create a new auth user as in "Bootstrap the trainer" step 1, then run
`update public.customers set auth_user_id = '<new auth user uid>' where role = 'trainer';`
(after deleting the old auth user).

## Deploy migrations after merge

Migrations reach the remote project only after the PR is merged. Never from a feature branch.
The whole post-merge release (these steps, the function deploy, the Pages check, a smoke test
and the release record) is the `release-checklist` skill
(`.claude/skills/release-checklist/SKILL.md`).

1. `git checkout main && git pull`
2. `supabase link --project-ref etzkbwqgjuipihypokjp` (once per machine)
3. `supabase db push`
4. Verify in the dashboard that the migration is listed and the app still works.
5. If `supabase/functions/` changed in the merge, redeploy the function:
   `supabase functions deploy send-push --no-verify-jwt --project-ref etzkbwqgjuipihypokjp`
   (first time: see [Turn on push notifications](#turn-on-push-notifications)).
6. After the push migration (`20261023214654_notifications_and_reminders.sql`), check in the
   SQL editor that pg_net is enabled in `extensions` and the reminder job is scheduled:
   `select extnamespace::regnamespace from pg_extension where extname = 'pg_net';` and
   `select jobname, schedule from cron.job;`. Until the push Vault rows are set the job runs
   and does nothing ([notifications.md](notifications.md#configuration)).

## Turn on push notifications

Push stays off on the hosted project until these steps are done; until then the reminder job
and the notification triggers run and record nothing (ADR 0009). Do them in this order, so a
request never reaches a function without its secrets. Run the CLI steps from an up-to-date
`main` after the Stage 3 merge, linked to the project (`supabase link --project-ref
etzkbwqgjuipihypokjp`).

1. **Generate a VAPID key pair** (once; keep the private key secret):
   `npx web-push@3.6.7 generate-vapid-keys`. Generate a push secret too:
   `openssl rand -hex 32`.
2. **Set the function secrets** from a temporary file outside the repo, so the values stay out
   of shell history, then delete the file:

```sh
cat > /tmp/amrap-push.env <<'ENV'
PUSH_SECRET=<push secret>
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:<trainer or owner email>
ENV
supabase secrets set --env-file /tmp/amrap-push.env --project-ref etzkbwqgjuipihypokjp
rm /tmp/amrap-push.env
supabase secrets list --project-ref etzkbwqgjuipihypokjp   # names only
```

3. **Deploy the function:** `supabase functions deploy send-push --no-verify-jwt --project-ref
   etzkbwqgjuipihypokjp` (`--no-verify-jwt` repeats what `config.toml` says). Check:
   `curl -s -X POST https://etzkbwqgjuipihypokjp.supabase.co/functions/v1/send-push -d '{}'`
   answers `{"error":"unauthorized"}` (401 from the function itself). Any other 401 body comes
   from the gateway: see the `apikey` note after step 6.
4. **Insert the Vault rows** in the dashboard SQL editor:

```sql
select vault.create_secret('https://etzkbwqgjuipihypokjp.supabase.co/functions/v1', 'amrap_functions_url');
select vault.create_secret('<push secret>', 'amrap_push_secret');
```

5. **Set the app's public key:** Cloudflare Pages, Settings, Variables:
   `VITE_VAPID_PUBLIC_KEY=<public key>` for Production and Preview, then redeploy (see
   [Cloudflare Pages build settings](#cloudflare-pages-build-settings)).
6. **Check:** on a phone signed in as a test customer, enable notifications; then the trainer
   tops that customer up by 1 and adjusts it back by -1 (each sends the customer a
   notification). In the SQL editor:
   `select id, status_code, content, error_msg from net._http_response order by id desc limit 5;`
   should show `200` with `{"claimed":1,"sent":<n>,…}` per notification, where `n` is the
   number of devices that customer enabled; the function logs are under Edge Functions,
   `send-push`, Logs.

If step 6 shows `401` with a body that is not `{"error":"unauthorized"}`, the hosted gateway
wants an `apikey` header even with JWT verification off (not verified locally, ADR 0009).
Report it: the fix is a small migration that adds the publishable key from a third Vault row
(`amrap_publishable_key`) to the request headers in `dispatch_notifications`.

To change the push secret, set `PUSH_SECRET` again and update the Vault row
(`select vault.update_secret(id, '<new>') from vault.secrets where name = 'amrap_push_secret';`).
To switch push off, delete the two Vault rows.

## Cloudflare Pages build settings

| Setting | Value |
|---|---|
| Root directory | `app` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY` (optional), `NODE_VERSION=22` |

Production branch is `main`. Pull request branches get preview deployments.

Set `VITE_SUPABASE_URL` (the project URL, `https://etzkbwqgjuipihypokjp.supabase.co`) and
`VITE_SUPABASE_ANON_KEY` (the project's anon key from the Supabase dashboard, Project Settings,
API) for both Production and Preview. Both are public by design; access is controlled by RLS. If
either is missing the app shows a start-up error page that names the missing variable (and logs
it to the console) instead of a blank page, so a misconfigured deploy is visible.
`VITE_VAPID_PUBLIC_KEY` is the public half of the push key pair ([Turn on push
notifications](#turn-on-push-notifications)); it is public by design. Without it the app works
and shows notifications as unavailable. `NODE_VERSION=22` pins the build's Node version
(`app/.node-version` says the same, and `app/package.json` requires Node 22 or newer). Vite
inlines the variables at build time, so changing them needs a new deployment.

Cloudflare Pages already falls back to `index.html` for unknown paths when a site has no
`404.html`, so deep links such as `/invite/<token>` work natively. `app/public/_redirects`
(`/* /index.html 200`) is a belt-and-braces measure; after the first deployment check the build
log for the redirects being parsed (and that `/invite/test` loads the app) and delete the file
if it is flagged.

### Auth URL configuration (dashboard action for the owner)

The remote Supabase project does not read `supabase/config.toml`. After the first Pages
deployment, open the dashboard, Authentication, URL Configuration, and set Site URL to the
Pages production URL; add the Pages URL (and `https://*.<project>.pages.dev` if preview
deployments should work) to Redirect URLs.

Then turn email confirmations off on the hosted project (ADR 0006). `config.toml` only
affects the local stack; a new hosted project has "Confirm email" ON by default.

1. Open Authentication, Sign In / Providers, Email.
2. Turn "Confirm email" off.
3. Keep "Allow new users to sign up" on (invite sign-up uses `signUp`).

If this is skipped, `signUp` succeeds but returns no session, so the invite page cannot call
`accept_invite` and stops, and every sign-up sends a confirmation mail through Supabase's
built-in SMTP, which is limited to 2 mails per hour on the Free Plan. The app shows a
"contact the trainer" message for the resulting `email_not_confirmed` error, but the fix is
the dashboard setting.
