---
name: new-migration
description: Use when changing the AMRAP database - adding or altering a table, column, index, RLS policy, view, RPC or job function under supabase/migrations. Covers the repeatable procedure - timestamped migration via the Supabase CLI, failing pgTAP test first, reset and test, docs and diagram updates, regenerated types, one commit.
---

# New migration

The procedure every schema or RPC change follows. It exists because the docs 1:1 rule
(`docs/harness.md`) and TDD make each migration touch the same set of files every time.

## 1. Create the file

```sh
supabase migration new <snake_case_name>
```

This creates `supabase/migrations/<timestamp>_<name>.sql`. Never hand-write the timestamp and
never edit a migration that is already on `main` (it has been or will be pushed to the remote);
write a new one instead. Comment-only edits are the exception (SQL statements byte-identical). Unmerged migrations on the current branch may still be edited.

Conventions inside the file (see the existing migrations):

- Schema-qualify everything (`public.`, `extensions.` for pgcrypto, `auth.uid()`).
- RPCs: `language plpgsql security definer set search_path = ''`, an explicit role check
  with `public.is_trainer()` / `public.current_customer_id()`, errors as
  `raise exception 'AMRAP_<CODE>: detail' using errcode = 'P0001'`.
- Grants: new functions are executable by nobody (default privileges). Every user-facing RPC
  needs `grant execute on function public.<fn>(<arg types>) to authenticated, service_role;`
  (also `revoke ... from public, anon` for intent). Cron-only functions get no grant to
  `authenticated`/`anon`. New tables get RLS enabled plus policies; the table grants baseline
  comes from default privileges.

## 2. Write the failing test first

Add or extend `supabase/tests/0NN_<area>.sql` (pgTAP; conventions in `docs/harness.md`
"Testing"): `begin; select plan(N); ... select * from finish(); rollback;`, fixtures as the
superuser, `tests.authenticate_as(...)` to switch roles, expectations derived from the
inserted data (never hardcoded totals). Assert RPC errors by token:
`throws_matching(sql, '^AMRAP_<CODE>:', description)`.

Run it and keep the RED output for the task report:

```sh
supabase test db
```

## 3. Implement, reset, test, lint

```sh
supabase db reset     # re-applies all migrations and seeds
supabase test db      # must be all green, no notices
supabase db lint      # must report no schema errors
```

Iterate on the migration until green. Every new error token gets at least one test.

## 4. Docs and diagram, same commit

| Change | Update |
|---|---|
| Any new migration file | `docs/schema.md` "Migrations" table (one row per file) |
| Tables, columns, indexes, RLS, views, grants | `docs/schema.md` + `docs/architecture/data-model.md` |
| RPCs | `docs/rpcs.md` (signature, who may call, rules, error tokens, side effects; error token table) + the affected sequence/state diagram in `docs/architecture/` |
| Job functions | `docs/jobs.md` + `docs/architecture/charging-sequence.md` or system context |
| New test file | `docs/harness.md` "Testing" table |
| A decision that changes an ADR | a new ADR (never edit an accepted one's decision) |

## 5. Regenerate types and commit

```sh
supabase gen types typescript --local > app/src/lib/database.types.ts
```

Commit the migration, tests, docs, diagram and `database.types.ts` together; the message
explains why. Stage explicit paths (never `supabase/.temp/` or `.superpowers/`). Never
`supabase db push` from a feature branch (`docs/runbook.md`).
