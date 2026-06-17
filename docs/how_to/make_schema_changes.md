# Making Database Schema Changes

To prevent database drift, merge conflicts, and corruption of production systems, GrantTrail uses a strict **local-first database migration workflow** driven by the Supabase CLI.

---

## The Golden Rule
> [!WARNING]
> **NEVER** modify database schemas directly on production or cloud environments. All schema updates must be created locally, captured in version-controlled migration files, and committed to Git.

---

## Enforcement: the pre-push hook

`npm run setup` installs a git **pre-push hook** that runs `supabase db diff` before every push. If your local database has schema changes that aren't captured in a migration file, the push is **blocked** with the exact missing DDL and instructions to generate the migration. This is the automated guard behind the Golden Rule.

- Run the same check anytime with `npm run db:check`.
- The hook needs Docker running and the local DB started (`npm run db:start`). If it can't reach them, it warns and lets the push through — CI rebuilds the database from migrations as a backstop.
- Already cloned before this hook existed? Run `npm run hooks:install` once.
- To bypass intentionally (rare): `git push --no-verify` or `SKIP_DB_DIFF=1 git push`.

---

## Step-by-Step Schema Update Workflow

Follow this procedure when modifying tables, adding columns, or updating triggers/policies:

### Step 1: Make Changes Locally
Ensure your local Supabase database is running (`npm run db:start`). Open your local Supabase Studio interface at:
`http://127.0.0.1:54323`

You can perform schema changes using:
- The Table Editor in the local Supabase Studio.
- The SQL Editor inside local Supabase Studio to run DDL scripts.
- Connecting a database tool (e.g., DBeaver or pgAdmin) to your local Postgres port (`54322`).

Verify the changes work as expected in your local frontend application.

### Step 2: Auto-Generate the Migration File
Once you have tested and verified your database changes locally, auto-generate a SQL migration file using the CLI:

```bash
supabase db diff -f your_migration_name
```

*Replace `your_migration_name` with a descriptive snake_case name (e.g., `add_tax_month_to_users`).*

This command automatically generates a file inside `supabase/migrations/` named `<timestamp>_your_migration_name.sql` containing the exact SQL DDL statements needed to replicate your changes.

### Step 3: Synchronize `seed.sql` (If Applicable)
If your schema change affects table columns (adding, renaming, deleting, or changing data types):
> [!IMPORTANT]
> **You MUST update [supabase/seed.sql](../../supabase/seed.sql) to align with your new schema.**
> If you skip this, `supabase db reset` (which developers run to sync changes) will fail because the mock data insert statements in `seed.sql` will mismatch the new schema definitions.

> [!WARNING]
> **`seed.sql` is local/CI only — it never runs in production.** The Supabase GitHub integration ignores seed files (see [How Changes Reach Production](#how-changes-reach-production)). So:
> - Data that production **needs** (e.g. the bootstrap tenant) belongs in a **migration**, not in `seed.sql`.
> - If a migration creates a row that `seed.sql` also inserts, the seed insert **must** be idempotent (`ON CONFLICT ... DO NOTHING`) or `supabase db reset`/CI will fail with a duplicate-key error. This is exactly how the `tfac` tenant is handled: created by `bootstrap_initial_tenant` migration, and the seed's `tfac` insert no-ops on top of it.

### Step 4: Validate the Migration
Verify that your migrations and seed data apply successfully from scratch:

```bash
supabase db reset
```

This command will:
1. Re-create your local database.
2. Apply all SQL files in `supabase/migrations/` sequentially.
3. Re-run `supabase/seed.sql` to populate sample data.

If this command completes without errors, your database migrations are clean and ready.

### Step 5: Commit to Git
Commit the generated migration file and the updated `seed.sql` file to your Git branch:

```bash
git add supabase/migrations/ supabase/seed.sql
git commit -m "db: add tax_month to users table"
```

---

## When You Pull Changes from Others
When another developer commits schema changes and you pull them down, synchronize your local database by running:

```bash
supabase db reset
```

---

## How Changes Reach Production

There is **no manual deploy step** for the database. Production Supabase is connected to this repo through the **Supabase GitHub integration** ("Deploy to production" enabled, production branch `main`). On merge to `main`, the integration automatically:

- Applies any **new migrations** under `supabase/migrations/` (only the pending ones; it never re-runs an applied migration)
- Deploys the **Edge Functions declared in `supabase/config.toml`**
- Deploys **storage buckets** created by the migrations

It does **not** run `seed.sql`, set Edge Function secrets, or touch Auth/API config.

> [!IMPORTANT]
> Because merge = deploy, **a bad migration merged to `main` goes straight to production.** On the current (Free) plan there are no preview databases, so there is no per-PR dry run. Your safety net is CI (`supabase start` replays all migrations from scratch on every push) — keep CI green before merging. The integration cannot replay an edited migration, so never edit an already-applied file; always add a new timestamped one.

> [!NOTE]
> Secrets are managed separately — newly declared functions will deploy but 500 at runtime until their secrets exist. Set them with `npm run deploy:secrets`. There is no automatic pre-migration backup, so enable **Point-in-Time Recovery** on the production project before it carries live traffic.

The legacy `npm run db:deploy` script has been removed. `npm run db:migrate` (`supabase db push --linked`) remains only as a manual escape hatch; the integration is the normal path.
