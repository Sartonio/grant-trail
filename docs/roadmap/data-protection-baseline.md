# Data-Protection Baseline Assessment — GrantTrail

> **Scope: BASIC LEVEL.** This is an overview against basic cybersecurity /
> privacy hygiene. It is **NOT** a GDPR, PIPEDA, or SOC 2 certification, and it
> is not legal advice. **Analysis + documentation only — no code was changed.**
>
> Date: 2026-06-19 · Branch: off merged `main`.
> Everything below is derived from source; tables/columns cite
> `supabase/migrations/20260616000000_initial_schema.sql` (the schema snapshot)
> and `frontend/src/components/*`. Later migrations under
> `supabase/migrations/2026061912*–17*` are referenced for RLS posture.

---

## 1. PII Inventory

GrantTrail stores personal and financial data for nonprofit grant tracking. The
canonical PII record is `public.users`; authentication identity lives in
`auth.users` (Supabase-managed) and is linked via `users.user_id` (a `uuid`).

Sensitivity legend: **low** = not personally identifying on its own / internal
ID · **medium** = identifies a person or links to them · **high** = directly
identifying contact data, financial detail, or attached documents that may
contain arbitrary PII.

| Table.column | Data type | Sensitivity | Notes |
| --- | --- | --- | --- |
| `users.firstname` | varchar(50) | **high** | Real name. Collected at signup (`CompleteProfile.js`). |
| `users.lastname` | varchar(50) | **high** | Real name. |
| `users.email` | varchar(75) | **high** | Contact email; lower-cased on insert (`provision_self_service_tenant`, schema:790). Also duplicated in `auth.users`. |
| `users.phone_number` | varchar(20) | **high** | Required at signup (`CompleteProfile.js:52`). |
| `users.organization_name` | varchar(50) | medium | Org name; also seeds the tenant name/slug. |
| `users.tax_month` | integer (1–12) | medium | Tax/fiscal info; reporting-related, not a full tax ID. |
| `users.user_id` | uuid | medium | Auth identifier → `auth.users(id)`. The join key for all user data. |
| `users.role` / `is_active` | varchar / bool | low | Authorization metadata. |
| `auth.users.*` | (Supabase-managed) | **high** | Email, hashed password, sessions, last-sign-in, etc. Not in these migrations but the system of record for identity. |
| `tenants.name` / `slug` | varchar | medium | Org identity; slug derived from org name. |
| `tenant_settings.support_email` / `support_phone` | varchar | medium | Org contact info. |
| `platform_settings.default_support_email` / `default_support_phone` / `alert_webhook_url` | varchar / text | medium | Platform contact + outbound alert webhook (Slack-style). |
| `grant_record.grant_name` / `description` / `approval_notes` | varchar / text | medium | Free-text; may contain incidental PII. |
| `grant_record.grant_amount`, `disbursed_funds`, `total_spent`, `remaining_balance` | numeric(12,2) | **high** | Financial data per grantee. |
| `budget_items.item_name` / `description` / `budget_allocated` / `amount_spent` | varchar / text / numeric | **high** | Financial line items. |
| `expenses.item_name` / `amount_spent` / `expense_date` | varchar / numeric / date | **high** | Spending detail. |
| `receipts.receipt_files` | json | **high** | References to uploaded receipt files (Storage). Documents may contain arbitrary PII. |
| `grant_attachments.file_name` / `file_path` / `file_type` / `file_size` / `description` | varchar / text | **high** | Uploaded grant documents (proposals, budgets, reports) in the `grant-documents` bucket. Arbitrary PII possible. |
| `grant_comments.comment` | text | medium | Free-text user comments. |
| `grant_status_history.comment` | text | low–medium | Review notes. |
| `invites.email` / `token` | varchar / uuid | **high** | Invitee email + bearer token. Previously world-readable — see §5. |
| `notifications.title` / `message` | varchar / text | medium | May embed grant names / amounts. |
| `billing_customers.stripe_customer_id` | varchar(255) | **high** | Stripe customer ID (auth identifier into Stripe). |
| `subscriptions.stripe_customer_id` / `stripe_subscription_id` / `stripe_product_id` / `stripe_price_id` / `metadata` | varchar / jsonb | **high** | Stripe billing identifiers + arbitrary metadata. |
| `billing_webhook_events.payload` | jsonb | **high** | Raw Stripe webhook payloads — can contain names, emails, partial card/billing data. |
| `audit_log.old_values` / `new_values` / `changed_by` | jsonb / uuid | **high** | Full row snapshots of changes (incl. `users` rows → names, emails, phones). Effectively a second copy of PII. |
| `system_logs.error_message` / `error_stack` / `metadata` | text / jsonb | medium | Error data; may incidentally capture PII. |

