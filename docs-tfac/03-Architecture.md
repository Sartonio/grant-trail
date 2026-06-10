# GrantTrail - Architecture Reference

> All three features described in this document are **fully implemented** in the current codebase.

---

## Terminology

These two terms are used throughout the codebase and documentation. They are related but distinct:

| Term | Meaning | Database | Example |
|------|---------|----------|---------|
| **Tenant** | The administrative account in GrantTrail. Owns the data, controls settings, defines who can access what. | `tenants` table | "The Family Advocates Canada" (TFAC) |
| **Organization** | The real-world entity a user belongs to. A grantee enters this when completing their profile. | `users.organization_name` | "Helping Hands", "Bright Future Org" |

**Managed tenants:** One tenant manages grantees from many different organizations. TFAC (the tenant) has grantees from Helping Hands, Bright Future Org, and Hope Foundation. Each grantee's organization is independent of the tenant name.

**Self-service tenants:** Tenant and organization are the same thing. When Carlos Lopez signs up, a tenant is created using his organization name. There's no separation.

**Rule of thumb:**
- "Tenant" = the GrantTrail account (admin boundary, settings, data isolation)
- "Organization" = the user's real-world affiliation (entered during profile setup)
- Never use "organization" to mean "tenant"

---

## Table of Contents

- [1. Multi-Tenancy](#1-multi-tenancy)
  - [1.1 What Multi-Tenancy Means](#11-what-multi-tenancy-means)
  - [1.2 New Tables](#12-new-tables)
  - [1.3 Schema Changes — tenant_id on Every Table](#13-schema-changes--tenant_id-on-every-table)
  - [1.4 RLS Policy Changes](#14-rls-policy-changes)
  - [1.5 Storage Bucket Path Changes](#15-storage-bucket-path-changes)
  - [1.6 Roles — Platform Admin vs Tenant Admin](#16-roles--platform-admin-vs-tenant-admin)
  - [1.7 Frontend Changes](#17-frontend-changes)
  - [1.8 Effort Summary](#18-effort-summary)
- [2. Configurable Approval Workflows](#2-configurable-approval-workflows)
  - [2.1 What "Turning Off Approvals" Means](#21-what-turning-off-approvals-means)
  - [2.2 Database Changes](#22-database-changes)
  - [2.3 Auto-Approve Logic — Two Options](#23-auto-approve-logic--two-options)
  - [2.4 Frontend Changes](#24-frontend-changes)
  - [2.5 Edge Cases](#25-edge-cases)
  - [2.6 Effort Summary](#26-effort-summary)
- [3. Two-Tier SaaS Model](#3-two-tier-saas-model)
  - [3.1 Tenant Type Column](#31-tenant-type-column)
  - [3.2 Two Completely Different Signup Flows](#32-two-completely-different-signup-flows)
  - [3.3 What Each Tier Sees](#33-what-each-tier-sees)
  - [3.4 Session Shape](#34-session-shape)
  - [3.5 Preventing Admin Role in Self-Service Tenants](#35-preventing-admin-role-in-self-service-tenants)
  - [3.6 Platform Admin Responsibilities](#36-platform-admin-responsibilities)
  - [3.7 RLS — No Changes Beyond Multi-Tenancy](#37-rls--no-changes-beyond-multi-tenancy)
  - [3.8 Effort Compared to Multi-Tenancy and Approval Config](#38-effort-compared-to-multi-tenancy-and-approval-config)
  - [3.9 Implementation Sequence](#39-implementation-sequence)

---

## 1. Multi-Tenancy

This section describes the multi-tenant architecture in GrantTrail, which supports multiple independent tenants sharing a single database and Supabase project, with full data isolation between them.

---

### 1.1 What Multi-Tenancy Means

The app supports multiple tenants using the same deployment, each with their own:

- Admin and grantee accounts
- Grants, budget items, and expenses
- Configuration (e.g. whether approvals are required — see [Section 2: Configurable Approval Workflows](#2-configurable-approval-workflows))

No tenant can see another's data. Isolation is enforced at the database level via Row Level Security.

---

### 1.2 New Tables

#### `tenants`

One row per tenant.

```sql
CREATE TABLE tenants (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,  -- used for URL routing or display
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `tenant_settings`

Per-tenant configuration flags. (See [Section 2](#2-configurable-approval-workflows) for the approval columns.)

```sql
CREATE TABLE tenant_settings (
  tenant_id              INT PRIMARY KEY REFERENCES tenants(id),
  require_grant_approval   BOOLEAN DEFAULT true,
  require_budget_approval  BOOLEAN DEFAULT true,
  require_expense_approval BOOLEAN DEFAULT true
);
```

---

### 1.3 Schema Changes — tenant_id on Every Table

Every application table has `tenant_id INT NOT NULL REFERENCES tenants(id)`:

| Table | Notes |
|-------|-------|
| `users` | Primary tenant assignment — all other tenant_ids derive from this |
| `grant_record` | Set to user's tenant on INSERT |
| `budget_items` | Set to grant's tenant on INSERT |
| `expenses` | Set to grant's tenant on INSERT |
| `receipts` | Set to grant's tenant on INSERT |
| `grant_attachments` | Set to grant's tenant on INSERT |
| `grant_status_history` | Set to grant's tenant on INSERT |
| `grant_comments` | Set to grant's tenant on INSERT |
| `audit_log` | Set from the changed row's tenant on INSERT |

`budget_items`, `expenses`, and derived tables infer `tenant_id` from their parent grant, so a trigger on INSERT fills it automatically rather than requiring the application to supply it explicitly.

---

### 1.4 RLS Policy Changes

Every existing policy includes a tenant isolation clause. The key question is how Postgres knows the current user's `tenant_id` at policy evaluation time.

#### Option A — Look up from `users` table (simpler, always fresh)

```sql
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS INT AS $$
  SELECT tenant_id FROM users WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

`SECURITY DEFINER STABLE` allows Postgres to cache the result within a single transaction, so the subquery runs once per request rather than once per row.

Every policy adds:
```sql
AND tenant_id = current_tenant_id()
```

**Trade-off:** Slightly heavier than reading from the JWT, but always reflects the current state of the database. No stale-token issue.

#### Option B — Custom JWT claim (faster, but stale until re-login)

Add `tenant_id` to the JWT at login time via a Supabase Auth Hook. The hook is a Postgres function Supabase calls every time it issues a token:

```sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  claims     jsonb;
  v_tenant   int;
BEGIN
  SELECT tenant_id INTO v_tenant
  FROM public.users
  WHERE user_id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant));

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook
  TO supabase_auth_admin;
```

Configure in: **Supabase Dashboard -> Authentication -> Hooks -> Custom Access Token**.

After this, every issued JWT contains `tenant_id` in its payload. Postgres reads it with no query:

```sql
AND tenant_id = (auth.jwt() ->> 'tenant_id')::int
```

On the React side, `tenant_id` is also readable from the decoded JWT payload after `supabase.auth.getSession()`.

**Trade-off:** If a user's tenant assignment changes, their existing JWT still carries the old `tenant_id` until it expires (default ~1 hour) or they log out and back in. For this app — where tenant is set at account creation and never changes — this is not a problem in practice.

#### `is_admin()` is tenant-scoped

```sql
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = auth.uid()
      AND role = 'admin'
      AND is_active = true
      AND tenant_id = current_tenant_id()   -- added
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

#### Example updated policy

```sql
-- Before
CREATE POLICY "Grantees can view own grants"
ON grant_record FOR SELECT
USING (user_id = (SELECT id FROM users WHERE user_id = auth.uid()));

-- After
CREATE POLICY "Grantees can view own grants"
ON grant_record FOR SELECT
USING (
  tenant_id = current_tenant_id()
  AND user_id = (SELECT id FROM users WHERE user_id = auth.uid())
);
```

Every policy on every table receives this treatment — roughly 20-30 policy definitions total.

---

### 1.5 Storage Bucket Path Changes

Paths include a tenant prefix to prevent cross-tenant file access:

| Bucket | Previous path | Multi-tenant path |
|--------|-------------|-------------------|
| `receipts` | `receipts/{grant_id}/{expense_id}/{ts}.{ext}` | `receipts/{tenant_id}/{grant_id}/{expense_id}/{ts}.{ext}` |
| `grant-documents` | `attachments/{grant_id}/{ts}-{filename}` | `attachments/{tenant_id}/{grant_id}/{ts}-{filename}` |

Storage RLS policies also include `tenant_id` checks — they rely on the `receipts` and `grant_attachments` table rows, which carry `tenant_id` after the schema change, so storage policies join against those tables.

---

### 1.6 Roles — Platform Admin vs Tenant Admin

The `role` column supports the following levels:

| Role | Scope | Can do |
|------|-------|--------|
| `grantee` | Own tenant | Submit grants, log expenses |
| `admin` | Own tenant | Review grants, manage users within tenant |
| `platform_admin` | All tenants | Create/manage tenants, cross-tenant visibility |

Options:
- Add `'platform_admin'` to the `role` CHECK constraint and create a separate `is_platform_admin()` SECURITY DEFINER function
- Or manage platform admins via a separate table entirely, keeping the `users` table role constraint unchanged

Platform admin UI is a separate set of pages (tenant list, tenant creation, cross-tenant grant overview).

---

### 1.7 Frontend Changes

#### Session object

```js
session = {
  user,          // Supabase auth user (unchanged)
  userRecord,    // users table row (unchanged, now includes tenant_id)
  tenantConfig   // row from tenant_settings — loaded once on login
}
```

`tenantConfig` is fetched alongside `userRecord` in `App.js` after login — one extra query.

#### Tenant resolution on login

After a user authenticates, `App.js` fetches:
1. `userRecord` from `users` (already done)
2. `tenantConfig` from `tenant_settings` where `tenant_id = userRecord.tenant_id`

No URL-based tenant routing is required if each user belongs to exactly one tenant (which is the simplest model). Subdomain-based routing (`tenant.granttrail.com`) is the polished SaaS approach but requires DNS and deployment infrastructure beyond the scope of this project.

#### Component changes

Most components require no changes — RLS handles isolation automatically and queries return only the current tenant's data. Changes are concentrated in:

- `App.js` — fetch and carry `tenantConfig` in session
- `SignUpClean.js` — new users need a `tenant_id` assigned (either from an invite link, a tenant selection step, or admin provisioning)
- Admin pages — a **Tenant Management** section for platform admins

#### New user onboarding

With multi-tenancy, a new user needs to be assigned to a tenant. Options:
- **Invite links** — tenant admin generates a link containing a token tied to their `tenant_id`; signup consumes the token
- **Admin provisioning** — platform admin creates the user account and assigns the tenant
- **Self-service tenant creation** — signup creates both a new user and a new tenant in one flow

---

### 1.8 Effort Summary

| Area | Size |
|------|------|
| New tables (`tenants`, `tenant_settings`) | Small |
| `tenant_id` column on 10 tables | Small per table, tedious in bulk |
| RLS policy rewrite (~25 policies) | Large |
| `is_admin()` + `current_tenant_id()` functions | Small |
| Auth hook (JWT claim, optional) | Small |
| Storage path prefix | Small |
| `App.js` session shape + `tenantConfig` fetch | Small |
| New user onboarding / invite flow | Moderate |
| Platform admin UI (tenant management pages) | Large |
| **Total** | **Large undertaking** |

The implementation sequence:

1. Add `tenants` and `tenant_settings` tables
2. Add `tenant_id` to all application tables
3. Write `current_tenant_id()` and update `is_admin()`
4. Rewrite all RLS policies with tenant isolation
5. Update storage paths
6. Update `App.js` session to carry `tenantConfig`
7. Build invite/onboarding flow
8. Build platform admin pages
9. Optionally add JWT custom claim hook for RLS performance

Steps 1-6 are the isolation foundation. Steps 7-9 are the operational layer on top.

---

## 2. Configurable Approval Workflows

This section describes the configurable approval workflow system in GrantTrail. Grant, budget item, and expense approval workflows are optional per tenant — tenants can skip some or all approval steps so that submitted records are immediately active.

Approval settings live in `tenant_settings` (one row per tenant). See [Section 1: Multi-Tenancy](#1-multi-tenancy) for the multi-tenant architecture.

---

### 2.1 What "Turning Off Approvals" Means

Every record starts at `pending` and requires an admin to explicitly approve it before it counts toward any totals when approvals are enabled. With configurable approvals:

| Setting | Off behaviour |
|---------|--------------|
| `require_grant_approval` | Grant is set to `approved` immediately on submission — no admin review step |
| `require_budget_approval` | Budget items are set to `approved` immediately on creation |
| `require_expense_approval` | Expenses are set to `approved` immediately on creation and instantly count toward `total_spent` and `remaining_balance` |

Settings are independent — you could require grant approval but skip budget and expense approval, for example.

---

### 2.2 Database Changes

#### Settings storage

**Single-tenant (no multi-tenancy):** A single-row settings table:

```sql
CREATE TABLE app_settings (
  id                       INT PRIMARY KEY DEFAULT 1,  -- enforces single row
  require_grant_approval   BOOLEAN NOT NULL DEFAULT true,
  require_budget_approval  BOOLEAN NOT NULL DEFAULT true,
  require_expense_approval BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO app_settings DEFAULT VALUES;
```

**Multi-tenant:** These columns live on `tenant_settings` instead (one row per tenant).

#### RLS on settings table

```sql
-- Anyone authenticated can read settings (needed at login time)
CREATE POLICY "Anyone can read settings"
ON app_settings FOR SELECT USING (auth.role() = 'authenticated');

-- Only admins can update settings
CREATE POLICY "Admins can update settings"
ON app_settings FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
```

---

### 2.3 Auto-Approve Logic — Two Options

#### Option A — Trigger-based (recommended)

The INSERT trigger on each table checks the relevant setting and overrides `status` to `'approved'` before the row is committed. The application doesn't need to know about the setting at all.

**`grant_record` INSERT trigger:**
```sql
CREATE OR REPLACE FUNCTION auto_approve_grant()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (SELECT require_grant_approval FROM app_settings LIMIT 1) THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_approve_grant
BEFORE INSERT ON grant_record
FOR EACH ROW EXECUTE FUNCTION auto_approve_grant();
```

**`budget_items` INSERT trigger:**
```sql
CREATE OR REPLACE FUNCTION auto_approve_budget_item()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (SELECT require_budget_approval FROM app_settings LIMIT 1) THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_approve_budget_item
BEFORE INSERT ON budget_items
FOR EACH ROW EXECUTE FUNCTION auto_approve_budget_item();
```

**`expenses` INSERT trigger:**
```sql
CREATE OR REPLACE FUNCTION auto_approve_expense()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (SELECT require_expense_approval FROM app_settings LIMIT 1) THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_approve_expense
BEFORE INSERT ON expenses
FOR EACH ROW EXECUTE FUNCTION auto_approve_expense();
```

Because these are `BEFORE INSERT` triggers, the `status = 'approved'` value is in place before the AFTER triggers fire — so the totals triggers (`update_grant_record_totals`, `update_budget_item_totals`) immediately count the new row. No second round-trip is needed.

#### Option B — Application-side (simpler triggers, more frontend work)

After inserting a record, the React component checks `tenantConfig` and immediately calls `.update({ status: 'approved' })` if approval is not required. Two database round-trips instead of one, and every INSERT call site in the frontend needs to be aware of the setting.

Option A is cleaner and is the recommended approach.

---

### 2.4 Frontend Changes

#### Session carries the settings

`App.js` fetches `app_settings` once at login and adds it to the session:

```js
session = {
  user,
  userRecord,
  appSettings: {
    requireGrantApproval:   true/false,
    requireBudgetApproval:  true/false,
    requireExpenseApproval: true/false,
  }
}
```

All components that need to adapt their UI read from `session.appSettings`.

#### Component-by-component impact

##### `CreateGrant.js`
- If `requireGrantApproval = false`: after submit, show "Grant submitted and approved" instead of "Grant submitted -- pending review". Skip any messaging about waiting for approval.

##### `GrantDetail.js`
- Status history section: if approvals are off, the history only ever shows `approved` — the timeline is less meaningful. Can hide it or simplify to a single status badge.
- "Needs Changes" resubmit path never occurs — that branch is removed from the UI.

##### `Grants.js`
- "Edit & Resubmit" action only appears on `needs_changes` grants. If grant approval is off, this status can never occur — the button is removed.
- Status filter options are simplified (remove Pending, Needs Changes).

##### `GrantBreakdown.js`
- Pending expense rows: if `requireExpenseApproval = false`, expenses are immediately approved, so the "pending" state in the Budgeted vs. Spent chart never shows the gold pending bar. The bar chart simplifies to two bars (Allocated + Spent).
- Expense status badges on each row are always green — the badge can be hidden entirely or show nothing.

##### `AdminGrantReview.js`
- **Budget & Expense Review section**: if both budget and expense approval are off, this entire section is hidden with a note ("Approval workflows are disabled for this tenant").
- Grant status dropdown: if grant approval is off, the status is already `approved` on arrival — the review page becomes informational only (view attachments, add comments) rather than an action page.

##### `AdminGrantList.js`
- "Pending Review" filter option: if grant approval is off, no grants will ever be in `pending` status. The filter is removed or hidden.
- Review Queue on `AdminDashboard.js` is always empty — it is hidden.

##### `AdminDashboard.js`
- Stat cards: Pending and Needs Changes cards are always 0 if both settings are off — they are hidden or replaced with other metrics.

##### `Main.js`
- Grantee dashboard stat cards: same — Pending count is always 0.

##### `StatusBadge.js`
- `needs_changes` status can never occur if grant approval is off — safe to leave the component unchanged (it just is not used).

#### Admin settings page

A page at `/admin/settings` where an admin can toggle the three approval flags with immediate effect. Changes apply to newly created records — records already in `pending` are not retroactively approved.

UI: three toggle switches with labels and a short explanation of what each controls. Save button calls `.update()` on `app_settings`.

---

### 2.5 Edge Cases

**What happens to records already in `pending` when approvals are turned off?**

Nothing automatically — existing pending records remain pending until an admin approves or rejects them. The setting only affects new records going forward. If a clean slate is needed, a one-time migration query can bulk-approve all pending records.

**What happens when approvals are turned back on?**

New records start at `pending` again. Records that were auto-approved while the setting was off remain `approved` — they are not reset.

**Resubmission flow when grant approval is off:**

The "Needs Changes" status requires an admin to have set it, which requires grant approval to be on. If grant approval is off, the resubmission flow (`CreateGrant.js` edit mode, "Edit & Resubmit" button in `Grants.js`) is unreachable in normal usage and is hidden from the UI.

---

### 2.6 Effort Summary

| Area | Size |
|------|------|
| `app_settings` table + RLS | Small |
| 3 BEFORE INSERT trigger functions | Small |
| `App.js` — fetch and carry `appSettings` in session | Small |
| `CreateGrant.js` — success messaging | Trivial |
| `GrantDetail.js` — conditional status history | Small |
| `Grants.js` — hide resubmit button | Trivial |
| `GrantBreakdown.js` — conditional pending bar | Small |
| `AdminGrantReview.js` — conditional review section | Small |
| `AdminGrantList.js` / `AdminDashboard.js` — filter/queue cleanup | Small |
| `Main.js` — stat card cleanup | Trivial |
| `/admin/settings` page | Small-Moderate |
| **Total** | **Moderate** |

This is a self-contained feature with no dependency on multi-tenancy. It can be built and shipped independently. The largest single piece of work is the admin settings page; the trigger changes and conditional UI throughout the app are individually small.

---

## 3. Two-Tier SaaS Model

This section describes the two-tier tenant model in GrantTrail, which supports two distinct tenant types within one deployment:

- **Managed** — the TFAC experience: admins, grantees, full approval workflows, invite-based user provisioning
- **Self-service** — an unmanaged tracking tool: single user or small team, no admin role, no approval workflows, open signup

This builds on the multi-tenancy architecture ([Section 1](#1-multi-tenancy)) and the approval configuration ([Section 2](#2-configurable-approval-workflows)). This section covers only what is **different or additional**.

---

### 3.1 Tenant Type Column

The `tenants` table includes a type discriminator:

```sql
ALTER TABLE tenants
  ADD COLUMN tenant_type VARCHAR(20) NOT NULL DEFAULT 'self_service'
  CHECK (tenant_type IN ('managed', 'self_service'));
```

| Type | Who uses it | Approvals | Admin role available |
|------|-------------|-----------|----------------------|
| `managed` | TFAC and enterprise orgs | Configurable (default all on) | Yes |
| `self_service` | Open signup users | Always off — hardcoded at provisioning | No |

When a self-service tenant is auto-provisioned at signup, `tenant_settings` is created with all three approval flags set to `false`. These flags are not configurable by the user — the tenant type determines them.

---

### 3.2 Two Completely Different Signup Flows

This is the most significant product difference.

#### Managed tenant — invite-based

A platform admin creates the tenant and generates an invite link for the first admin user. That admin then invites grantees. No open signup.

Flow:
```
Platform admin creates tenant
    -> Sets tenant_type = 'managed', approval settings
    -> Generates invite link (contains a short-lived token tied to tenant_id + role)
        -> Invited admin clicks link -> /signup?invite=<token>
        -> Signup creates user row with tenant_id and role from token
        -> Managed admin can then invite grantees the same way
```

#### Self-service — open signup

Anyone can sign up. Signup auto-provisions a tenant for them.

Flow:
```
User hits /signup (no token)
    -> Fills in name, org, email, password
    -> On submit:
        1. Supabase Auth creates the auth user
        2. A new tenants row is inserted (tenant_type = 'self_service')
        3. A tenant_settings row is inserted (all approvals = false)
        4. The users row is inserted (role = 'grantee', linked to new tenant)
    -> User lands on their dashboard immediately
```

Steps 2-4 run as a privileged operation — the anon/grantee role cannot insert into `tenants`. Options:
- A Supabase Edge Function called from the frontend after auth signup (has service role key)
- A `SECURITY DEFINER` Postgres function callable via RPC that performs all three inserts atomically

The Edge Function approach is cleaner because the service role key stays server-side and is never exposed to the browser.

---

### 3.3 What Each Tier Sees

#### Self-service grantee experience

The grantee portal is unchanged structurally. The differences are driven by `tenantConfig.type === 'self_service'`:

| Element | Change |
|---------|--------|
| Grant status | Never `pending` or `needs_changes` — always `approved` immediately |
| Status history timeline | Always shows a single "Approved" entry — can be hidden or simplified |
| "Edit & Resubmit" button | Never shown (requires `needs_changes` status, which never occurs) |
| Admin comments section | Hidden — no admin to leave comments |
| Budget item status badges | Always approved — badges can be hidden |
| Expense status badges | Always approved — badges can be hidden |
| Pending bar in breakdown chart | Never populated — chart simplifies to two bars |
| Dashboard pending/needs-changes cards | Always 0 — can be replaced with other metrics |
| Receipt requirement | Could be made optional for self-service (less formal tracking) |

#### Managed grantee and admin experience

Identical to the standard app. No changes needed.

---

### 3.4 Session Shape

`App.js` carries tenant type in the session so all components can branch on it:

```js
session = {
  user,
  userRecord,
  tenantConfig: {
    type: 'self_service',        // or 'managed'
    requireGrantApproval: false,
    requireBudgetApproval: false,
    requireExpenseApproval: false,
  }
}
```

Components prefer checking `tenantConfig.type` for large structural differences (showing or hiding entire sections) and individual approval flags for fine-grained rendering (e.g. showing a specific status badge).

---

### 3.5 Preventing Admin Role in Self-Service Tenants

Self-service users are always `role = 'grantee'`. This is enforced at the database level:

```sql
CREATE OR REPLACE FUNCTION enforce_self_service_role()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF (SELECT tenant_type FROM tenants WHERE id = NEW.tenant_id) = 'self_service' THEN
      RAISE EXCEPTION 'Self-service tenants cannot have admin users';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_self_service_role
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION enforce_self_service_role();
```

Because `is_admin()` checks `role = 'admin'`, and self-service users can never have that role, all admin-gated RLS policies are automatically inaccessible to self-service tenants without any policy changes.

---

### 3.6 Platform Admin Responsibilities

A platform admin (a role beyond tenant admin — see [Section 1.6](#16-roles--platform-admin-vs-tenant-admin)) manages both tiers:

| Task | How |
|------|-----|
| Create a managed tenant | Platform admin UI: enter org name, set approval settings, generate first invite |
| Monitor self-service signups | Platform admin UI: list of all tenants with type, creation date, user count |
| Disable a tenant | Set `is_active = false` on the `tenants` row (all users locked out) |
| Convert self-service to managed | Change `tenant_type`, set approval settings, add an admin user |

The conversion path (self-service to managed) is a natural SaaS upgrade path: a user starts with the free self-service tier and later upgrades to the managed tier with approvals.

---

### 3.7 RLS — No Changes Beyond Multi-Tenancy

The tenant isolation policies from [Section 1](#1-multi-tenancy) work identically for both tenant types. `tenant_id` isolation ensures self-service users only ever see their own data. The tenant type does not affect RLS — it only affects the product experience layer.

---

### 3.8 Effort Compared to Multi-Tenancy and Approval Config

The database changes from Sections 1 and 2 are prerequisites. On top of those, the two-tier model adds:

| Additional area | Size |
|----------------|------|
| `tenant_type` column on `tenants` | Trivial |
| Self-service auto-provisioning (Edge Function or SECURITY DEFINER RPC) | Moderate |
| Invite-based signup for managed tenants (token generation + validation) | Moderate |
| `enforce_self_service_role()` trigger | Small |
| `App.js` — branch on `tenantConfig.type` vs individual flags | Small |
| UI conditional rendering driven by `tenantConfig.type` | Small per component |
| Platform admin: tenant list + create managed tenant + disable tenant | Moderate-Large |
| Self-service to managed upgrade path | Moderate |
| **Total additional effort** | **Moderate on top of Sections 1 and 2** |

---

### 3.9 Implementation Sequence

Building on the sequences in Sections 1 and 2:

1. Complete all database isolation work from Section 1 (tenant_id, RLS, functions)
2. Add `tenant_type` to `tenants` and auto-approval provisioning from Section 2
3. Build the self-service open signup + auto-provisioning (Edge Function)
4. Build the invite-based managed signup flow
5. Add `enforce_self_service_role()` trigger
6. Update `App.js` session to carry `tenantConfig.type`
7. Add `tenantConfig.type` conditional rendering across grantee UI components
8. Build platform admin tenant management pages
9. Optionally: design the self-service to managed upgrade path
