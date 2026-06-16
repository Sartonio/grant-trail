# Making Database Schema Changes

To prevent database drift, merge conflicts, and corruption of production systems, GrantTrail uses a strict **local-first database migration workflow** driven by the Supabase CLI.

---

## The Golden Rule
> [!WARNING]
> **NEVER** modify database schemas directly on production or cloud environments. All schema updates must be created locally, captured in version-controlled migration files, and committed to Git.

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
