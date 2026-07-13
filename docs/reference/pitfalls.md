# Pitfalls & Gotchas

Non-obvious behavior that has bitten people in this codebase, and lives nowhere
else. This is NOT the entry point — start at [`CLAUDE.md`](../../CLAUDE.md) for
architecture, commands, and conventions.

---

## Authentication & User Identifiers

The application maintains a strict separation between Auth users and profile records:

- **`session.user.id`** — Supabase Auth UUID. Use this **only** to look up a profile row in the `users` table.
- **`session.userRecord.id`** — Integer primary key of the `users` table. Use this as the foreign key in all other tables (`grant_record.user_id`, `expenses.user_id`, `audit_log.user_id`, etc.).

Never insert the Auth UUID into a column that expects the integer user ID. The two are not interchangeable.

---

## Row Level Security & Query Safety

- **Silent failures** — RLS filters rows at the database level. A query for a resource the user cannot access returns `data: null, error: null`, not an exception. Always null-check returned data before accessing properties.
- **`.single()`** — Returns an error if zero rows are found. Handle the error object gracefully rather than assuming success.
- **Invites are not directly readable/writable by clients** — `anon` has no `invites` table access. Resolve and consume invites via the SECURITY DEFINER RPCs `get_invite_by_token` / `consume_invite` (wrapped in `frontend/src/lib/invites.js`), never a direct `supabase.from('invites')` query.
- **Storage is tenant-scoped by path** — `grant-documents` and `receipts` policies require the object path's 2nd folder segment to be the caller's tenant (`storage_object_tenant_id(name) = current_tenant_id()`). Uploads MUST follow the path convention `attachments/<tenant_id>/<grant_id>/...` and `receipts/<tenant_id>/<grant_id>/<expense_id>/...` or the write is denied.
- **Privilege columns are frozen on self-update** — a trigger blocks a user changing their own `role` / `tenant_id` / `is_active`; grant `tenant_id` is derived server-side. Do not attempt to set these from the client.

---

## File Storage & Compensating Transactions

- **Signed URLs** — All storage buckets are private. Generate short-lived signed URLs (60-second expiration) via `supabase.storage.from(...).createSignedUrl(...)`. Do not expose raw storage paths in the UI.
- **Compensating transactions** — If a file is uploaded to storage but the subsequent database insert fails, the `catch` block must delete the orphaned file. See [GrantAttachments.js](../../frontend/src/components/grant/GrantAttachments.js) or [AddExpenseModal.js](../../frontend/src/components/grant/AddExpenseModal.js) for the reference pattern.

---

## Database Triggers

Do not replicate these in frontend code — database triggers handle them automatically:

- **Status history** — `trg_grant_status_tracking` logs changes to `grant_status_history` whenever `grant_record.status` is updated
- **Spending totals** — `grant_record.total_spent`, `grant_record.remaining_balance`, and `budget_items.amount_spent` are recalculated by triggers on expense and budget item changes
- **Notifications** — rows in the `notifications` table are populated by triggers on status changes, comments, and new submissions

### Keeping `seed.sql` in sync

> [!IMPORTANT]
> Whenever you modify table structures — renaming columns, adding constraints, changing data types — you must update [`supabase/seed.sql`](../../supabase/seed.sql) to match. If you skip this, `npm run db:reset` will fail because the seed inserts will mismatch the schema. Always verify with a clean reset after schema changes.

---

## Adding New Integrations & API Keys

When introducing a new integration (e.g., a new SaaS provider, API-based feature, or external service), you must add its API keys and configuration values to the appropriate runtimes and update the project configuration files.

### Step 1: Identify Runtime Scope
*   **Client-side Only (Vercel/Frontend)**: Keys/endpoints prefixed with `VITE_` (e.g., analytics, monitoring). Exposing these in the browser bundle is safe.
*   **Server-side Only (Supabase Edge Functions)**: Sensitive secrets (e.g., payment, email, database keys). These must **never** be exposed to the client.

### Step 2: Configure All Environments

| Integration Type | Local Dev Environment | Staging / CI Environment | Production Release Environment |
| :--- | :--- | :--- | :--- |
| **Frontend/Client Keys** | Add to `frontend/.env.local` | Set as workflow environment variables in `.github/workflows/ci.yml` (if needed for testing). | Add in Vercel Console: **Project Settings → Environment Variables**. |
| **Backend/Secret Keys** | Add to `supabase/functions/.env` | Set as workflow environment variables or secret overrides in CI (if needed for testing). | Deploy to Supabase Vault via: `npx supabase secrets set --project-ref <ref> KEY="value"` |

### Step 3: Keep Project Templates in Sync
Do not leave configuration changes undocumented. Every new environment variable requires:
1. **Template Updates**: Add the key with placeholder values to `frontend/.env.example` or `supabase/functions/.env.example`.
2. **Setup Script Sync**: If the key is required for default local setup, verify if `npm run setup` needs to generate it or copy it.
3. **Reference Documentation**: Document the purpose, options, and source of the variable in [`environment_variables.md`](environment_variables.md).
