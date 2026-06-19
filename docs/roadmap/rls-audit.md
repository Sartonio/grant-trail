# RLS Adversarial Audit (WS7.1)

Date: 2026-06-19
Scope: every RLS-protected table defined in `supabase/migrations`.
Method: adversarial proof tests run against a fresh local Supabase stack
(`npm run db:reset`), simulating authenticated attackers exactly as PostgREST
does — `SET LOCAL ROLE authenticated` plus a `request.jwt.claims` GUC carrying
the attacker's `auth.uid()`. Tests live in
`supabase/tests/rls-adversarial.test.sh` (14 cases) and
`supabase/tests/platform-root-config.test.sh` (6 cases).

## The model under test

All 21 public tables have RLS enabled. Tenant isolation pivots on:

```sql
current_tenant_id() := SELECT tenant_id FROM users WHERE user_id = auth.uid();
```

Read/write policies are of the form `tenant_id = current_tenant_id() AND …`, with
`is_admin()` (tenant-scoped) and `is_super_admin()` (global, platform root)
escalation paths. Role values are constrained to `admin | grantee | super_admin`
by `users_role_check`.

## Findings

Three GENUINE gaps were found and fixed. Read isolation across tenants was
sound; the gaps were all on the write/escalation side.

### GAP 1 — Grantee self-escalation to super_admin / admin (CRITICAL)

The policy `Users can update their own user record` had
`USING (auth.uid() = user_id)` and **no `WITH CHECK`**. Postgres then reuses the
`USING` expression as the check, which only pins `user_id` — every other column
is freely writable by the row's owner. Proven exploit:

```sql
-- as a grantee, against their own row:
UPDATE users SET role = 'super_admin' WHERE user_id = auth.uid();  -- succeeded
```

Because `is_super_admin()` is **global** (no tenant scoping), this immediately
granted the attacker full cross-tenant read/write over **every** tenant — total
platform compromise. The same hole allowed self-promotion to `admin` on a managed
tenant (`enforce_self_service_role` only blocks `admin` on *self_service*
tenants, and nothing blocked `super_admin`).

### GAP 2 — Grantee tenant hop (CRITICAL)

The same missing `WITH CHECK` let a grantee rewrite their own `tenant_id`:

```sql
UPDATE users SET tenant_id = 1 WHERE user_id = auth.uid();  -- succeeded
```

After the hop, `current_tenant_id()` returns the victim tenant, so the attacker
inherits read/write over that tenant's grants, budgets, expenses, etc.

### GAP 3 — Cross-tenant write via forged tenant_id (data poisoning)

`grant_record`'s INSERT policy checks ownership + membership but never
`tenant_id`, and `set_grant_tenant_id()` only derived `tenant_id` when the client
passed `NULL`. A grantee could therefore INSERT a grant carrying another tenant's
`tenant_id`:

```sql
INSERT INTO grant_record (tenant_id, user_id, grant_name, grant_amount)
VALUES (<other_tenant>, <my_user_id>, 'POISON', 100);  -- row landed in victim tenant
```

The attacker cannot read the row back (SELECT is tenant-scoped), but it lands in
the victim tenant's table and fires that tenant's audit/notification triggers —
integrity/poisoning, not a read leak. The same NULL-only pattern affected the
child tables that derive tenant from the parent grant via `set_tenant_from_grant()`.

### What held up (no gap)

- Cross-tenant **reads** by a grantee or admin: 0 rows in all probed tables
  (`grant_record`, `users`, `budget_items`, `expenses`).
- Cross-tenant **writes** by a tenant admin (`UPDATE … WHERE tenant_id = other`):
  0 rows affected.
- `super_admin` cross-tenant access is intentional (platform root) and is not
  treated as a gap.
- `enforce_self_service_role` correctly blocks `admin` on self_service tenants.

## Fixes

Forward migration `supabase/migrations/20260619120000_rls_audit_fix_privilege_escalation.sql`
(no historical migration edited):

- **GAPs 1 & 2** — new `BEFORE UPDATE` trigger `trg_aa_enforce_user_self_update_guard`
  on `public.users` (`enforce_user_self_update_guard()`). For non-privileged
  sessions it raises if `role`, `tenant_id`, or `is_active` change. `service_role`,
  `is_admin()`, and `is_super_admin()` bypass the guard, so legitimate admin
  management and backend provisioning (e.g. `admin:promote`) still work. A trigger
  is used rather than a `WITH CHECK` because the rule is "column did not change",
  which needs `OLD` (unavailable to RLS check expressions).
- **GAP 3** — `set_grant_tenant_id()` and `set_tenant_from_grant()` now **always**
  derive `tenant_id` from the owning user / parent grant, overwriting any
  client-supplied value instead of trusting a `NULL`. Legitimate callers already
  pass `NULL`, so behaviour is unchanged for them.

All 14 adversarial cases pass after the fix; verified load-bearing by dropping the
guard trigger and observing the 4 escalation/hop cases fail, then restoring.

## Related: tenant-agnostic platform root (GitHub #29)

Migration `supabase/migrations/20260619130000_tenant_agnostic_platform_root.sql`
removes the hard-coded `'tfac'` / `'the-family-advocates-canada'` literals from
the two SECURITY DEFINER functions that referenced them
(`enforce_membership_eligibility`, `is_membership_exempt(integer)`). The
platform-root tenant is now identified by `platform_settings.platform_root_slug`
(singleton row, default `'tfac'`), read via `platform_root_slug()` and compared
via `is_platform_root_tenant(slug, name)`. Re-point with:

```sql
UPDATE platform_settings SET platform_root_slug = '<new-slug>' WHERE id = 1;
```

Verified by `supabase/tests/platform-root-config.test.sh` (6 cases), including
that re-pointing the config moves the membership exemption to a different tenant.