**Object storage (not in SQL):** two buckets — `grant-documents`
(`GrantAttachments.js`) and `receipts`. Both hold user-uploaded files that are
high-sensitivity by nature and accessed via short-lived signed URLs
(`createSignedUrl(..., 60)`, `GrantAttachments.js:139`).

**Highlight:** the highest-risk stores are (a) `users` + `auth.users` (direct
contact PII), (b) the two storage buckets (arbitrary documents), and (c) the
"shadow copies" of PII in `audit_log`, `billing_webhook_events`, and
`notifications` — these are easy to overlook in any export/erasure design.

---

## 2. Data-Subject Posture

### Can a user export their own data?
**Partially.** There is no general "download all my personal data" endpoint.
What exists is feature-scoped reporting:

- **CSV export** of expenses — `ExpenseReports.js:225` (`downloadCSV`, client-side `Blob`).
- **Excel export** of expenses — `ExpenseReports.js:244` (`downloadExcel`, gated by the `EXCEL_EXPORT` feature entitlement; uses the `xlsx` lib flagged in `security-hygiene.md`).

These cover **grant/expense financial data only**. They do **not** export the
user's profile record (`users` row), uploaded attachments/receipts, comments,
notifications, or billing identifiers. So a data-subject access request cannot
be fully satisfied self-service today.

### Can an account be deleted, and what happens to records?
**There is no account-deletion flow** anywhere in the frontend or edge
functions (no `auth.admin.deleteUser`, no "delete account" UI, no soft-delete
toggle found). The only lifecycle control is `users.is_active` (deactivation),
which hides but does not remove data.

If a deletion *were* performed, the schema's FK behavior determines the outcome:

- **`users.user_id` → `auth.users(id)` has NO `ON DELETE` clause** (schema:2316),
  i.e. default `RESTRICT`. **Deleting the `auth.users` row is BLOCKED** while a
  `public.users` row references it. This is the key structural gap: you cannot
  cleanly delete an identity from the bottom up.
- Deleting a **`public.users`** row **cascades** to the user's owned data:
  `grant_record`, `receipts`, `notifications`, `subscriptions`,
  `billing_customers`, `user_memberships`, `feature_entitlements`
  (all `ON DELETE CASCADE`, schema:2151–2306). Grants cascade further to
  `budget_items`, `expenses`, `grant_attachments`, `grant_comments`,
  `grant_status_history` (all CASCADE off `grant_record`).
- **Orphans / retained references:** columns pointing at `auth.users` for
  *attribution* are **not** cascaded and have no `ON DELETE` —
  `audit_log.changed_by`, `grant_record.reviewer_id`,
  `grant_status_history.changed_by`, `grant_attachments.uploaded_by`,
  `invites.created_by/used_by`, `grant_comments.user_id`. These keep pointing at
  the auth identity and would block/raise on auth-row deletion.
- **`audit_log` survives** the cascade in content terms: it is keyed by
  `tenant_id` (CASCADE on tenant, not on user), so deleting a single user does
  **not** remove the historical `to_jsonb(OLD)` snapshots of that user's rows
  (names/emails/phones) already written into `audit_log` by the
  `log_users_changes` trigger.
- **Storage objects** in the `grant-documents` / `receipts` buckets are **not**
  deleted by any DB cascade — removing DB rows leaves the files behind unless
  separately purged.

**Gaps:** no erasure mechanism; auth-row deletion is structurally blocked;
audit-log and storage-bucket PII would survive a naive user-row delete; no
self-service profile export.

---

## 3. Retention

**No explicit retention policy exists.** There are no TTL columns, scheduled
purges, cron jobs, or `pg_cron` retention tasks in the migrations. Data that
accumulates indefinitely with no defined lifetime:

- `audit_log` — grows on every insert/update/delete of `users`, `grant_record`,
  `budget_items`, `expenses` (4 triggers), storing full row snapshots.
- `billing_webhook_events` — every Stripe webhook payload, kept forever.
- `system_logs`, `grant_status_history`, `notifications`, `invites` (including
  expired/used invites with emails).

