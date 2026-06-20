# RLS Policy Audit

Systematic audit of Row-Level Security across all 20 application tables, tracking
issue #6. Generated against the schema in
`supabase/migrations/20260616000000_initial_schema.sql` and verified against a
live local database.

**Result:** RLS is **enabled on every table**. The per-operation policy coverage
below shows that operations without an explicit policy are, in nearly all cases,
*intentionally* absent — append-only tables, soft-delete patterns, or tables
written only by the backend. Backend writes use the Supabase `service_role`,
which has `BYPASSRLS`, so backend-managed tables need no write policy for the
service to function.

## Subscription gating

Grantee **write** policies (INSERT/UPDATE) on `grant_record`, `expenses`,
`budget_items`, `receipts`, and `grant_attachments` are gated on
`has_basic_membership()` — see
`supabase/migrations/20260617150000_subscription_gating_rls.sql` and issue #10.
This enforces, at the database layer, the subscription requirement that was
previously only checked in the React router.

## Coverage matrix

`✓` = explicit policy present, `—` = no policy (see disposition).
`svc` = writes restricted to `service_role` (BYPASSRLS) via an `ALL` policy.

| Table | RLS | SELECT | INSERT | UPDATE | DELETE | Disposition |
|-------|-----|--------|--------|--------|--------|-------------|
| tenants | ✓ | ✓ | svc | svc | svc | Super-admin `ALL`; authenticated read names + own tenant. OK |
| tenant_settings | ✓ | ✓ | ✓ | ✓ | — | Settings rows are never deleted. Intentional |
| platform_settings | ✓ | ✓ | — | ✓ | — | Single fixed row (id=1), bootstrapped; super-admin updates. Intentional |
| invites | ✓ | ✓ | ✓ | ✓ | — | Admin own-tenant read only; token reads/consumes go via SECURITY DEFINER RPCs (anon has no table access). Invites expire/consume, not deleted. Intentional |
| users | ✓ | ✓ | ✓ | ✓ | — | Soft-delete via `is_active`; no hard delete. Intentional |
| grant_record | ✓ | ✓ | ✓ | ✓ | **—** | **No delete policy → nobody can delete grants via the API.** See findings |
| budget_items | ✓ | ✓ | ✓ | ✓ | ✓ | Full CRUD for grant owners + admins. OK |
| expenses | ✓ | ✓ | ✓ | ✓ | ✓ | Full CRUD for grant owners + admins. OK |
| receipts | ✓ | ✓ | ✓ | — | **—** | Immutable once uploaded; no delete. See findings |
| grant_attachments | ✓ | ✓ | ✓ | — | ✓ | Attachments are add/remove, not edited. Intentional |
| grant_status_history | ✓ | ✓ | ✓ | — | — | Append-only history (INSERT via system). Intentional |
| audit_log | ✓ | ✓ | — | — | — | Append-only; rows written by SECURITY DEFINER triggers. Intentional |
| grant_comments | ✓ | ✓ | ✓ | — | **—** | No edit/delete of comments. See findings |
| notifications | ✓ | ✓ | ✓ | ✓ | ✓ | Full lifecycle (own rows). OK |
| billing_customers | ✓ | ✓ | svc | svc | svc | Read own; `service_role` manages. OK |
| billing_webhook_events | ✓ | svc | svc | svc | svc | Internal table; `service_role` only. Intentional |
| subscriptions | ✓ | ✓ | svc | svc | svc | Read own; `service_role` manages. OK |
| user_memberships | ✓ | ✓ | svc | svc | svc | Read own; `service_role` + admin `ALL`. OK |
| feature_entitlements | ✓ | ✓ | svc | svc | svc | Read own; set by backend (`service_role`). Intentional |
| system_logs | ✓ | ✓ | svc | svc | svc | Super-admin read; written by backend/triggers. Intentional |

## Deliberate broad reads (reviewed, intentional)

