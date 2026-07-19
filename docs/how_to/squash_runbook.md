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

On a project built from these migrations, the diff is exactly one line:

```
drop extension if exists "pg_net"
```

That is expected and benign. No migration creates pg_net; the local shadow DB
installs it by default and remote projects do not have it. The one trigger that
uses it already guards for it being absent.

If you *also* see six `drop policy "Tenant-scoped ..." on "storage"."objects"`
lines, that means the project was **not** built from these migrations — it was
reconciled in place, or predates the squash. The policies exist on both sides;
`db diff` just reports them when the storage schema was not created by the same
run. Confirm directly:

```sql
SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
```

Six rows means you are fine. Rebuilding from scratch makes these lines disappear.

Anything *else* in the diff is real drift — fix it forward with a new migration,
never by hand-editing the baseline.

## Staging: rebuilt from scratch (2026-07-19)

Staging was wiped and rebuilt with `db reset --linked --no-seed`, which is the
real test of the criterion — the two migrations applying to an empty database on
an actual Supabase project rather than a local container. Verified afterwards,
every figure matching a local `db:reset` exactly:

| check | value |
|---|---|
| versions recorded | 2 |
| tables (public) | 24 |
| RLS policies (public) | 80 |
| storage policies | 6 |
| storage buckets | 2 |
| platform_settings rows | 1 |
| auth.users | 0 |
| `anon` privileges on the two sensitive tables | **0** |
| auth.users FKs | 8 — 2 CASCADE, 6 SET NULL |
| `db diff --linked` | one line (`pg_net`, benign) |

Note `db reset --linked` requires `SUPABASE_DB_PASSWORD`; the temporary login
role the CLI mints for read-only commands returns 401 for reset and push. The
password is under Settings → Database, and resetting it is free on a project you
are about to wipe anyway.

### In-place reconciliation (fallback only)

If you ever have a populated project you cannot wipe, the alternative is:
`supabase migration repair --status reverted` for the collapsed versions, then
apply the delta as **raw DDL, not a recorded migration** — since a change folded
into the baseline belongs to a version the project already records, and adding a
new version would re-create the mismatch the repair just cleaned up. Staging was
carried this way briefly before being rebuilt properly. Prefer the rebuild: it is
the only path that actually proves the migrations work from empty.

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
