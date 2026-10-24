---
name: release-checklist
description: Use after an AMRAP stage PR is merged to main, to release it to the hosted project - confirm the merge and CI, push migrations from main, verify migrations, cron and pg_net, deploy the send-push edge function when it changed, check the Cloudflare Pages deploy, smoke-test both roles at phone width, and record the release. Not for feature branches.
---

# Release checklist

The post-merge release, repeated after every stage (Stages 1-3 so far). Hosted project:
`etzkbwqgjuipihypokjp`. The commands and dashboard steps behind each item are in
`docs/runbook.md`; this list is the order and the checks.

Rules:

- Only from an up-to-date `main`, after the PR is merged. Never from a feature branch.
- The Supabase CLI stays at the version CI pins (`.github/workflows/ci.yml`); do not upgrade it.
- Secrets never go on the command line or into the repo (runbook "Turn on push notifications"
  uses a temporary env file outside the repo).
- `supabase db push` and `supabase functions deploy` change the hosted project: run them only
  when the release has been approved (the Workflow in `IMPLEMENTATION_PLAN.md` records who
  approves).

## 1. Confirm the merge and CI

```sh
git fetch origin
git checkout main && git pull --ff-only
gh pr view <number> --json state,mergeCommit --jq '.state + " " + .mergeCommit.oid'
gh run list --branch main --limit 3
```

The PR is `MERGED`, `HEAD` is its merge commit (or later), and the latest `main` CI run is green.
Note the previous release's merge commit (from the last release record) as `<previous>`. On
the first run of this skill there is no record yet: use the previous stage's merge commit
(Stage 3: `e305f91`).

## 2. See what the release contains

```sh
git diff --name-only <previous>..HEAD -- supabase/migrations supabase/functions app
```

This decides steps 3-5: migrations to push, whether `send-push` changed, what to smoke-test.

## 3. Push the migrations

```sh
supabase link --project-ref etzkbwqgjuipihypokjp   # once per machine
supabase migration list --linked                    # Local vs Remote: the pending ones
supabase db push                                    # lists them again and asks to confirm
```

The pending list must equal the new files from step 2. Anything else (a remote-only version,
an old file listed as pending) means stop and investigate; do not use `--include-all` or
`migration repair` without understanding why.

## 4. Verify on the hosted database

In the dashboard SQL editor:

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 5;
select jobname, schedule, active from cron.job order by jobname;
select extnamespace::regnamespace from pg_extension where extname = 'pg_net';
```

- The newest versions are this release's migrations.
- `cron.job` has `charge_due_appointments` and `send_cutoff_reminders` (`*/15 * * * *`) and
  `materialize_recurring` (`0 2 * * *`), all active, plus any job the release added
  (`docs/jobs.md`).
- pg_net is in `extensions`.
- Any table, function or trigger the release added exists (the migration's entry in
  `docs/schema.md` / `docs/rpcs.md` lists them).

## 5. Deploy the edge function (only when `supabase/functions/` changed)

```sh
supabase functions deploy send-push --no-verify-jwt --project-ref etzkbwqgjuipihypokjp
curl -s -X POST https://etzkbwqgjuipihypokjp.supabase.co/functions/v1/send-push -d '{}'
```

The curl answers `{"error":"unauthorized"}` (the function's own 401). Any other 401 body is the
gateway: see the `apikey` note in runbook "Turn on push notifications". New function secrets,
if the release needs any, are set before the deploy (runbook).

## 6. Check the Cloudflare Pages deploy

Cloudflare dashboard, the Pages project, Deployments: the production deployment for the merge
commit has finished successfully. Then open the production URL on a phone (or at 360 px):

- the app loads (no start-up error page);
- a deep link such as `/invite/test` loads the app, not a 404;
- after one reload the new service worker is active (Chrome DevTools, Application, Service
  workers, or simply: the change from this release is visible).

If an environment variable changed in the release (`VITE_*`), it is set for Production and
Preview and a new deployment was triggered (Vite inlines them at build time).

## 7. Smoke-test both roles

On a phone (or Chrome at 360 × 800) against production, with a test customer and the trainer:

1. Customer: sign in; **Domov** shows the balance; **Koledar**, next week, »Rezerviraj« a free
   slot; on **Domov** »Odpovej«, »Odpovej termin« (before the cutoff, free).
2. Trainer: the booking and the cancel arrived as notifications (when push is on); **Stranke**,
   the test customer, »Dodaj kredite« `1` with the note "release smoke", then »Popravi stanje«
   `-1` with the same note. The customer got two notifications; the balance is back where it was.
3. Anything the release changed, checked on the screen it changed.

## 8. Record the release

A comment on the stage PR (or its owner-actions issue):

```text
Release <stage>, <date>
- merge commit: <sha>
- migrations pushed: <files> (verified: versions, cron.job, pg_net)
- send-push deployed: yes/no (<why>)
- Pages: <deployment id or URL>, deep link ok
- smoke test: customer book/cancel ok, trainer +1/-1 ok, notifications ok/not checked
- notes: <anything odd>
```

This record is the `<previous>` for the next release.