- `tenants` — "Authenticated users can read tenant names": any authenticated user
  can read tenant `name`/`slug` (needed for the tenant picker on signup).
- `platform_settings` — "Anyone can read platform settings": `USING (true)`,
  product IDs / public config only (no secrets).

These are intentional cross-/pre-auth reads and expose no tenant-private rows.

## Security hardening (WS7.1 — `2026061912xx`–`2026061917xx`)

Six forward migrations closed the gaps found in [rls-audit.md](../roadmap/rls-audit.md).
Cross-reference that doc for the full per-finding analysis; the summary here:

- **Invites are no longer world-readable (D7).** The old `"Anyone can read invites
  by token"` (`USING (true)`) policy is **dropped** and `anon`'s table/sequence
  privileges are **revoked**. Token reads now flow through the SECURITY DEFINER
  `get_invite_by_token(p_token text)` (anon + authenticated EXECUTE; returns the
  one matching invite). Consumption flows through `consume_invite(p_token text,
  p_user_id uuid)` — token-scoped, idempotent (`used_at IS NULL` only), enforces
  `p_user_id = auth.uid()`, authenticated only. The admin own-tenant SELECT and
  the consume-update policies are unchanged. (`20260619140000`, `20260619170000`)
- **Storage objects are tenant-scoped by path (D5).** The `grant-documents` and
  `receipts` bucket policies previously only checked `auth.uid() IS NOT NULL`.
  They now require `storage_object_tenant_id(name) = current_tenant_id()` — the
  2nd path segment is the owning `tenant_id` (`grant-documents` =
  `attachments/<tenant_id>/<grant_id>/<file>`; `receipts` =
  `receipts/<tenant_id>/<grant_id>/<expense_id>/<file>`) for read/insert/delete.
  `super_admin` keeps tenant-agnostic **read** (`OR is_super_admin()`); writes
  stay on the tenant path. (`20260619150000`)
- **super_admin read-only ops visibility (D4).** Additive, **SELECT-only**
  policies (`OR is_super_admin()`) were added to `subscriptions`,
  `user_memberships`, `billing_customers`, `notifications`, and `grant_comments`
  so platform-root can inspect a tenant's billing/membership/notifications. No
  write access is granted. (`20260619160000`)
- **Privilege-escalation fixes.** A `BEFORE UPDATE` guard trigger on `users`
  (`enforce_user_self_update_guard`) freezes `role`, `tenant_id`, and `is_active`
  for self-service updates (service_role / `is_admin()` / `is_super_admin()`
  exempt), closing self-promotion to super_admin and tenant-hopping. Grant /
  child-row INSERT triggers (`set_grant_tenant_id`, `set_tenant_from_grant`) now
  derive `tenant_id` **authoritatively** from the owning user / parent grant,
  ignoring any client-supplied value, closing cross-tenant grant inserts.
  (`20260619120000`)

## Findings (reviewed — kept immutable by decision)

These tables have no DELETE (and, for comments, no UPDATE) policy, so the
operation is simply not possible via the API. This was reviewed and **kept as-is
intentionally** — these records are immutable by design:

1. **`grant_record` — no DELETE.** Grants are permanent records; no role,
   including admins, deletes them through the API.
2. **`receipts` — no DELETE.** Receipts are immutable once uploaded.
3. **`grant_comments` — no UPDATE/DELETE.** Comments are append-only.

If product requirements change (e.g. admins must remove erroneous grants), add a
scoped DELETE policy in a forward migration at that point.

## Tenant isolation

All tenant-scoped SELECT policies constrain rows with `tenant_id =
current_tenant_id()` or self-ownership (`auth.uid()`), and `current_tenant_id()`
derives the tenant from the caller's own `users` row. Super-admin cross-tenant
visibility is provided by explicit `is_super_admin()` branches. No policy was
found that leaks another tenant's private rows to a normal user.
