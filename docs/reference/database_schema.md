# Database Schema Reference

This document describes every table, column, constraint, and trigger in the GrantTrail database. The full SQL is in `supabase/migrations/20260616000000_initial_schema.sql`. For a per-table Row-Level Security policy audit, see [rls_policy_audit.md](rls_policy_audit.md).

---

## Data Model Overview

```
tenants                (independent organizations)
    ├── tenant_settings    (per-tenant approval workflow config + support contact)
    ├── invites            (signup invite tokens)
    └── users              (application user profiles, linked to auth.users)
            ├── notifications      (in-app notifications — trigger-managed, realtime)
            ├── user_memberships   (active membership tier — basic or premium)
            ├── billing_customers  (Stripe customer ID link)
            ├── subscriptions      (Stripe subscription records)
            ├── feature_entitlements (per-user feature flag overrides)
            └── grant_record       (grant applications)
                    ├── budget_items       (budget line items)
                    │       └── expenses   (individual expense entries)
                    │               └── receipts  (receipt file metadata)
                    ├── grant_attachments  (proposal / report documents)
                    ├── grant_status_history  (auto-written by trigger)
                    └── grant_comments     (admin comments)

audit_log              (generic change log — written by triggers)
platform_settings      (single-row platform-wide defaults — managed by super_admin)
billing_webhook_events (idempotency log of processed Stripe webhook events)
```

All application tables carry a `tenant_id` column for multi-tenant isolation.

---

## Tables

### `tenants`

Independent organizations using the system. Each tenant's data is fully isolated via RLS.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `name` | VARCHAR(200) | no | — | Organization name |
| `slug` | VARCHAR(100) | no | — | URL-safe identifier (UNIQUE) |
| `tenant_type` | VARCHAR(20) | no | `'self_service'` | `'managed'` or `'self_service'` (CHECK constraint) |
| `is_active` | BOOLEAN | no | `true` | Tenant enabled flag — `false` locks out all users in the tenant (super admins exempt) |
| `created_at` | TIMESTAMPTZ | no | NOW() | Row creation timestamp |

**RLS:** Users can view their own tenant. Super admins can manage all tenants.

---

### `tenant_settings`

Per-tenant configuration for approval workflows and support contact. One row per tenant.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `tenant_id` | INT | no | — | **PK** + FK → `tenants.id` |
| `require_grant_approval` | BOOLEAN | no | `true` | When `false`, new grants are auto-approved |
| `require_budget_approval` | BOOLEAN | no | `true` | When `false`, new budget items are auto-approved |
| `require_expense_approval` | BOOLEAN | no | `true` | When `false`, new expenses are auto-approved |
| `require_subscription` | BOOLEAN | no | `true` | When `false`, the subscription check is bypassed for the tenant |
| `support_email` | VARCHAR(75) | yes | NULL | Tenant-specific support email shown in footer |
| `support_phone` | VARCHAR(20) | yes | NULL | Tenant-specific support phone shown in footer |

**Self-service tenants** are created with all three approval flags set to `false` and `require_subscription` set to `true` by default.

---

### `platform_settings`

