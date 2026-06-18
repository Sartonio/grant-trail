# AI Context & Development Guidelines

This is the primary reference for AI agents and contributors working in the GrantTrail codebase. Read this before making any changes.

---

## 1. Bootstrapping & Local Environment

Always run commands from the repository root:

| Command | Purpose |
|---------|---------|
| `npm run setup` | Install dependencies and scaffold all local env files |
| `npm run db:start` | Start local Supabase containers, apply migrations, seed test data |
| `npm run dev` | Start the Vite development server |
| _(merge to `main`)_ | Schema + Edge Functions deploy automatically to **staging** via the Supabase GitHub integration; there is no deploy script and no manual `db push` path (the integration is the single source of truth). Production will be a separate repo. |
| `npm run functions:prune -- --project-ref <ref>` | Delete Edge Functions deployed to the project that are no longer declared in `config.toml` (the integration never prunes); `--dry-run` to preview |
| `npm run admin:promote <email>` | Promote a registered user to Super Admin on the remote database |

---

## 2. Database & Migrations

### Schema changes are local-first

Never modify the schema directly on a production or remote environment.

1. Make the change in your local database via Supabase Studio (`http://127.0.0.1:54323`) or raw SQL
2. Generate a migration file: `supabase db diff -f your_migration_name`
3. Commit the file from `supabase/migrations/` to Git

### Keeping `seed.sql` in sync

> [!IMPORTANT]
> Whenever you modify table structures — renaming columns, adding constraints, changing data types — you must update [`supabase/seed.sql`](file:///home/ryan/Documents/grant-trail/supabase/seed.sql) to match. If you skip this, `npm run db:reset` will fail because the seed inserts will mismatch the schema. Always verify with a clean reset after schema changes.

### Trigger-managed side effects

Do not replicate these in frontend code — database triggers handle them automatically:

- **Status history** — `trg_grant_status_tracking` logs changes to `grant_status_history` whenever `grant_record.status` is updated
- **Spending totals** — `grant_record.total_spent`, `grant_record.remaining_balance`, and `budget_items.amount_spent` are recalculated by triggers on expense and budget item changes
- **Notifications** — rows in the `notifications` table are populated by triggers on status changes, comments, and new submissions

---

## 3. Authentication & User Identifiers

The application maintains a strict separation between Auth users and profile records:

- **`session.user.id`** — Supabase Auth UUID. Use this **only** to look up a profile row in the `users` table.
- **`session.userRecord.id`** — Integer primary key of the `users` table. Use this as the foreign key in all other tables (`grant_record.user_id`, `expenses.user_id`, `audit_log.user_id`, etc.).

Never insert the Auth UUID into a column that expects the integer user ID. The two are not interchangeable.

---

## 4. Row Level Security & Query Safety

- **Silent failures** — RLS filters rows at the database level. A query for a resource the user cannot access returns `data: null, error: null`, not an exception. Always null-check returned data before accessing properties.
- **`.single()`** — Returns an error if zero rows are found. Handle the error object gracefully rather than assuming success.

---

## 5. File Storage & Compensating Transactions

- **Signed URLs** — All storage buckets are private. Generate short-lived signed URLs (60-second expiration) via `supabase.storage.from(...).createSignedUrl(...)`. Do not expose raw storage paths in the UI.
- **Compensating transactions** — If a file is uploaded to storage but the subsequent database insert fails, the `catch` block must delete the orphaned file. See [GrantAttachments.js](file:///home/ryan/Documents/grant-trail/frontend/src/components/GrantAttachments.js) or [AddExpenseModal.js](file:///home/ryan/Documents/grant-trail/frontend/src/components/AddExpenseModal.js) for the reference pattern.

---

## 6. Frontend Styling

- All design tokens (colors, spacing, shadows, typography) are declared as CSS custom properties in [`variables.css`](file:///home/ryan/Documents/grant-trail/frontend/src/styles/variables.css).
- Do not write raw hex values, rgb literals, or hardcoded pixel sizes in component stylesheets. Use `var(--color-primary)` not `#063F1E`.
- Do not introduce Tailwind CSS.

---

## 7. React Patterns

- **`useCallback` + `useEffect`** — Wrap async data-fetching functions in `useCallback` and pass them as `useEffect` dependencies when they also need to be triggered manually (e.g. on form submit). This prevents render loops.
- **Set lookups** — When checking membership in a list inside a `.map()`, convert the array to a `Set` first. Avoid `.find()` or `.includes()` in inner loops.
- **Batching with `.in()`** — Avoid N+1 queries. Collect parent IDs first, then fetch related records in a single `.in('parent_id', ids)` call.

---

## 8. Adding New Integrations & API Keys

When introducing a new integration (e.g., a new SaaS provider, API-based feature, or external service), you must add its API keys and configuration values to the appropriate runtimes and update the project configuration files.

### Step 1: Identify Runtime Scope
*   **Client-side Only (Vercel/Frontend)**: Keys/endpoints prefixed with `VITE_` (e.g., analytics, monitoring). Exposing these in the browser bundle is safe.
*   **Server-side Only (Supabase Edge Functions)**: Sensitive secrets (e.g., payment, email, database keys). These must **never** be exposed to the client.

### Step 2: Configure All Environments

| Integration Type | Local Dev Environment | Staging / CI Environment | Production Release Environment |
| :--- | :--- | :--- | :--- |
| **Frontend/Client Keys** | Add to `frontend/.env.local` | Set as workflow environment variables in `.github/workflows/ci.yml` (if needed for testing). | Add in Vercel Console: **Project Settings → Environment Variables**. |
| **Backend/Secret Keys** | Add to `supabase/.env` | Set as workflow environment variables or secret overrides in CI (if needed for testing). | Deploy to Supabase Vault via: `npx supabase secrets set --project-ref <ref> KEY="value"` |

### Step 3: Keep Project Templates in Sync
Do not leave configuration changes undocumented. Every new environment variable requires:
1. **Template Updates**: Add the key with placeholder values to `frontend/.env.example` or `supabase/.env.example`.
2. **Setup Script Sync**: If the key is required for default local setup, verify if `npm run setup` needs to generate it or copy it.
3. **Reference Documentation**: Document the purpose, options, and source of the variable in [`docs/reference/environment_variables.md`](file:///home/ryan/Documents/grant-trail/docs/reference/environment_variables.md).
