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
> - Migrations run **before** the seed during `supabase db reset`, so the seed should **rely on** rows a migration already created rather than re-inserting them. This is how the `tfac` tenant works: created by the `bootstrap_initial_tenant` migration, and `seed.sql` does not re-declare it — it only references it via `WHERE slug = 'tfac'` and adds the extra demo tenants. If you ever do need the seed to insert a row a migration also creates, make that seed insert idempotent (`ON CONFLICT ... DO NOTHING`) or `supabase db reset`/CI will fail with a duplicate-key error.

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
> Because merge = deploy, **a bad migration merged to `main` goes straight to the live (staging) environment.** (There is no production yet — see [Deployment Guide](deployment.md); production will be a separate repo.) On the current (Free) plan there are no preview databases, so there is no per-PR dry run. Your safety net is CI (`supabase start` replays all migrations from scratch on every push) — keep CI green before merging. The integration cannot replay an edited migration, so never edit an already-applied file; always add a new timestamped one.

> [!NOTE]
> Secrets are managed separately — newly declared functions will deploy but 500 at runtime until their secrets exist. Set them with `npm run deploy:secrets`. There is no automatic pre-migration backup, so enable **Point-in-Time Recovery** on the production project before it carries live traffic.

The legacy `npm run db:deploy` and `npm run db:migrate` scripts have been removed. The Supabase GitHub integration is the **single source of truth** for schema deploys — migrations apply on merge, and there is no manual `supabase db push` path. Do not run `db push` against the remote by hand; it drifts the environment from what the integration tracks as deployed.

---

## Migration Layout & Squashing the Baseline

The migration history is intentionally split:

| File | Contains |
|------|----------|
| `…_initial_schema.sql` | A **pure schema baseline** — tables, functions, triggers, policies. Generated from a schema dump, so it holds **no data rows**. |
| `…_bootstrap_initial_tenant.sql` | The `tfac` tenant + its settings (data prod needs). |
| `…_restore_platform_and_storage_data.sql` | The single `platform_settings` row and the `receipts` / `grant-documents` storage buckets. |

All bootstrap **data** lives in migrations (never in `seed.sql`, which is local/CI only), and the schema baseline stays data-free.

### If you squash the migration history

Squashing (regenerating `initial_schema` from a fresh dump to collapse history) is allowed, but two traps cost real debugging time here — avoid them:

> [!WARNING]
> **`supabase db dump` exports schema only — it silently drops every `INSERT` (data row).** A squash generated from a dump will lose rows the old history created (here: the `platform_settings` row and the storage buckets), which then breaks `supabase db reset`/CI and runtime uploads. After squashing, **re-add any data rows** the old migrations created — either in a bootstrap data migration or restored explicitly.

> [!WARNING]
> **A squash rewrites an already-applied migration's content.** Production tracks migrations by **version, not content**, so it will **not** re-run the rewritten baseline — meaning the squashed file must faithfully reproduce production's *actual* end state. The only way to be sure is to diff a from-scratch repo build against production's schema.

### Adding data that an existing environment already has

When you need a row on **fresh builds** that **production already has** (e.g. the rows a squash dropped), do **not** edit the already-applied migration to add it. Instead add a **new, forward-only, idempotent migration**:

```sql
INSERT INTO platform_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
```

On production the row already exists, so the insert is a no-op — but the migration still records its version in the ledger, keeping every environment's history identical. On a fresh build it supplies the missing row. This is exactly what `restore_platform_and_storage_data` does.
