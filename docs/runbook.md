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
   `select jobname, schedule, active from cron.job;` (four jobs) and, after the next quarter
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

1. **Stranke** (`/t/stranke`): tap **Nova stranka**, fill in the form (name; phone and email
   optional) and tap **Dodaj stranko**. The customer's page opens.
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
   the app the customer is tagged "Brez računa" (on Stranke and on the customer's page).
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
The whole post-merge release (these steps, the function deploy, the Workers deploy, a smoke test
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
7. After the retention migration (`20261024193349_data_retention.sql`), run `select
   public.prune_cron_history();` once in the SQL editor: it returns the number of cron runs it
   deleted (an integer). A `42501` means `postgres` may not delete from `cron.job_run_details`
   there, and the daily job would fail the same way ([jobs.md](jobs.md#prune_cron_history-daily)).

## Database size check

The Free Plan puts the database into read-only mode when its size passes 500 MB (WAL and
system files do not count). Retention per table and the yearly projection are in
[ADR 0013](adr/0013-data-retention.md): the business data grows by under 16 MB a year, the cron
log is kept to 14 days, and the Supabase Auth audit log is the one log nothing trims.

**When:** monthly during the pilot (the first check records the hosted baseline), then every
three months. Also after any month with unusual use.

**Where the owner sees it:** in the Supabase dashboard, the organization's **Usage** page
(choose the AMRAP project in the project selector) shows **Database Size** against the 500 MB
quota. The project's **Reports → Database** page has a **Database size** chart with the
largest tables.

**Queries** (dashboard SQL editor):

```sql
-- What the quota counts: every database in the cluster.
select pg_size_pretty(sum(pg_database_size(datname))) as database_size from pg_database;

-- The 15 largest tables with their indexes and TOAST.
select n.nspname || '.' || c.relname as relation,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'm') and n.nspname not in ('pg_catalog', 'information_schema')
order by pg_total_relation_size(c.oid) desc
limit 15;

-- The cron log pruning works: about 2,900 rows at most, none older than 15 days.
select count(*), min(start_time) from cron.job_run_details;
```

**Thresholds:**

| Database size | What to do |
|---|---|
| under 250 MB | nothing |
| 250 MB (half the quota) | find what grew in the largest-tables query and compare it with ADR 0013's projection; write the finding on a GitHub issue |
| 400 MB | act now: prune the relation that grew (a new migration and ADR if it is not a log) |
| `auth.audit_log_entries` over 50 MB | owner action, free: in the dashboard, Authentication, Audit Logs (under Configuration), turn off "Write audit logs to the database"; the logs stay in Supabase's log storage, and rows already written stay until a new ADR decides how to trim them (ADR 0013) |
| `cron.job_run_details` over 3,000 rows or older than 15 days | check `prune_cron_history` in `cron.job` and its runs ([jobs.md](jobs.md#prune_cron_history-daily)) |

Never upgrade the plan or add a payment method to get room (ADR 0005). If the project does go
read-only, delete log rows (cron log, notifications older than 30 days) after `set session
characteristics as transaction read write;` in the SQL editor, `vacuum` the table, and turn
read-only mode off as Supabase describes (docs "Database size", "Disabling read-only mode").

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

5. **Set the app's public key:** `VITE_VAPID_PUBLIC_KEY=<public key>` in
   `app/.env.production.local`, then build and deploy again (see
   [Cloudflare Workers deploy](#cloudflare-workers-deploy)).
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

## Cloudflare Workers deploy

The app is an assets-only Worker named `amrap` on the Workers Free plan, served at
`https://amrap.<account subdomain>.workers.dev` ([ADR 0012](adr/0012-cloudflare-workers-static-assets.md)).
There is no Worker script and no binding: Cloudflare serves the files of `app/dist` and
answers any other path with `index.html` (`notFoundHandling: "single-page-application"`), so
deep links such as `/invite/<token>` load the app. The deploy configuration is
`app/deploy/`: `cloudflare.config.ts` (name, compatibility date, workers.dev, the SPA
setting), `wrangler.config.ts` (assets from `../dist`) and a `package.json` pinning `cf` and
`wrangler`. `cf` reads these files, not a `wrangler.jsonc`; both are beta interfaces.

Never run `cf dev`, `cf build` or `cf deploy` in `app/` itself: there `cf` finds the Vite
config, runs `vite build` and expects the Cloudflare Vite plugin, and its automatic setup may
rewrite `package.json`, `vite.config.ts` and `.gitignore`. Run them only in `app/deploy/`.

### Build environment

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://etzkbwqgjuipihypokjp.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the hosted project's anon key |
| `VITE_VAPID_PUBLIC_KEY` | the public push key; empty until push is on ([Turn on push notifications](#turn-on-push-notifications)) |

All three are public by design (access is controlled by RLS). They live in
`app/.env.production.local`, which `.env.*` in `.gitignore` keeps out of git
(`git check-ignore -v app/.env.production.local` names the rule). `vite build` runs in mode
`production`, and that file wins over `app/.env.local`, so the local stack's values never
reach a production build. Vite inlines the values at build time: changing one needs a new build
and deploy. Without the URL or the anon key the app shows a start-up error page naming the
missing variable (and logs it) instead of a blank page.

Write the file without printing the key (the CLI lists the other keys too; only the anon key
goes into the file). It needs `jq` and a Supabase CLI signed in with `supabase login`; like
every block below it starts from the repository root, so it can be pasted into a fresh
terminal anywhere in the checkout:

```sh
cd "$(git rev-parse --show-toplevel)/app"
key=$(supabase projects api-keys --project-ref etzkbwqgjuipihypokjp -o json 2>/dev/null \
  | jq -r '.[] | select(.name=="anon") | .api_key')
if [ -n "$key" ]; then
  printf 'VITE_SUPABASE_URL=https://etzkbwqgjuipihypokjp.supabase.co\nVITE_SUPABASE_ANON_KEY=%s\nVITE_VAPID_PUBLIC_KEY=\n' \
    "$key" > .env.production.local
else
  echo "no anon key: run supabase login, check jq and the project ref" >&2
fi
unset key
```

Never put the service_role or secret key, the VAPID private key or a Cloudflare token in this
file or anywhere in Cloudflare.

### Deploy

From an up-to-date `main`, after the release's migrations are pushed (a build calls the RPCs of
its own `main`; deploying it before `supabase db push` breaks the screens that use new ones):

Build the app:

```sh
cd "$(git rev-parse --show-toplevel)" && git checkout main && git pull --ff-only
cd app && npm ci && npm run build
grep -q etzkbwqgjuipihypokjp dist/assets/*.js \
  || { echo "build is not for the hosted project: write app/.env.production.local first" >&2; false; }
```

Without `app/.env.production.local` the build silently takes `app/.env.local` and points at
the local stack (`127.0.0.1`); the `grep` says so, and the deploy below refuses such a build.

Deploy it:

```sh
cd "$(git rev-parse --show-toplevel)/app/deploy" && npm ci
cf auth whoami                                  # the owner's account
cf deploy --dry-run                             # builds Build Output, uploads nothing
if grep -q etzkbwqgjuipihypokjp ../dist/assets/*.js; then
  cf deploy --message "<stage> <merge commit>"
else
  echo "not deployed: the build is not for the hosted project (app/.env.production.local)" >&2
fi
```

The global `cf` (Homebrew) hands off to the project-local `cf` that `app/deploy/package.json`
pins, so after `npm ci` every `cf` command run in `app/deploy/` uses that version (`npx cf …`
there is the same). `cf deploy` hands the build to the pinned Wrangler, which copies `app/dist` into
`app/deploy/.cloudflare/output/` (gitignored), then uploads it as a new Worker version, deploys
it to all traffic and prints the URL. `cf` uses its own OAuth login (`cf auth login`); it does
not reuse a Wrangler login.

The first deploy needs the account's workers.dev subdomain. If the account has none, `cf`
cannot create it: register the free subdomain in the dashboard (Workers & Pages, the
workers.dev subdomain setting), then run `cf workers triggers deploy` in `app/deploy/` (running
the `cf deploy` above again should work as well). Stop at
anything that mentions a plan, a price or a payment method: the Free plan needs none.

### Check

Right after the deploy, from anywhere in the checkout:

```sh
cd "$(git rev-parse --show-toplevel)/app"
url=https://amrap.<account subdomain>.workers.dev
curl -sI "$url/" | head -1                        # 200
curl -sI "$url/invite/test" | head -1             # 200: the app shell, not a 404
curl -sI "$url/sw.js" | grep -i cache-control     # public, max-age=0, must-revalidate
curl -sI "$url/manifest.webmanifest" | head -1    # 200
curl -sI "$url/icon-192.png" | head -1            # 200
curl -sI "$url/assets/$(ls dist/assets | grep -m1 '\.js$')" | grep -i content-type   # JavaScript, not text/html
```

Then open the URL at 360 px: the sign-in page loads (no start-up error page), and a wrong
password gets **Napačen e-poštni naslov ali geslo.** from the hosted Auth. The default headers
(`max-age=0, must-revalidate` and an `ETag` on every file) mean `index.html` and `sw.js` are
never served stale, so installed PWAs pick up the new service worker at their next update
check; no `_headers` file is needed.

### Roll back

Every deploy is a Worker version; the files belong to the version, so a rollback restores the
previous app exactly. With `cf` (the pinned one, from `app/deploy/`):

```sh
cd "$(git rev-parse --show-toplevel)/app/deploy" && npm ci
cf workers deployments list --worker amrap         # the first entry serves traffic now
cf workers versions list --worker-id amrap         # recent versions and their messages
cf workers deployments create --worker amrap --strategy percentage \
  --versions '[{"version_id":"<previous version id>","percentage":100}]'
```

Or the dashboard: Workers & Pages, `amrap`, Deployments, the earlier version, Rollback. With
Wrangler (after `wrangler login`, below): `npx wrangler rollback --name amrap` in
`app/deploy/` returns to the version before the latest. A rollback does not undo migrations;
an older app against a newer database is fine as long as the migrations kept the old RPC
signatures.

### Check that usage stays on Free

- Static asset requests are free and unlimited and never invoke a Worker, so the Free plan's
  100,000 requests a day (Worker invocations) does not apply while there is no Worker script.
  A Free account that goes over a limit gets errors (for example 429), never a bill.
- A version holds at most 20,000 files of at most 25 MiB each on Free; the build has under 20
  files, the largest a few hundred kB.
- Monthly, in the dashboard: Workers & Pages shows the account on the Free plan; `amrap`,
  Metrics shows the requests. Never add a payment method, never upgrade to Workers Paid, and
  never add R2, KV, D1, Durable Objects, Queues or another binding to the Worker.

### Fallback: Wrangler

If a `cf` update breaks the beta configuration, deploy the same files with Wrangler: the owner
runs `npx wrangler login` once in `app/deploy/` (Wrangler keeps its own OAuth login), then
writes `app/deploy/wrangler.jsonc`:

```jsonc
{
  "name": "amrap",
  "compatibility_date": "2026-09-21",
  "workers_dev": true,
  "assets": { "directory": "../dist", "not_found_handling": "single-page-application" }
}
```

and runs `npx wrangler deploy` in `app/deploy/` (the pinned 4.152.0). The checks and rollback
above apply unchanged.

### Later: deploy from GitHub Actions (owner step)

Not set up. It needs a Cloudflare API token, which only the owner creates: dashboard, My
Profile, API Tokens, the "Edit Cloudflare Workers" template limited to this account. Store it as
the repository secret `CLOUDFLARE_API_TOKEN`, the account id as `CLOUDFLARE_ACCOUNT_ID`, and
the anon key as `VITE_SUPABASE_ANON_KEY`. A workflow on `main` would then:

1. check out, set up Node from `app/.node-version`;
2. in `app/`: `npm ci` and `npm run build` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   and `VITE_VAPID_PUBLIC_KEY` in the environment;
3. in `app/deploy/`: `npm ci` and `npx cf deploy --message "$GITHUB_SHA"` (`cf` and Wrangler
   both read `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).

Run it only after `supabase db push` for the same merge (the deploy above says why), for
example as a manual `workflow_dispatch` the release checklist triggers.

### Auth URL configuration (dashboard action for the owner)

The remote Supabase project does not read `supabase/config.toml`. After the first deploy, open
the dashboard, Authentication, URL Configuration, set Site URL to the workers.dev URL and add
it to Redirect URLs. When a domain replaces it, change both again.

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
