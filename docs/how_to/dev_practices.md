# Dev Practices

Everyday local-dev operations: schema changes, resetting data, promoting an admin,
and the troubleshooting cookbook. For first-time setup see [Dev Setup](dev_setup.md).

> Use the repo-pinned CLI for every `supabase` command: `npx --prefix frontend supabase …`.
> The `npm run db:*` scripts already do this. A global CLI may be too old to parse `config.toml`.

---

## Schema changes (local-first migrations)

> **Golden rule:** never change schema directly on a cloud/prod database. All schema
> changes are made locally, captured as a migration file, and committed. The **pre-push
> hook** enforces this — it runs `supabase db diff` and blocks a push with uncaptured
> schema changes. Run the same check any time with `npm run db:check`. (Bypass only in
> emergencies: `SKIP_DB_DIFF=1 git push`.)

1. **Change locally.** Edit schema in local Studio (`http://127.0.0.1:54323`), the SQL
   editor, or a DB tool on port `54322`. Verify in the app.
2. **Capture it:** `npx --prefix frontend supabase db diff -f your_migration_name`
   (snake_case, e.g. `add_tax_month_to_users`) → writes `supabase/migrations/<ts>_*.sql`.
3. **Sync `seed.sql` if columns changed** — otherwise `db:reset` fails on the mock inserts.
4. **Validate from scratch:** `npm run db:reset` (re-applies all migrations + seed; also
   regenerates `database.types.ts`). Clean run = good.
5. **Commit** the migration (+ `seed.sql` if touched).

After pulling someone else's migrations, the **post-merge hook** runs `supabase migration up`
automatically (incremental, preserves your data). Run `npm run db:reset` yourself only if you
want a full rebuild.

### The two invariants that cost real debugging time

- **Never edit an already-applied migration.** Prod tracks migrations by **version, not
  content** — an edited file never re-runs, so local and prod diverge silently. Fix mistakes
  with a **new** timestamped migration.
- **`seed.sql` is local/CI only — it never runs in prod.** Data prod needs goes in a
  **migration**, not the seed. Migrations run *before* the seed, so the seed references
  migration rows (e.g. `WHERE slug='tfac'`) rather than re-inserting them. Any overlapping
  seed insert must be idempotent (`ON CONFLICT DO NOTHING`) or `db:reset`/CI fails on a
  duplicate key.

### Migration baseline (squashed)

History was squashed to two baseline files — read these for the current schema, add new
changes on top, **never edit the baseline**:

| File | Contains |
|------|----------|
| `20260630130000_squashed_schema.sql` | Pure schema baseline — tables, functions, triggers, policies. No data rows. |
| `20260630140000_bootstrap_data.sql` | Data prod needs: the `tfac` tenant, `platform_settings` row, `receipts`/`grant-documents` storage buckets. Idempotent (`ON CONFLICT DO NOTHING`). |

To add a row that fresh builds need but an existing env already has, add a new idempotent
migration (`INSERT … ON CONFLICT (id) DO NOTHING`) — it no-ops on prod, supplies the row on
a fresh build, and keeps every environment's migration ledger identical.

> **Platform root is config-driven**, not hardcoded. `tfac` is the root by default, read from
> `platform_settings.platform_root_slug` via `platform_root_slug()` / `is_platform_root_tenant()`.
> Re-point with `UPDATE platform_settings SET platform_root_slug='<slug>' WHERE id=1;` — don't
> edit the helpers. (If you re-point, also update the slug `scripts/promote_admin.js` links against.)

How schema reaches prod: the gated **Deploy to Production** workflow runs `supabase db push`
(see [Production Setup](prod_setup.md)). Never `db push` to a remote by hand. CI replays all
migrations from scratch on every push — keep it green before merging.

---

## Reset test data

- **Full rebuild:** `npm run db:reset` — re-applies migrations + `seed.sql` (default users,
  tenants, grants, budget items, expenses).
- **Expenses only** (keep grants/budgets), in the local SQL editor:
  ```sql
  DELETE FROM receipts;   -- receipt metadata
  DELETE FROM expenses;   -- triggers recompute totals to 0
  ```
  Files in the `receipts` storage bucket need manual deletion via the Storage panel.

---

## Promote a super admin

The user must **register first** (a profile row in `users` must exist), then:

```bash
npm run admin:promote <email-address>
```

This links the profile to the platform-root tenant (`tfac`), sets role `super_admin`, and
grants subscription bypass + cross-tenant read scope. A super admin operates via `/super/tenants`
(not `/admin*`); cross-tenant access is **read-only** SELECT — billing/membership writes stay on
the `service_role` (Stripe) path.

---

## Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| Login succeeds but bounces back to `/login` | `users.user_id` is NULL or ≠ the Auth UUID → `UPDATE users SET user_id = (SELECT id FROM auth.users WHERE email='x') WHERE email='x';` |
| "Invalid login credentials" | Wrong password, no Auth account, or email-confirm required → check Studio → Authentication → Users; disable "Confirm email" for dev |
| `42P17` infinite recursion in RLS | An admin policy has an inline `users` subquery → use the `is_admin()` SECURITY DEFINER helper |
| Query returns `data:null, error:null` | RLS silently denied it → check the user's integer `id` / `tenant_id` against the row |
| Blank white page | Missing env vars → console shows `undefined.supabase.co`; re-create `frontend/.env.local` from `.env.example`, restart dev server |
| Charts empty / 0px | `<ResponsiveContainer>` needs a fixed `height` |
| Upload 400/403 | Bucket missing, or **tenant-path mismatch**: storage is tenant-scoped by path — the **2nd segment is the owning `tenant_id`** (`grant-documents/attachments/<tenant_id>/…`, `receipts/receipts/<tenant_id>/…`), checked via `storage_object_tenant_id()` vs `current_tenant_id()`. An upload 403s if that segment ≠ the user's tenant. (super_admin reads across tenants; writes stay on own tenant.) |
