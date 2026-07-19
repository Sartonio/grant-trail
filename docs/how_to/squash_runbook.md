# How to: deploy after the 2026-07-19 migration squash

`supabase/migrations/` was squashed on 2026-07-19 down to two files:

- `20260630130000_squashed_schema.sql` — the full `public` schema, **including**
  the `auth.users` delete cascade.
- `20260630140000_bootstrap_data.sql` — the config rows the app needs to boot.

Local development needs nothing: `npm run db:reset` builds from the two files.

## The one rule that matters

**A project that already records version `20260630130000` as applied will never
re-execute it.** That is what makes the squash safe for a live database — but it
also means **any schema change folded into the baseline cannot reach that
project**. New changes go in a NEW migration on top; that is what makes them
deployable.

This is not hypothetical. The auth cascade was originally folded into the
baseline, and staging — which already recorded that version — silently kept all
eight FKs at `NO ACTION`. `supabase db diff --linked` is what caught it.

## Fresh project (the normal path from here on)

Both environments are being rebuilt from scratch, so this is all it takes:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push --linked          # applies both files in order
supabase migration list --linked   # expect exactly the two versions, both applied
```

Do **not** apply `seed.sql` to a remote project. It creates accounts with the
hardcoded password `password123` (including a super admin), which on an
internet-reachable host is a live credential. `db push` never runs it — but
`db reset --linked` does unless you pass `--no-seed`. For QA fixtures on a
shared environment, use a separate seed file with generated passwords.

## Verifying

```bash
supabase db diff --linked
```

Expect **no FK or table drop statements**. Two categories of output are known
noise and can be ignored:

- `drop extension if exists "pg_net"` — no migration creates pg_net; the local
  shadow DB installs it by default and remote projects do not have it. The one
  trigger that uses it already guards for it being absent.
- `drop policy "Tenant-scoped ..." on "storage"."objects"` (6 of them) — these
  exist on both sides. `db diff` handles the `storage` schema poorly, which is
  also why those policies are hand-appended at the bottom of the baseline rather
  than captured by the dump. Confirm directly if in doubt:

  ```sql
  SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
  ```

Anything *else* in the diff is real drift — fix it forward with a new migration,
never by hand-editing the baseline.

## What was done to staging (2026-07-19, historical)

Staging was **not** rebuilt from scratch; it was reconciled in place, keeping its
6 auth users and the 6 subscription / 6 billing_customers rows that point at live
Stripe test-mode objects.

1. `supabase migration repair --status reverted` for the 18 collapsed versions
   (`20260630150000` … `20260714011033`), leaving only the two baseline versions
   recorded. Bookkeeping only — no schema SQL ran.
2. The 8 cascade FK `ALTER`s applied as **raw DDL, not a recorded migration** —
   deliberately, since the cascade lives inside `20260630130000`, which staging
   already records. Recording a new version would have re-created the mismatch
   step 1 just cleaned up.

Verified afterwards: all 8 FKs correct (2 CASCADE, 6 SET NULL), all rows intact,
`schema_migrations` at exactly 2 rows, and `db diff --linked` free of FK drops.

Only reach for this in-place procedure if you have a populated project you cannot
wipe. A fresh project should use `db push`.

## What NOT to do

- Do **not** `delete from supabase_migrations.schema_migrations` on a populated
  project — it orphans the schema from its history.
- Do **not** renumber the baseline. Its timestamp is what stops `db push` from
  replaying a schema dump over live data.
- Do **not** edit the baseline to make a schema change (see "the one rule").
- Do **not** re-squash without diffing dumps first. `pg_dump` emits GRANTs but
  never REVOKEs, and Supabase default-grants `anon` on new tables — the last
  squash silently handed `anon` TRUNCATE (which bypasses RLS) on
  `platform_settings` until the explicit REVOKEs were re-added.

## CI

`.github/workflows/ci.yml` has a `migration-replay` job that stashes the PR's
migrations, resets to the base-branch set, then runs `supabase migration up`.
The squash PR rewrites the baseline in place, so that job replays a changed
`20260630130000` against a database built from the old one. It needs a one-time
skip on the squash PR and behaves normally afterwards.