Single-row platform-wide configuration managed by the super admin. Provides default support contact info and Stripe product IDs for membership tiers.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INT | no | `1` | **PK** — constrained to 1 (single row) |
| `default_support_email` | VARCHAR(75) | no | `'support@granttrail.org'` | Default support email for all tenants |
| `default_support_phone` | VARCHAR(20) | no | `'(555) 123-4567'` | Default support phone for all tenants |
| `basic_membership_product_id` | VARCHAR | yes | `NULL` | Stripe product ID for the Basic tier. Not hard-coded — synced from `STRIPE_PRICE_BASIC` by the Edge Functions, or set by a super admin. |
| `premium_membership_product_id` | VARCHAR | yes | `NULL` | Stripe product ID for the Premium (Org Admin) tier. Not hard-coded — synced from `STRIPE_PRICE_PRO` by the Edge Functions, or set by a super admin. |
| `platform_root_slug` | VARCHAR(100) | no | `'tfac'` | Slug of the platform-root (operator) tenant whose admins are membership-exempt. Replaces the previously hard-coded `'tfac'` literal so the platform root is config-driven (GitHub #29, `20260619130000`). Read via `platform_root_slug()`; compared via `is_platform_root_tenant(slug, name)`. Re-point with `UPDATE platform_settings SET platform_root_slug = '<new-slug>' WHERE id = 1`. |

**RLS:** Anyone can read. Only super admins can update.

> **Platform root is no longer hard-coded.** The platform-root tenant (whose
> admins are never billed) was previously matched against the literal `'tfac'`
> slug inside SECURITY DEFINER logic. It is now resolved from
> `platform_root_slug` (default `'tfac'`, so behaviour is unchanged by default).
> TFAC remains exempt out of the box; the mechanism is just config-driven now.

**Used by:** `billing.js` → `getMembershipProductIds()` reads these at startup to resolve which Stripe product to use for each membership tier.

---

### `invites`

Signup invite tokens for onboarding new users into managed tenants.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — which tenant the user joins |
| `token` | UUID | no | `gen_random_uuid()` | Unique invite token (used in signup URL) |
| `role` | VARCHAR(20) | no | `'grantee'` | Role assigned on signup: `'admin'` or `'grantee'` |
| `email` | VARCHAR(75) | yes | NULL | Optional — locks signup to this email |
| `created_by` | UUID | yes | NULL | FK → `auth.users.id` — admin who created the invite |
| `used_by` | UUID | yes | NULL | FK → `auth.users.id` — user who consumed the invite |
| `used_at` | TIMESTAMPTZ | yes | NULL | When the invite was consumed |
| `expires_at` | TIMESTAMPTZ | no | NOW() + 7 days | Invite expiry |
| `created_at` | TIMESTAMPTZ | yes | NOW() | Row creation timestamp |

**RLS:** Only admins can directly read invites for their own tenant (and create them). `anon` has **no** table access. Token-scoped reads/consumption during signup go through SECURITY DEFINER RPCs `get_invite_by_token(p_token text)` and `consume_invite(p_token text, p_user_id uuid)` — never a direct client query (D7 hardening, `20260619140000` / `20260619170000`). See `frontend/src/lib/invites.js`.

---

### `users`

Application user profiles. Linked to Supabase Auth via `user_id` (UUID). Scoped to a tenant.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** — integer primary key used as FK in all other tables |
| `tenant_id` | INT | no | — | FK → `tenants.id` — tenant this user belongs to |
| `firstname` | VARCHAR(50) | no | — | First name |
| `lastname` | VARCHAR(50) | no | — | Last name |
| `organization_name` | VARCHAR(50) | no | — | Non-profit or organization name |
| `email` | VARCHAR(75) | no | — | Unique email address |
| `phone_number` | VARCHAR(20) | no | — | Contact phone number |
| `user_id` | UUID | yes | NULL | FK → `auth.users.id` — linked after Supabase Auth signup |
| `role` | VARCHAR(20) | yes | `'grantee'` | `'grantee'`, `'admin'`, or `'super_admin'` (CHECK constraint) |
| `is_active` | BOOLEAN | no | `true` | Account enabled flag — `false` locks the user out at the application layer |
| `tax_month` | INT | yes | NULL | Month number (1–12) for tax filing reminders. CHECK constraint: 1–12. |
| `created_at` | TIMESTAMPTZ | yes | NOW() | Row creation timestamp |

**Notes:**
- `user_id` is NULL until the user signs up and the app writes it
- `id` (integer) is used as FK everywhere — never use the UUID `user_id` as a FK
- When `is_active = false`, the user can still SELECT their own row (so App.js can read the flag), but App.js signs them out and shows an "Account Disabled" message
- RLS: users can read/update their own row; admins can read all rows and update `role` / `is_active` via the `"Admins can update users"` policy
- **Self-update is privilege-frozen:** the `trg_aa_enforce_user_self_update_guard` BEFORE UPDATE trigger blocks a self-service user from changing their own `role`, `tenant_id`, or `is_active` (closes self-promotion to super_admin and tenant-hopping). service_role, `is_admin()`, and `is_super_admin()` sessions are exempt. See `20260619120000`.
- All changes to this table are written to `audit_log` via `trg_audit_users`

---

### `grant_record`

A single grant application. Central table of the data model.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — auto-populated from user's tenant on INSERT |
| `user_id` | INT | no | — | FK → `users.id` — the grantee who owns this grant |
| `grant_name` | VARCHAR(100) | yes | NULL | Display name for the grant |
| `description` | TEXT | yes | NULL | Grant purpose / program description |
| `start_spend_period` | DATE | yes | NULL | First day expenses can be incurred |
| `end_spend_period` | DATE | yes | NULL | Last day expenses can be incurred |
| `release_date` | DATE | yes | NULL | Date funds were released to the grantee |
| `grant_amount` | DECIMAL(12,2) | yes | 0 | Total approved grant amount |
| `disbursed_funds` | DECIMAL(12,2) | yes | 0 | Amount actually disbursed (set by admin) |
| `total_spent` | DECIMAL(12,2) | yes | 0 | **Auto-calculated** — sum of all **approved** expense amounts (trigger) |
| `remaining_balance` | DECIMAL(12,2) | yes | 0 | **Auto-calculated** — `grant_amount − total_spent` (trigger) |
| `status` | VARCHAR(30) | yes | `'pending'` | `'pending'`, `'approved'`, `'needs_changes'`, or `'rejected'` |
| `submitted_at` | TIMESTAMPTZ | yes | NULL | When the application was submitted |
| `reviewed_at` | TIMESTAMPTZ | yes | NULL | When an admin last reviewed it |
| `reviewer_id` | UUID | yes | NULL | FK → `auth.users.id` — which admin reviewed it |
| `approval_notes` | TEXT | yes | NULL | Admin's public notes to the grantee |
| `created_at` | TIMESTAMPTZ | yes | NOW() | Row creation timestamp |
| `updated_at` | TIMESTAMPTZ | yes | NOW() | **Auto-updated** on every UPDATE (trigger) |

**Auto-managed columns:**
- `total_spent` — recalculated by `update_grant_record_totals()` after any insert/update/delete on `expenses`; only counts rows where `expenses.status = 'approved'`
- `remaining_balance` — recalculated by `update_grant_remaining_balance()` before any UPDATE on this table
- `updated_at` — updated by `set_updated_at()` before any UPDATE
- Status changes automatically write a row to `grant_status_history` via `log_grant_status_change()`
- All changes are written to `audit_log` via `log_grant_record_changes()`

**RLS:** Grantees can read/insert/update their own grants; admins can read and update all grants.

---

### `budget_items`

Budget line items within a grant. Each item has a name, an allocated amount, and a running total of what's been spent against it.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — auto-populated from parent grant on INSERT |
| `grant_id` | INT | no | — | FK → `grant_record.id` |
| `item_name` | VARCHAR(200) | no | — | Name of the budget line (e.g. "Staff Salaries") |
| `description` | TEXT | yes | NULL | Optional description of what this line covers |
| `budget_allocated` | DECIMAL(12,2) | yes | 0 | Amount budgeted for this line item |
| `amount_spent` | DECIMAL(12,2) | yes | 0 | **Auto-calculated** — sum of **approved** linked expense amounts (trigger) |
| `status` | VARCHAR(30) | no | `'pending'` | `'pending'`, `'approved'`, or `'rejected'` — set by admin via AdminGrantReview |
| `created_at` | TIMESTAMPTZ | yes | NOW() | Row creation timestamp |
| `updated_at` | TIMESTAMPTZ | yes | NOW() | **Auto-updated** on every UPDATE (trigger) |

**Auto-managed:** `amount_spent` is recalculated by `update_budget_item_totals()` after any change to `expenses`; only counts rows where `expenses.status = 'approved'`. Do not update `amount_spent` directly.

**Approval workflow:** New and edited budget items start at `status = 'pending'`. Admin approves or rejects via AdminGrantReview. Editing a budget item resets its status back to `'pending'`. Rejecting a budget item cascades all its linked expenses back to `'pending'`.

**RLS:** Grantees can read/insert/update/delete their own grant's items; admins can read and delete all items.

---

### `expenses`

Individual expense entries. Each expense belongs to a grant and optionally to a specific budget item.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — auto-populated from parent grant on INSERT |
| `grant_id` | INT | no | — | FK → `grant_record.id` |
| `budget_item_id` | INT | yes | NULL | FK → `budget_items.id` — which line item this expense is charged to |
| `item_name` | VARCHAR(50) | yes | NULL | Description of what was purchased / paid for |
| `amount_spent` | DECIMAL(12,2) | yes | 0 | Amount of this expense |
| `expense_date` | DATE | yes | NULL | Date the expense was incurred (must be within grant spend period — validated in UI) |
| `status` | VARCHAR(30) | no | `'pending'` | `'pending'`, `'approved'`, or `'rejected'` — set by admin via AdminGrantReview |
| `created_at` | TIMESTAMPTZ | yes | NOW() | Row creation timestamp |
| `updated_at` | TIMESTAMPTZ | yes | NOW() | **Auto-updated** on every UPDATE (trigger) |

**Triggers fire on every change:** `update_grant_record_totals()` updates `grant_record.total_spent` (approved only); `update_budget_item_totals()` updates `budget_items.amount_spent` (approved only); `log_expenses_changes()` writes to `audit_log`.

**Approval workflow:** New and edited expenses start at `status = 'pending'`. An expense only contributes to totals after an admin approves it. Editing an expense resets its status back to `'pending'`.

**RLS:** Grantees can read/insert/update/delete their own grant's expenses; admins can read and delete all.

---

### `receipts`

Metadata for receipt files attached to expenses. The actual file is stored in Supabase Storage (`receipts/` bucket). Each expense should have at most one receipts row.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — auto-populated from parent grant on INSERT |
| `user_id` | INT | no | — | FK → `users.id` (integer PK, not UUID) |
| `grant_id` | INT | no | — | FK → `grant_record.id` |
| `expense_id` | INT | yes | NULL | FK → `expenses.id` (SET NULL on expense delete) |
| `receipt_files` | JSON | yes | NULL | Array of file metadata objects: `[{name, path, type, size}]` |
| `created_at` | TIMESTAMPTZ | yes | NOW() | Row creation timestamp |

**Storage path:** `receipts/{tenant_id}/{grant_id}/{expense_id}/{timestamp}.{ext}`

**Note:** `receipt_files` is a JSON array but in practice only the first element is used. The path in `receipt_files[0].path` is what you pass to `supabase.storage.from('receipts').createSignedUrl()`.

**RLS:** Users can read their own receipts (via `user_id`); admins can read all.

---

### `grant_attachments`

Supporting documents uploaded to a grant (proposals, budget plans, reports, etc.). The actual file is stored in Supabase Storage (`grant-documents/` bucket).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — auto-populated from parent grant on INSERT |
| `grant_id` | INT | no | — | FK → `grant_record.id` |
| `file_name` | VARCHAR(255) | no | — | Original filename as uploaded |
| `file_path` | TEXT | no | — | Storage path used for signed URL lookups |
| `file_type` | VARCHAR(50) | yes | NULL | MIME type (e.g. `application/pdf`) |
| `file_size` | BIGINT | yes | NULL | File size in bytes |
| `uploaded_by` | UUID | yes | NULL | FK → `auth.users.id` — who uploaded the file |
| `description` | TEXT | yes | NULL | Optional description of the document |
| `category` | VARCHAR(50) | yes | `'general'` | `'proposal'`, `'budget'`, `'report'`, or `'general'` |
| `created_at` | TIMESTAMPTZ | yes | NOW() | Row creation timestamp |

**Storage path format:** `attachments/{tenant_id}/{grant_id}/{timestamp}-{filename}`

**Allowed file types (enforced in UI):** PDF, JPG, PNG, DOC, DOCX, XLS, XLSX · Max 5 MB

**RLS:** Grantees can read/insert/delete for their own grants; admins can read all.

---

### `grant_status_history`

Immutable audit trail of every status change on a grant. Written automatically by the `log_grant_status_change()` trigger — never written by application code.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — auto-populated from parent grant on INSERT |
| `grant_id` | INT | no | — | FK → `grant_record.id` |
| `old_status` | VARCHAR(30) | yes | NULL | Previous status (`NULL` on initial insert) |
| `new_status` | VARCHAR(30) | no | — | New status |
| `changed_by` | UUID | yes | NULL | FK → `auth.users.id` — who made the change |
| `comment` | TEXT | yes | NULL | Copies `approval_notes` from the grant update |
| `created_at` | TIMESTAMPTZ | yes | NOW() | When the status change occurred |

**Do not write to this table from application code.** The trigger fires automatically whenever `grant_record.status` changes.

**RLS:** Grantees can read history for their own grants; admins can read all.

---

### `grant_comments`

Admin comments on a grant, visible to the grantee. Separate from `approval_notes` — comments are a conversation thread, approval notes are a single field on the grant.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — auto-populated from parent grant on INSERT |
| `grant_id` | INT | no | — | FK → `grant_record.id` |
| `user_id` | UUID | no | — | FK → `auth.users.id` (UUID, not integer) — who wrote the comment |
| `comment` | TEXT | no | — | The comment text |
| `created_at` | TIMESTAMPTZ | yes | NOW() | When the comment was posted |

**Note:** `user_id` here is the auth UUID (unlike most other tables which use the integer PK). This is intentional — comments reference auth users directly.

**RLS:** Grantees can read comments on their own grants; admins can read all and insert. Super admins have a read-only SELECT policy (`OR is_super_admin()`, `20260619160000`).

---

### `audit_log`

Generic change log. Written by triggers on `grant_record`, `budget_items`, `expenses`, and `users` for every INSERT, UPDATE, and DELETE. Surfaced in the UI at `/admin/audit` (`AdminAuditLog.js`) with filtering and per-row diff view.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | yes | NULL | FK → `tenants.id` — extracted from JSONB values by trigger |
| `table_name` | VARCHAR(50) | no | — | Which table was changed |
| `record_id` | INT | no | — | PK of the changed row |
| `action` | VARCHAR(20) | no | — | `'INSERT'`, `'UPDATE'`, or `'DELETE'` |
| `changed_by` | UUID | yes | NULL | FK → `auth.users.id` — who made the change |
| `old_values` | JSONB | yes | NULL | Full row snapshot before the change (UPDATE/DELETE) |
| `new_values` | JSONB | yes | NULL | Full row snapshot after the change (INSERT/UPDATE) |
| `created_at` | TIMESTAMPTZ | yes | NOW() | When the change occurred |

**RLS:** Admins can read all rows; users can read rows where `changed_by = auth.uid()`.

---

### `notifications`

In-app notifications for users. Created automatically by database triggers when grant statuses change, budget items or expenses are approved/rejected, comments are added, or grants are submitted/resubmitted. Realtime-enabled via Supabase Realtime so the frontend receives live updates.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `tenant_id` | INT | no | — | FK → `tenants.id` — auto-populated from target user on INSERT |
| `user_id` | INT | no | — | FK → `users.id` — notification recipient |
| `type` | VARCHAR(50) | no | — | Event type (e.g. `grant_approved`, `expense_rejected`, `comment_added`) |
| `title` | VARCHAR(255) | no | — | Short heading displayed in the notification bell |
| `message` | TEXT | no | — | Detail text |
| `link` | TEXT | yes | NULL | In-app route to navigate to when clicked |
| `is_read` | BOOLEAN | yes | `false` | Read/unread state — toggled by the frontend |
| `created_at` | TIMESTAMPTZ | yes | NOW() | When the notification was created |

**RLS:** Users can view, update (mark as read), and delete their own notifications. Admins can also view their own. Super admins have a read-only SELECT policy (`OR is_super_admin()`, `20260619160000`). Triggers insert via a system-level INSERT policy.

**Realtime:** Enabled via `ALTER PUBLICATION supabase_realtime ADD TABLE notifications`. The frontend subscribes to INSERT events filtered by `user_id`.

---

### `subscriptions`

Stripe subscription records synced from Stripe webhooks. One active row per subscribed user. Used by `billing.js` and `AdminUserList.js` to determine access rights.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `user_id` | INT | no | — | FK → `users.id` |
| `stripe_customer_id` | VARCHAR | no | — | Stripe customer ID (e.g. `cus_...`) |
| `stripe_subscription_id` | VARCHAR | no | — | Stripe subscription ID (e.g. `sub_...`) |
| `stripe_product_id` | VARCHAR | no | — | Stripe product ID — matches `platform_settings.basic/premium_membership_product_id` |
| `stripe_price_id` | VARCHAR | no | — | Stripe price ID |
| `membership_tier` | VARCHAR | no | — | `'basic'` or `'premium'` |
| `status` | VARCHAR | no | — | Stripe subscription status: `'active'`, `'trialing'`, `'past_due'`, `'canceled'`, etc. |
| `current_period_start` | TIMESTAMPTZ | yes | NULL | Start of current billing period |
| `current_period_end` | TIMESTAMPTZ | yes | NULL | End of current billing period |
| `cancel_at_period_end` | BOOLEAN | no | `false` | Whether the subscription cancels at period end |
| `canceled_at` | TIMESTAMPTZ | yes | NULL | When the subscription was canceled |
| `metadata` | JSONB | no | `{}` | Additional Stripe metadata |
| `created_at` | TIMESTAMPTZ | no | NOW() | Row creation timestamp |
| `updated_at` | TIMESTAMPTZ | no | NOW() | Last updated |

**Written by:** Stripe webhook edge function. Not written by frontend code directly.

**Read by:** `billing.js` → `fetchMembershipStatus()` queries for rows with `status IN ('active', 'trialing', 'past_due')`.

**RLS:** Read own; `service_role` manages writes. Super admins have a read-only SELECT policy (`OR is_super_admin()`, `20260619160000`).

---

### `user_memberships`

Tracks the active membership tier for each user. Updated by the subscription sync process. This is the source of truth for feature access checks — queried via RPCs `has_basic_membership()` and `has_premium_membership()`.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `user_id` | INT | no | — | FK → `users.id` (UNIQUE) |
| `subscription_id` | INT | yes | NULL | FK → `subscriptions.id` — which subscription granted this membership |
| `membership_tier` | VARCHAR | no | — | `'basic'` or `'premium'` |
| `is_active` | BOOLEAN | no | `true` | Whether this membership is currently active |
| `starts_at` | TIMESTAMPTZ | no | NOW() | When the membership became active |
| `ends_at` | TIMESTAMPTZ | yes | NULL | When the membership expires (NULL = ongoing) |
| `source` | VARCHAR | no | `'stripe'` | How the membership was granted: `'stripe'`, `'manual'`, or `'legacy'` |
| `created_at` | TIMESTAMPTZ | no | NOW() | Row creation timestamp |
| `updated_at` | TIMESTAMPTZ | no | NOW() | Last updated |

**Read by:** `billing.js`, `AdminUserList.js`, `TenantManagement.js`. Super admins have a read-only SELECT policy (`OR is_super_admin()`, `20260619160000`).

**Route guard:** `hasRequiredSubscription(session)` (now in `frontend/src/lib/policy.js`) decides whether a session satisfies its role's subscription. Lapse handling diverges by role: a **grantee** without basic membership is redirected to `/home` (billing nudge); a lapsed **admin** is *not* redirected — they get a read-only admin UI (`ReadOnlyBanner` + disabled mutations, with blocked writes routed to `/subscription` via `useWriteGuard`). See `frontend/src/lib/guards.js` and [routing_index.md](routing_index.md).

---

### `billing_customers`

Links a `users` row to a Stripe customer ID. Created when a user initiates their first checkout session.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `user_id` | INT | no | — | FK → `users.id` |
| `stripe_customer_id` | VARCHAR | no | — | Stripe customer ID (e.g. `cus_...`) (UNIQUE) |
| `created_at` | TIMESTAMPTZ | no | NOW() | Row creation timestamp |

**Written by:** Stripe checkout edge function when creating a new Stripe customer. Not queried directly by the frontend.

**RLS:** Read own; `service_role` manages writes. Super admins have a read-only SELECT policy (`OR is_super_admin()`, `20260619160000`).

---

### `billing_webhook_events`

Idempotency log of all Stripe webhook events processed by the edge function. Prevents duplicate processing if Stripe retries a webhook.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `stripe_event_id` | VARCHAR | no | — | Stripe event ID (e.g. `evt_...`) (UNIQUE) |
| `event_type` | VARCHAR | no | — | Stripe event type (e.g. `customer.subscription.updated`) |
| `payload` | JSONB | no | — | Full Stripe event payload |
| `processed_at` | TIMESTAMPTZ | no | NOW() | When the event was processed |

**Written by:** Stripe webhook edge function only. Never read by frontend code.

---

### `feature_entitlements`

Per-user feature flag overrides. Allows granting or revoking specific features independently of the subscription tier (e.g. manual grants by super admin).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | SERIAL | no | auto | **PK** |
| `grantee_id` | INT | no | — | FK → `users.id` |
| `feature_key` | VARCHAR | no | — | Feature identifier — see `FEATURE_KEYS` in `billing.js`: `'basic_membership'`, `'admin_membership'`, `'excel_export'` |
| `enabled` | BOOLEAN | no | `false` | Whether this feature is enabled for the user |
| `source` | VARCHAR | no | `'subscription'` | How this entitlement was set: `'subscription'` or `'manual'` |
| `created_at` | TIMESTAMPTZ | no | NOW() | Row creation timestamp |
| `updated_at` | TIMESTAMPTZ | no | NOW() | Last updated |

**Note:** Feature checks in the frontend currently go through RPCs (`is_membership_exempt`, `has_basic_membership`, `has_premium_membership`) rather than querying this table directly. This table backs those RPCs.

---

## Triggers Summary

| Trigger | Table | Event | What it does |
|---------|-------|-------|--------------|
| `trg_grant_record_updated_at` | `grant_record` | BEFORE UPDATE | Sets `updated_at = NOW()` |
| `trg_budget_items_updated_at` | `budget_items` | BEFORE UPDATE | Sets `updated_at = NOW()` |
| `trg_expenses_updated_at` | `expenses` | BEFORE UPDATE | Sets `updated_at = NOW()` |
| `trg_grant_remaining_balance` | `grant_record` | BEFORE UPDATE | Recalculates `remaining_balance = grant_amount − total_spent` |
| `update_records` | `expenses` | AFTER INSERT/UPDATE/DELETE | Updates `grant_record.total_spent` |
| `update_budget_item_records` | `expenses` | AFTER INSERT/UPDATE/DELETE | Updates `budget_items.amount_spent` |
| `trg_grant_status_tracking` | `grant_record` | AFTER INSERT/UPDATE | Appends row to `grant_status_history` when status changes |
| `trg_audit_grant_record` | `grant_record` | AFTER INSERT/UPDATE/DELETE | Appends row to `audit_log`; skips no-op UPDATEs (old = new) |
| `trg_audit_expenses` | `expenses` | AFTER INSERT/UPDATE/DELETE | Appends row to `audit_log` |
| `trg_audit_budget_items` | `budget_items` | AFTER INSERT/UPDATE/DELETE | Appends row to `audit_log`; skips no-op UPDATEs (old = new) |
| `trg_audit_users` | `users` | AFTER INSERT/UPDATE/DELETE | Appends row to `audit_log`; skips no-op UPDATEs (old = new) |
| `trg_notify_grant_status` | `grant_record` | AFTER UPDATE | Notifies grantee when grant is approved/rejected/needs_changes |
| `trg_notify_grant_submitted` | `grant_record` | AFTER INSERT/UPDATE | Notifies all admins when a grant is submitted or resubmitted |
| `trg_notify_budget_item_status` | `budget_items` | AFTER UPDATE | Notifies grantee when a budget item is approved/rejected |
| `trg_notify_expense_status` | `expenses` | AFTER UPDATE | Notifies grantee when an expense is approved/rejected |
| `trg_notify_grant_comment` | `grant_comments` | AFTER INSERT | Notifies grantee when a comment is added (not by themselves) |
| `trg_set_grant_tenant_id` | `grant_record` | BEFORE INSERT | Auto-populates tenant_id from the inserting user |
| `trg_set_*_tenant_id` | budget_items, expenses, etc. | BEFORE INSERT | Auto-populates tenant_id from parent grant |
| `trg_zz_auto_approve_grant` | `grant_record` | BEFORE INSERT | Auto-approves if tenant_settings.require_grant_approval is false |
| `trg_zz_auto_approve_budget_item` | `budget_items` | BEFORE INSERT | Auto-approves if tenant_settings.require_budget_approval is false |
| `trg_zz_auto_approve_expense` | `expenses` | BEFORE INSERT | Auto-approves if tenant_settings.require_expense_approval is false |
| `trg_enforce_self_service_role` | `users` | BEFORE INSERT/UPDATE | Blocks admin role on self-service tenants |
| `trg_aa_enforce_user_self_update_guard` | `users` | BEFORE UPDATE | Freezes `role` / `tenant_id` / `is_active` on self-service self-updates (privilege-escalation guard; service_role / admin / super_admin exempt). Fires before `trg_audit_users`. |

---

## Helper Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `is_admin()` | BOOLEAN | Returns true if the current auth user has `role = 'admin'` **and** `is_active = true` **within the current tenant**. SECURITY DEFINER to prevent RLS recursion. Used by all admin RLS policies — a disabled admin is locked out of all admin-gated policies. |
| `current_tenant_id()` | INT | Returns the tenant_id for the current authenticated user. SECURITY DEFINER + STABLE. Used in all tenant-scoped RLS policies. |
| `is_super_admin()` | BOOLEAN | Returns true if current user has role = 'super_admin' and is_active = true. Cross-tenant access. |
| `is_membership_exempt(p_user_id int)` | BOOLEAN | Returns true if the user is exempt from membership requirements: super_admin, a platform-root admin (`is_platform_root_tenant`, config-driven via `platform_root_slug()`), or a tenant with `require_subscription = false`. Used in billing access checks. |
| `has_basic_membership()` | BOOLEAN | Returns true if the current user has an active basic or premium membership. |
| `has_premium_membership()` | BOOLEAN | Returns true if the current user has an active premium membership. |
| `has_feature_access(p_feature_key)` | BOOLEAN | Returns true if the current user has a specific feature enabled via entitlements. |
| `provision_self_service_tenant(...)` | JSON | Atomically creates a self-service tenant + settings (all approvals off) + user record. Called via RPC from signup. SECURITY DEFINER. |
| `get_grant_owner(g_id)` | INT | Returns the integer user PK (`user_id`) from `grant_record` for the given grant ID. Used by notification triggers. |
| `get_admin_user_ids()` | SETOF INT | Returns all active admin user integer PKs. Used by notification triggers to notify all admins. |
| `get_grant_name(g_id)` | TEXT | Returns the grant name (or `'Grant #N'` fallback) for display in notification messages. |
| `calculate_grant_budget_totals(grant_id INT)` | TABLE | Returns count, total allocated, total spent, total remaining across all budget items for a grant. Not currently used in the frontend. |
| `get_invite_by_token(p_token text)` | TABLE | SECURITY DEFINER. Returns the single invite (id, tenant_id, role, email, used_at, expires_at, tenant_name) matching the token. anon + authenticated EXECUTE. Token-scoped — no enumeration. (`20260619140000`) |
| `consume_invite(p_token text, p_user_id uuid)` | BOOLEAN | SECURITY DEFINER. Stamps `used_by`/`used_at` for the invite matching the token, only if unused; enforces `p_user_id = auth.uid()`; idempotent. authenticated EXECUTE only. Returns whether a row was consumed. (`20260619170000`) |
| `platform_root_slug()` | TEXT | SECURITY DEFINER + STABLE. Returns the configured platform-root tenant slug from `platform_settings.platform_root_slug` (lower-cased; falls back to `'tfac'`). (`20260619130000`) |
| `is_platform_root_tenant(p_slug text, p_name text)` | BOOLEAN | SECURITY DEFINER + STABLE. True when the given tenant slug equals `platform_root_slug()`. Centralises the platform-root check for `enforce_membership_eligibility()` / `is_membership_exempt()`. (`20260619130000`) |
| `storage_object_tenant_id(p_name text)` | INT | IMMUTABLE. Returns the `tenant_id` encoded in a storage object's path (2nd folder segment), or NULL on a malformed/too-shallow path. Backs the tenant-scoped storage policies. (`20260619150000`) |
| `enforce_user_self_update_guard()` | TRIGGER | SECURITY DEFINER. Backs `trg_aa_enforce_user_self_update_guard` — see Triggers Summary. (`20260619120000`) |

---

## Storage Buckets

| Bucket | Public | Used by | Path format |
|--------|--------|---------|-------------|
| `receipts` | No | `AddExpenseModal.js` | `receipts/{tenant_id}/{grant_id}/{expense_id}/{timestamp}.{ext}` |
| `grant-documents` | No | `GrantAttachments.js` | `attachments/{tenant_id}/{grant_id}/{timestamp}-{filename}` |

Both buckets are private. Files are accessed via short-lived signed URLs (`createSignedUrl(path, 60)`).

**Storage RLS (tenant-scoped, `20260619150000`):** Read/insert/delete in both buckets require the object path's tenant segment to equal the caller's `current_tenant_id()` — i.e. `storage_object_tenant_id(name) = current_tenant_id()`, where the 2nd path folder is the owning `tenant_id`. Super admins keep tenant-agnostic **read** (`OR is_super_admin()`); writes stay on the tenant path. (Previously these policies only checked `auth.uid() IS NOT NULL`, so any authenticated user could touch any tenant's files.)