**Recommended baseline stance (basic level):**
1. Publish a short written retention statement (even one paragraph): how long
   profile, financial, audit, and webhook data are kept and why.
2. Set a concrete TTL for the high-volume, high-PII logs — e.g. `audit_log` and
   `billing_webhook_events` to 12–24 months — and purge with a scheduled job.
3. Purge **expired/used `invites`** (they carry emails + bearer tokens) on a
   short cycle, e.g. 30 days past `expires_at`/`used_at`.
4. Define what "account closure" means for retained financial records (which
   nonprofits may be legally required to keep) vs. erasable contact PII.

---

## 4. Secrets / Key Handling (summary)

Covered in detail in **`docs/roadmap/security-hygiene.md`** — see that document
for the authoritative findings. In short: Stripe and Supabase service keys are
handled server-side in the edge functions under `supabase/functions/`; the
client uses the anon key + RLS as the boundary. The `alert_webhook_url` in
`platform_settings` drives outbound `pg_net` HTTP calls
(`handle_critical_log_alert`, schema:252) and should be treated as sensitive
config. Refer to `security-hygiene.md` for the dependency-scan results (notably
the flagged `xlsx` advisory used by the Excel export) and key-rotation notes.

---

## 5. Access Boundaries

**Row-Level Security (RLS) is the enforcement layer**, not the frontend route
guards — see `docs/roadmap/role-matrix.md`, which documents the
`super_admin` / `admin` / `grantee` roles and states explicitly that React route
guards are not a security boundary while Postgres RLS is. Tenancy is enforced
via `current_tenant_id()` (schema:125) and per-table `tenant_id` scoping, with
role checks through `is_admin()` / `is_super_admin()`. The recent hardening pass
(documented in `docs/roadmap/rls-audit.md`) closed several genuine gaps in
forward migrations: a **vertical privilege-escalation** hole where users could
update their own `role` (`20260619120000_rls_audit_fix_privilege_escalation`), a
**world-readable `invites`** table leaking every token + email to `anon`
(`20260619140000_invites_token_scoped_read`), and **tenant-blind storage
objects** where any authenticated user could read/overwrite another org's
uploaded files (`20260619150000_storage_tenant_scoping`). These fixes
substantially tighten the access boundary, but data-subject tooling (export /
erasure) still sits outside this layer.

---

## 6. Prioritized Gap List (basic baseline)

Ordered by risk-reduction per unit effort. Effort is rough: **S** ≈ <1 day,
**M** ≈ a few days, **L** ≈ a week+.

| # | Recommendation | Effort | Why |
| --- | --- | --- | --- |
| 1 | **Add an account-deletion / erasure flow** (admin or self-service) that deletes the `public.users` row, removes the matching `auth.users` identity, and purges the user's objects in both storage buckets. | **M** | No deletion path exists today and `auth.users` deletion is structurally blocked (§2). This is the single biggest data-protection gap. |
| 2 | **Decide & implement audit-log treatment on erasure** — redact/anonymize `audit_log` snapshots and `notifications`/`webhook` PII for a deleted user, or document why they're retained. | **M** | Cascading the user row leaves PII copies behind in `audit_log` and webhook payloads (§2), defeating erasure. |
| 3 | **Add a self-service "export my data" endpoint** covering the `users` profile, grants/budget/expenses, receipts/attachments metadata, comments, and notifications — not just expense CSV/Excel. | **M** | Current exports are financial-only (`ExpenseReports.js`); cannot satisfy a full data-access request. |
| 4 | **Write a retention policy + add TTL purges** for `audit_log`, `billing_webhook_events`, and expired/used `invites`. | **S–M** | No retention exists; high-PII tables grow unbounded (§3). Invites carry live tokens + emails. |
| 5 | **Storage-object lifecycle on record delete** — ensure deleting a grant/receipt row also removes the underlying bucket objects. | **S** | DB cascades don't touch Storage; files orphan with PII intact (§2). |
| 6 | **Publish a short privacy/data-handling note** (what's collected, why, retention, contact for requests). | **S** | Basic transparency hygiene; pairs with #3/#4. |
| 7 | **Scrub `system_logs` / error payloads** of incidental PII before persistence. | **S** | `error_message`/`metadata` can capture user data unintentionally. |

> Items 1–3 are the core "data-subject rights" gaps; 4–7 are supporting hygiene.
> None require framework certification — they bring the app to a defensible
> basic baseline.
