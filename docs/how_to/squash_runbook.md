# How to: retire squashed migrations on a deployed project

The migrations folder was squashed on 2026-07-19: `20260630130000_squashed_schema.sql`
absorbed the 19 migrations that had accumulated on top of it, and
`20260630140000_bootstrap_data.sql` still carries the config rows.

Local development needs nothing — `npm run db:reset` just builds from the two
files. **Staging and production do need one manual step**, described below.

## Why a step is needed at all

`supabase db push` decides what to run by comparing the local `migrations/`
folder against the `supabase_migrations.schema_migrations` table on the remote.
Staging and production each have **20 versions recorded**. After the squash the
folder has **2**. The 18 versions that no longer exist as files are reported as
remote-only, and `supabase migration list` shows a mismatch until you reconcile.

Two things keep this from being dangerous:

1. **The baseline kept its original timestamp** (`20260630130000`). Both remotes
   already record that version as applied, so `db push` will **not** re-execute
   the rewritten baseline against a populated database. Same for
   `20260630140000_bootstrap_data.sql`. This was a deliberate choice — a new
   timestamp would have made `db push --include-all` try to replay a full schema
   dump over live data.
2. **The squash is schema-equivalent.** A `supabase db dump --local --schema public`
   of the 20-migration history and of the squashed baseline are byte-for-byte
   identical (verified 2026-07-19, after adding the two `REVOKE`s the dump could
   not express — see the ACL note at the bottom of the baseline). The remotes are
   already in the state the baseline produces; nothing needs to run.

So the fix is bookkeeping only: tell each remote those 18 versions are retired.

## The step

Do staging first, verify, then production.

```bash
# 1. Point the CLI at the project
supabase link --project-ref "$SUPABASE_PROJECT_REF"

# 2. See the mismatch (the 18 should show as remote-only)
supabase migration list --linked

# 3. Retire the collapsed versions. These are bookkeeping updates against
#    supabase_migrations.schema_migrations -- they execute no schema SQL.
for v in 20260630150000 20260630191700 20260630192000 20260701090000 \
         20260701091000 20260701100000 20260703120000 20260704011516 \
         20260706044339 20260712230543 20260713010000 20260713012634 \
         20260713013000 20260713020000 20260713040000 20260713202039 \
         20260713210000 20260714011033 20260719120000; do
  supabase migration repair --status reverted "$v" --linked
done

# 4. Confirm local and remote now agree: only the two baseline versions,
#    both applied, nothing pending.
supabase migration list --linked
```

Note `20260719120000` (the auth-cascade migration) is in that list. It was
committed separately and then folded into the baseline in the same PR, so it
only needs repairing on a remote that had already deployed it.

**Do not** run `db push --include-all` before step 3. With the 18 versions still
recorded as applied and no matching files, push has nothing to do — but once you
start repairing, finish the loop before pushing anything.

## Verifying afterwards

```bash
supabase db diff --linked      # expect: "No schema changes found"
```

If that reports a diff, **stop and investigate** — do not hand-apply it. A diff
here means the remote drifted from the migration history at some earlier point,
which the squash has now made visible; fix it with a new forward migration.

## What NOT to do

- Do **not** `delete from supabase_migrations.schema_migrations`. The reset flow
  in `prod_setup.md` is for reusing an empty project and will orphan a populated
  one.
- Do **not** renumber the baseline. Its timestamp is what stops `db push` from
  replaying a schema dump over live data.
- Do **not** edit the baseline to make a schema change. It is a generated dump;
  add a new migration on top, as before.

## CI

`.github/workflows/ci.yml` has a `migration-replay` job that stashes the PR's
migrations, resets to the base-branch set, then runs `supabase migration up`.
The squash PR changes the baseline **in place**, so that job replays a rewritten
`20260630130000` against a database already built from the old one. Expect it to
need a one-time skip on the squash PR; it behaves normally on every PR after.
