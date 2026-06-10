# GrantTrail — Stage-by-Stage Changelog

Each entry covers what was built or changed between one tagged stage and the next. Tags correspond to git commits and can be compared with `git diff stage-N stage-M`.

---

## Stage 1 — Initial Commit

**Tag:** `stage-1`: *Initial Commit*

First commit. Established the repo skeleton.

**Added:**
- `backend/` — individual SQL scripts for each table (Grantee, Grant, Grant Items, Receipts), trigger functions, role setup, and test queries
- `frontend/` — Create React App scaffold (`package.json`, `public/`, `src/`)
- `.vscode/settings.json`
- ER diagram PDFs (v1 and v2)

---

## Stage 2 — CSS Refactor: Sign-In, Header, Footer

**Tag:** `stage-2`: *CSS changes to Sign-in, Header, Footer, & Main*

Visual foundations laid out. Backend scripts consolidated.

**Backend:**
- Replaced the seven individual table scripts with a single `00-Complete-Database-Setup.sql`
- Added sample data scripts: `01-Insert-Sample-Data.sql`, `02-Add-New-User-and-Connect-to-Grantee.sql`, `03-Add-Sample-Grants-Expenses-For-User.sql`

**Frontend — new files:**
- `styles/variables.css` — CSS custom properties (colors, spacing, typography)
- `styles/global.css` — base element resets
- `styles/utilities.css` — utility classes
- `styles/Forms.css` — shared modal/form styles
- `styles/Login.css` — auth page styles
- `components/Header.css`, `components/Footer.css` — component-scoped styles
- `components/Main.css` — dashboard page styles
- `components/Grants.css`, `components/ExpenseReports.css` — page CSS stubs

**Frontend — changed:**
- `Login.js` — substantially rewritten to use the new CSS system
- `Footer.js` — updated markup
- `App.css` — gutted; most styles moved to component/shared files
- Logo and favicon assets replaced with TFAC branding

---

## Stage 3 — Header & Icon Tweaks

**Tag:** `stage-3`: *Minor changes since previous tag/commit. Use this instead of Stage-2*

Minor polish after Stage 2.

**Changed:**
- `Header.js` — icon imports adjusted, nav structure refined
- `Header.css` — spacing and active-link styles
- `App.css` — small layout corrections

---

## Stage 4 — Grants Cards, Expenses Views, React Icons

**Tag:** `stage-4`: *Grants page now has cards, Expenses has two views, and added some react-icons. New expense item, new grant item, and breakdown not yet done.*

First real feature work. Core grantee pages wired up.

**Docs added:**
- `docs-tfac/` folder created — TFAC logo assets, color palette screenshot, feature request document, product description, proposal PDF

**Frontend — new files:**
- `components/AddExpenseModal.js` — modal for adding/editing expenses
- `components/CreateGrant.js` + `CreateGrant.css` — new grant submission form
- `components/GrantBreakdown.css` — styles for the grant detail/breakdown page

**Frontend — major rewrites:**
- `Grants.js` / `Grants.css` — grant list with card layout, filter/search
- `ExpenseReports.js` / `ExpenseReports.css` — expenses table with two-view toggle

**Package:**
- `react-icons` added

---

## Stage 5 — Grant Breakdown Page + Login Fix

**Tag:** `stage-5`: *Grant breakdown completed. New expense item and new grant item are not yet done.*

**Changed:**
- `App.js` — route added for `/grants/:id/breakdown`
- `GrantBreakdown.js` — substantially expanded: fetches budget items and expenses, renders collapsible sections, first working version of the budget/expense drill-down view

---

## Stage 6 — Add Expense Works End-to-End

**Tag:** `stage-6`: *New expense item works. New grant item not yet done*

Bug fixes and CSS polish to make expense creation functional.

**Changed:**
- `styles/Forms.css` — modal layout fixes, input/button styling
- `GrantBreakdown.css` — expense row styles
- `CreateGrant.css` — minor spacing fixes
- `components/ActionCard.js` — empty placeholder added (not yet used)

---

## Stage 7 — Add Grant Works End-to-End

**Tag:** `stage-7: *Add new Grant works. Receipts not yet done*

**Changed:**
- `App.js` — route for `/grants/new` wired up
- `Main.js` — grantee dashboard expanded: stat cards, link to create grant
- `Main.css` — dashboard layout styles

---

## Stage 10 — New Database Schema, Login Works

**Tag:** `stage-10`: *New DB with sample data. Login works.*

Major database redesign. Moved from *grantee* to *users* and from *grant_items* to *expenses*. All frontend queries updated to match.

**Backend — replaced:**
- Old fragmented scripts removed
- New `06-Complete-Fresh-Setup.sql` — single script creates all tables, triggers, RLS policies, and storage buckets
- `07-Sample-Data.sql` — 3 grantees, 6 grants with budget items and expenses
- `08-Large-Sample-Data.sql` — 50+ grants for one user (Alex Tan), for chart/performance testing
- `09-Full-Teardown.sql` — safe drop of everything
- `10-After-User-Creation.sql` — links Supabase Auth UUIDs to `users` table rows after manual account creation

**Key schema changes:**
- `grantee` table renamed to `users`; `grantee_id` columns renamed to `user_id`
- `grant_items` table renamed to `expenses`
- Status values changed: `Pending/Approved/Rejected` → `pending/approved/needs_changes/rejected`
- `grant_record.grant_name` column added

**Frontend — new:**
- `components/BudgetItemModal.js` — modal for adding/editing budget line items

**Frontend — updated:**
- `App.js`, `Login.js`, `SignUpClean.js`, `Main.js`, `Grants.js`, `GrantBreakdown.js`, `ExpenseReports.js`, `AddExpenseModal.js`, `Header.js`, `hooks/useGrantee.js` — all queries and column references updated to match new schema

---

## Stage 11 — Grants, Budgets, Expenses CRUD Complete

**Tag:** `stage-11`: *Grant,Budget,Expense creation works with new schema.*

The core grantee data-entry workflows are fully functional.

**Backend:**
- `06-Complete-Fresh-Setup.sql` refined (additional triggers and constraints)
- `08-Refactor-Expenses-Schema.sql` — migration patch for the expenses table column refactor

**Frontend:**
- `GrantBreakdown.js` — fully restructured: collapsible budget item sections, expenses nested per item, Add/Edit/Delete on both budget items and expenses, status badges
- `AddExpenseModal.js` — reworked to match new expenses schema (removed old columns)
- `components/ConfirmDialog.js` — reusable confirmation dialog (used for deletes)
- `ExpenseReports.js` — updated column references
- `styles/Forms.css` — additional modal styles

---

## Stage 12 — Brand Colors, Fonts, Admin Pages

**Tag:** `stage-12`: *Brand choice color palette & fonts. Admin pages are working.*

Visual identity locked in. Admin portal built.

**Frontend — new:**
- `components/Admin.css` — shared styles for all admin pages
- `components/AdminDashboard.js` — admin home: stat cards (total grants by status, funding totals), review queue list
- `components/AdminGrantList.js` — paginated table of all grants across all grantees
- `components/AdminGrantReview.js` — single grant review page: status change dropdown, approval notes, comments, status history timeline
- `components/GrantDetail.js` + `GrantDetail.css` — grantee-facing single grant overview: status history timeline, admin comments (read-only), grant amounts/dates
- `components/StatusBadge.js` — reusable status pill (color-coded for all four statuses)

**Frontend — updated:**
- `App.js` — role-based routing: admins go to `/admin/*`, grantees go to `/`
- `Header.js` — role-conditional nav links (admin vs. grantee)
- `Grants.js` / `Grants.css` — polished card layout
- `ExpenseReports.js` / `ExpenseReports.css` — restyled to match brand
- `SignUpClean.js` — full sign-up form with organization and phone fields
- `styles/variables.css` — brand colors locked in: deep green `#063F1E`, heritage gold `#D89F01`, Libre Baskerville / Montserrat fonts

---

## Stage 15 — Receipts, Grant Documents, Two-View Grants List

**Tag:** `stage-15`: *Admin, Receipts, and Grant docs done. Updated views for Grantee, Admin.*

File uploads fully implemented. Grantee UI polished.

**Frontend — new:**
- `components/GrantAttachments.js` + `GrantAttachments.css` — upload, view, and delete supporting documents (proposals, budget plans, reports) for a grant; category badges; inline confirm-delete; integrated into both `GrantDetail.js` (grantee) and `AdminGrantReview.js` (read-only)

**Frontend — updated:**
- `AddExpenseModal.js` — receipt upload added inline: required for new expenses, optional for edits; uploads to Supabase Storage `receipts/` bucket; compensating delete if upload fails
- `GrantBreakdown.js` — receipt display in expense rows
- `GrantDetail.js` / `GrantDetail.css` — attachments section integrated
- `Grants.js` / `Grants.css` — two-view toggle (card view / table view) added
- `styles/Forms.css` — file input and upload progress styles

---

## Stage 16 — Charts, Updated DB Scripts

**Tag:** `stage-16`: *Charts done. DB scripts updated.*

Data visualization added throughout the app. Backend scripts cleaned up.

**Package:**
- `recharts 3.7.0` added

**Frontend — new:**
- `styles/Charts.css` — shared chart card wrapper styles

**Frontend — charts added to:**
- `Main.js` — Grants by Status donut + Total Funding vs. Spent bar
- `AdminDashboard.js` — Grants by Status donut + Top Grantees by Funding horizontal bar
- `ExpenseReports.js` — Monthly Spending bar + Spending by Grant donut (top 8 + "Other")
- `GrantBreakdown.js` — Budget Allocation donut + Budgeted vs. Spent horizontal bar
- `GrantDetail.js` — Spent vs. Remaining donut (alongside status history)

**Frontend — other:**
- `BudgetItemModal.js` — allocation cap validation: new item cannot push total over grant amount

**Backend:**
- `07-Sample-Data.sql`, `08-Large-Sample-Data.sql` — expense column references fixed to match current schema
- `09-Full-Teardown.sql` — phantom tables/functions removed
- `11-Randomize-Expense-Dates.sql` — new dev utility: spreads expense dates across grant spend periods for better chart data
- Logo assets renamed for consistency

---

## Stage 20 — DB Scripts Renamed, Developer Docs Added

**Tag:** `stage-20`: *Dev docs added. DB scripts renamed.*

No functional changes. Housekeeping and documentation sprint.

**Backend — renamed:**
| Old | New |
|-----|-----|
| `06-Complete-Fresh-Setup.sql` | `01-Complete-Fresh-Setup.sql` |
| `07-Sample-Data.sql` | `02-Sample-Data.sql` |
| `08-Large-Sample-Data.sql` | `03-Large-Sample-Data.sql` |
| `09-Full-Teardown.sql` | `04-Full-Teardown.sql` |
| `10-After-User-Creation.sql` | `05-After-User-Creation.sql` |
| `11-Randomize-Expense-Dates.sql` | `06-Randomize-Expense-Dates.sql` |

**Docs added (`docs-tfac/`):**
- `01-Dev-Onboarding.md` — local setup, project structure, routing, auth, key workflows
- `02-React-Supabase-Patterns.md` — how Supabase queries are structured, session object, common patterns
- `03-Deployment-Ftp.md` — production build and FTP deployment guide
- `04-Database-Schema.md` — full table/column/trigger reference
- `05-Supabase-Setup.md` — step-by-step Supabase project setup from scratch
- `06-Troubleshooting.md` — common problems and their fixes
- `07-Er-Diagram.md` — entity-relationship diagram in Mermaid

---

## Stage 25 — Budget/Expense Approval Workflows, Grants that 'Needs-Changes' Flow, Forgot Password

**Tag:** `stage-25`: *Budget/Expense approval flows done. Admin approving these also done.'Needs-Changes' grants can be edited and resubmitted. Forgot pwd flow implemented. DB scripts updated.*

Major feature additions: password reset, grant re-submission, and admin approval of individual budget items and expenses.

**Frontend — Login:**
- `Login.js` — forgot password flow added: email input, Supabase `resetPasswordForEmail`, success/error feedback

**Frontend — Grantee:**
- `CreateGrant.js` — grants in `needs_changes` status can now be edited and re-submitted; form pre-fills with existing values; re-submission resets status to `pending`
- `Grants.js` — "Edit & Resubmit" action shown on needs-changes grants
- `Main.js` — dashboard stat cards updated; "Needs Changes" count added
- `ExpenseReports.js` — receipt display refactored (Set-based lookup replacing count map)

**Frontend — Admin:**
- `AdminGrantReview.js` — Budget & Expense Review section added: approve/reject individual budget items and expenses; status badge per item; cascades (reject budget item → resets its expenses to pending)
- `AdminDashboard.js` — review queue and stat cards expanded; Needs Changes card added
- `AdminGrantList.js` — table columns and filtering improved
- `Admin.css` — approval action buttons, status columns, review section styles

**Frontend — Shared:**
- `StatusBadge.js` — `needs_changes` style added ("Needs Changes" label, amber color)
- `GrantBreakdown.js`, `GrantDetail.js` — minor layout/style updates

---

## Stage 26 — Audit Log

**Tag:** `stage-26`: *Audit Log implemented for Admins.*

Full audit log viewer for admins. Database trigger fix for noisy entries.

**Backend:**
- `01-Complete-Fresh-Setup.sql` — no-op UPDATE guard added to `log_grant_record_changes()` and `log_budget_items_changes()` trigger functions: `IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NULL; END IF;` — prevents spurious audit entries when totals triggers fire but values haven't changed
- `02-Sample-Data.sql`, `03-Large-Sample-Data.sql` — expense insert statements corrected
- `05-After-User-Creation.sql` — sample admin comments added

**Frontend — new:**
- `components/AdminAuditLog.js` — audit log viewer at `/admin/audit`:
  - Paginated table (50 rows per page, Prev/Next, "Showing X–Y of Z" count)
  - Server-side filters: Table (Grant / Budget Item / Expense), Action (INSERT / UPDATE / DELETE), date range
  - Opacity-dimming while filtering (existing data stays visible, no full-page reload)
  - Click any row to expand an inline diff view (lazy JSONB fetch, cached per row)
  - Diff view: shows only changed fields for UPDATEs; full field list for INSERTs and DELETEs; skips `updated_at` noise
- `components/Admin.css` — audit log table, filter bar, action badges, diff table, pagination styles

**Frontend — updated:**
- `App.js` — `/admin/audit` route added
- `Header.js` — "Audit Log" nav link added to admin navigation
- `AdminDashboard.js` — "Audit Log" secondary button added to dashboard header

**Docs updated:**
- `01-Dev-Onboarding.md`, `04-Database-Schema.md`, `05-Supabase-Setup.md`, `06-Troubleshooting.md` — updated to reflect audit log page, status columns on budget_items/expenses, trigger no-op guard, and approved-only totals behavior

---

## Stage 27 — Audit Log Enhancements, Profile Dropdown, Pending Spend in Chart

**Frontend — updated:**
- `AdminAuditLog.js` — pagination added (50 rows per page, Prev/Next, "Showing X–Y of Z" count); server-side range query replaces 100-row hard limit; all filters reset page to 0 on change; "View Grant" link added inline on audit rows where `table_name = 'grant_record'` (non-DELETE) or `table_name = 'expenses'` (resolved via batch lookup); record ID cell uses flex layout to left-align `#N` and right-align the link
- `Admin.css` — pagination styles (`.audit-pagination`, `.audit-page-btn`, `.audit-page-info`); "View Grant" pill styles (`.audit-grant-link`); flex layout on `.audit-record-id`
- `Header.js` — logout buttons replaced with a profile icon (`FiUser`) + dropdown menu; admin dropdown contains Audit Log link + Logout; grantee dropdown contains Logout only; dropdown shows user's full name and role/org; closes on click-outside via `mousedown` listener; Audit Log removed from admin main nav
- `Header.css` — removed `.logout-button` block; added profile dropdown styles: trigger button, chevron rotation animation, dropdown panel, header section, menu items, red logout item
- `GrantBreakdown.js` — "Budgeted vs Spent" bar chart now shows a third gold bar (`#D89F01`) for pending expenses per budget item, alongside the existing green Allocated and gray Approved Spent bars

**Docs updated:**
- `docs-tfac/08-Stage-Changelog.md` — stage entries added through Stage 26

---

## Stage 28 — User Management, Account Lockout, Users Audit Logging

**Backend — updated (`01-Complete-Fresh-Setup.sql`):**
- `users` table: `is_active BOOLEAN DEFAULT true NOT NULL` column added — controls app-level account lockout
- `is_admin()` function updated: now also requires `is_active = true` — a disabled admin is locked out of all admin-gated RLS policies
- New `"Admins can update users"` UPDATE policy: allows admins to change `role` and `is_active` on any user row
- `log_users_changes()` trigger function added: writes INSERT / UPDATE / DELETE events on the `users` table to `audit_log`; skips no-op UPDATEs inside the function body
- `trg_audit_users` trigger added: fires `log_users_changes()` after every INSERT, UPDATE, or DELETE on `users`

**Frontend — new:**
- `components/AdminUserList.js` — user management page at `/admin/users`:
  - Stat cards: Total Users, Admins, Grantees, Disabled
  - Client-side search by name, email, or organization
  - Table with role pills (blue admin / gray grantee), status pills (green Active / red Disabled), linked indicator (auth UUID present or not), and joined date
  - Role toggle (Grantee ↔ Admin) with two-click inline confirm
  - Enable / Disable toggle with two-click inline confirm
  - Own-row guard: the logged-in admin cannot act on their own account

**Frontend — updated:**
- `App.js` — `is_active` lockout: on login and on page load, if `userRecord.is_active = false` the session is signed out and an "Account Disabled" full-page message is shown; `handleLogin({ user, userRecord })` function extracted to centralize this check; `/admin/users` route added
- `Header.js` — "Users" link (`FiUsers` icon) added to the admin profile dropdown between Audit Log and Logout
- `AdminAuditLog.js` — "User" option added to the Table filter dropdown; `TABLE_LABELS` map updated with `users: 'User'`
- `Admin.css` — user management styles added: `.user-row-disabled`, `.user-role-pill` variants, `.user-status-pill` variants, `.user-linked-yes/no`, `.user-self-badge`, `.user-actions-cell`, `.user-action-btn` variants (role, disable, enable, confirm, cancel), `.user-confirm-group`

**Docs updated:**
- `04-Database-Schema.md` — `users` table updated with `is_active` column; `is_admin()` note updated; `trg_audit_users` added to triggers table; `audit_log` scope note updated
- `01-Dev-Onboarding.md` — `/admin/users` route added; `AdminUserList.js` added to project structure; user management workflow added

---

## Stage 29 — End-User Documentation

**Docs added (`docs-tfac/`):**
- `09-Grantee-Guide.md` — full grantee user guide: sign-up, dashboard, submitting grants, grant status lifecycle (Mermaid flowchart), budget items, logging expenses, uploading receipts and attachments, expense reports
- `10-Admin-Guide.md` — full administrator guide: dashboard, grant review workflow (Mermaid flowchart), approving/rejecting budget items and expenses with cascade rules (Mermaid flowchart), user management, audit log usage
- `11-Quick-Reference.md` — role-specific quick reference cards: "I want to… / Where to go / What to do" table for both grantees and admins; status meanings, file upload limits, spending totals rule, cascade rule, linked indicator key

---

## Stage 30 — Future Architecture Design Docs

No code or database changes. Design documentation for planned architectural work.

**Docs added (`docs-tfac/`):**
- `12-Future-Multi-Tenancy.md` — design spec for supporting multiple independent organizations: new `tenants` and `tenant_settings` tables, `tenant_id` column on every application table, full RLS policy rewrite with tenant isolation, two implementation options (`current_tenant_id()` look-up vs. JWT custom claim hook), storage path prefixes, platform admin role, and invite-based onboarding
- `13-Future-Approval-Config.md` — design spec for making approval workflows optional: single-row `app_settings` table, BEFORE INSERT trigger auto-approval for grants/budget items/expenses, component-by-component UI impact across 8 components, new `/admin/settings` page
- `14-Future-Two-Tier-SaaS.md` — design spec for a two-tier deployment (depends on docs 12 + 13): **managed** tenant (invite-based signup, full approval workflows, admin role) vs. **self-service** tenant (open signup auto-provisions tenant, approvals always off, no admin role); covers `enforce_self_service_role()` trigger, Edge Function auto-provisioning, and platform admin tenant management

**Docs updated:**
- `01-Dev-Onboarding.md` — "Future Development" section added (Section 12) with a table pointing to docs 12, 13, and 14 and a note that they are design specs only, no implementation yet

---

## Stage 31 — Logo & Font Standardization

**Tag:** `stage-31`

Replaced branding assets and enforced approved fonts across all UI elements.

**Changed:**
- Replaced header logo in `Header.js` — now references `/logo.png`
- Replaced favicon (`gt-favico.ico`) and updated references in `index.html` and `manifest.json`
- Replaced `logo192.png` and `logo512.png` with new branding
- Removed old logo files from `frontend/public/` and `docs-tfac/`
- Standardized all fonts to approved design tokens from `variables.css`:
  - Added `font-family: var(--font-body)` to `input`, `textarea`, `select`, `button` in `global.css`
  - Replaced hardcoded system font stack in `index.css` with `var(--font-body)`
  - Replaced `var(--font-mono, monospace)` references in `Admin.css` with `var(--font-body)`
  - Changed `code` element font from monospace to `var(--font-body)` in `index.css`

---

## Stage 32 — In-App Notifications & Tax Month Reminder

**Tag:** `stage-32`

Added a full in-app notification system with realtime updates and a tax month reminder banner on the grantee dashboard.

**Database (`backend/`):**
- Added `notifications` table (10th table) with RLS policies, indexes, and Supabase Realtime enabled
- Added 3 helper functions: `get_grant_owner()`, `get_admin_user_ids()`, `get_grant_name()`
- Added 5 notification trigger functions:
  - `notify_grant_status_change()` — notifies grantee on grant approved/rejected/needs_changes
  - `notify_grant_submitted()` — notifies all admins on new grant or resubmission
  - `notify_budget_item_status()` — notifies grantee on budget item approved/rejected
  - `notify_expense_status()` — notifies grantee on expense approved/rejected
  - `notify_grant_comment()` — notifies grantee when admin adds a comment
- Added `tax_month` column (INT, 1–12) to `users` table
- Updated `01-Complete-Fresh-Setup.sql` with all of the above (now 7 sections)
- Updated `04-Full-Teardown.sql` to drop notifications table and all notification functions
- Updated `02-Sample-Data.sql` with `tax_month` values for sample users

**Frontend:**
- New `NotificationBell.js` + `NotificationBell.css` — bell icon with unread badge, dropdown panel, click-to-navigate, mark-as-read, mark-all-as-read, clear-all
- Updated `Header.js` — added notification bell between nav links and profile menu
- Updated `App.js` — fetches notifications on login, subscribes to Supabase Realtime for live updates, passes notification state and handlers to Header
- Updated `SignUpClean.js` — added "Tax Filing Month" dropdown (optional, 1–12)
- Updated `Login.css` — added `select` styling to match input fields
- Updated `Main.js` — removed "needs changes" banner, added tax month reminder banner (shows 30 days before tax month, dismissible with X)
- Updated `Main.css` — removed banner CSS, added tax month alert CSS

**Bug fix:**
- Fixed budget item and expense approve/reject buttons in `AdminGrantReview.js` — added error handling with `.select()` to detect silent RLS failures, added `approvalError` state with visible error display in the Budget Items section

**Docs updated:**
- `CLAUDE.md` — 9→10 tables, added `notifications` to table list and hierarchy, updated known gaps
- `01-Dev-Onboarding.md` — added `notifications` to database tables list, noted `tax_month` on users
- `04-Database-Schema.md` — added `notifications` table section, `tax_month` column to users, notification triggers and helper functions to summaries
- `05-Supabase-Setup.md` — 9→10 table count in setup and verification
- `07-Er-Diagram.md` — added `notifications` entity, `is_active`/`tax_month` to users, relationship and auto-calculated columns
- `12-Future-Multi-Tenancy.md` — 9→10 table count for tenant_id scope

---

## Stage 33 — Multi-Tenancy: Schema & Tenant Isolation

**Tag:** `stage-33`

Foundation for multi-tenant architecture. Adds tenant tables, `tenant_id` column to all application tables, tenant-scoped RLS policies, and helper functions. Implements Doc 12 (Multi-Tenancy) schema layer.

**Database (`backend/`):**
- New `tenants` table (id, name, slug)
- New `tenant_settings` table (per-tenant approval workflow flags)
- Added `tenant_id` column (NOT NULL FK) to all 10 application tables: `users`, `grant_record`, `budget_items`, `expenses`, `receipts`, `grant_attachments`, `grant_status_history`, `grant_comments`, `audit_log`, `notifications`
- Added indexes on `tenant_id` for all tables
- New `current_tenant_id()` function — returns tenant_id for current auth user (SECURITY DEFINER, STABLE)
- New `is_super_admin()` function — cross-tenant admin check
- Updated `is_admin()` to include tenant scope
- New tenant_id auto-populate triggers:
  - `set_grant_tenant_id()` — copies from user on grant INSERT
  - `set_tenant_from_grant()` — copies from parent grant for budget_items, expenses, receipts, attachments, status history, comments
  - `set_notification_tenant_id()` — copies from target user
  - `set_audit_log_tenant_id()` — extracts from JSONB values
- Updated `notify_grant_submitted()` to only notify admins in the same tenant
- All RLS policies rewritten with `tenant_id = current_tenant_id()` isolation
- New RLS policies for `tenants` and `tenant_settings` tables
- Role CHECK constraint updated: `('admin', 'grantee', 'super_admin')`
- Table count: 10 → 12
- `01-Complete-Fresh-Setup.sql` fully rewritten (now 12 tables, 7 sections)
- `02-Sample-Data.sql` creates default TFAC tenant with settings
- `04-Full-Teardown.sql` updated for new tables and functions

**Frontend:**
- `App.js` — session now includes `tenantConfig` fetched from `tenant_settings` on login
- `SignUpClean.js` — assigns new users to default tenant (temporary; will be replaced by invite flow)

**Docs updated:**
- `CLAUDE.md` — 10→12 tables, updated hierarchy, added super_admin role
- `08-Stage-Changelog.md` — Stage 33 entry

---

## Stage 34 — Multi-Tenancy: Tenant-Scoped Storage Paths

**Tag:** `stage-34`

Updated all storage upload paths to include `tenant_id` prefix for tenant isolation in Supabase Storage buckets.

**Frontend:**
- `AddExpenseModal.js` — receipt upload path changed from `receipts/{grantId}/{expenseId}/{ts}.{ext}` to `receipts/{tenantId}/{grantId}/{expenseId}/{ts}.{ext}`
- `GrantAttachments.js` — attachment upload path changed from `attachments/{grantId}/{ts}-{filename}` to `attachments/{tenantId}/{grantId}/{ts}-{filename}`
- Signed URL and delete operations unchanged — they read stored paths from the database

**Docs updated:**
- `CLAUDE.md` — updated storage path patterns, updated multi-tenancy progress

**Testing checklist for multi-tenant verification (to be run after Stage 37):**
- [ ] Create two tenants via SQL or platform admin UI
- [ ] Create users in each tenant (grantee + admin)
- [ ] Log in as Tenant A grantee — verify only Tenant A grants visible
- [ ] Log in as Tenant B grantee — verify only Tenant B grants visible
- [ ] Log in as Tenant A admin — verify only Tenant A data in admin views
- [ ] As Tenant A admin, approve a grant — verify Tenant B data untouched
- [ ] As Tenant A grantee, upload a receipt — verify storage path includes tenant_id
- [ ] As Tenant A grantee, upload a grant attachment — verify storage path includes tenant_id
- [ ] Verify notifications only go to same-tenant admins
- [ ] Verify audit log shows only same-tenant entries
- [ ] Log in as super_admin — verify cross-tenant visibility
- [ ] Verify signup assigns correct tenant_id to new user
- [ ] Generate invite link — use it to sign up — verify user gets correct tenant and role

---

## Stage 35 — Multi-Tenancy: Invite-Based User Onboarding

**Tag:** `stage-35`

Added invite link system for onboarding new users into managed tenants.

**Database (`backend/`):**
- New `invites` table: token (UUID), tenant_id, role, email (optional), created_by, used_by, used_at, expires_at (7-day default)
- RLS: anyone can read invites by token (needed during signup), admins can create/view invites for their tenant, system can update (mark as used)
- Table count: 12 → 13
- Updated `01-Complete-Fresh-Setup.sql` and `04-Full-Teardown.sql`

**Frontend:**
- `SignUpClean.js` — rewritten to support invite tokens:
  - Reads `?invite=<token>` from URL on mount
  - Validates token (exists, not used, not expired)
  - Shows tenant name and assigned role on the signup form
  - Pre-fills and locks email if invite specifies one
  - Uses invite's tenant_id and role for user creation
  - Marks invite as used after successful signup
  - Falls back to default tenant for open signup (no invite)
- `AdminUserList.js` — added invite generation:
  - "Invite User" button in page header
  - Inline form: role dropdown (grantee/admin) + optional email
  - "Generate Invite Link" creates the invite and displays a copyable link
  - Copy button with clipboard feedback

**Docs updated:**
- `CLAUDE.md` — 12→13 tables, added invites to table list, updated multi-tenancy progress

---

## Stage 36 — Multi-Tenancy: Super Admin & Tenant Management UI

**Tag:** `stage-36`

Added super_admin role routing and a tenant management page for cross-tenant administration.

**Frontend:**
- New `TenantManagement.js` — super admin page at `/super/tenants`:
  - Lists all tenants with name, slug, user count, approval settings, creation date
  - "Create Tenant" inline form with auto-generated slug from name
  - Creates both `tenants` and `tenant_settings` rows
  - Search by name or slug
  - Stat cards for total tenants and total users
  - Reuses existing `Admin.css` styles
- `Header.js` — added "Tenants" nav link for super_admin role
- `App.js` — added super_admin root redirect to `/super/tenants`, added route with role guard

**Docs updated:**
- `CLAUDE.md` — added Super Admin routes section, updated AdminUserList description

---

## Stage 37 — Approval Config: Auto-Approval Triggers, Settings Page & Conditional UI

**Tag:** `stage-37`

Implements Doc 13 (Approval Config). Approval workflows for grants, budget items, and expenses are now configurable per tenant via toggle switches. When approval is turned off, new records are automatically approved on creation.

**Database (`backend/`):**
- 3 new BEFORE INSERT trigger functions: `auto_approve_grant()`, `auto_approve_budget_item()`, `auto_approve_expense()`
- Each reads from `tenant_settings` for the row's tenant and overrides `status` to `'approved'` if approval not required
- Triggers named `trg_zz_*` to ensure they fire after tenant_id auto-populate triggers (alphabetical ordering)
- Updated `01-Complete-Fresh-Setup.sql` and `04-Full-Teardown.sql`

**Frontend:**
- New `AdminSettings.js` — `/admin/settings` page:
  - Three toggle switches for grant, budget, and expense approval
  - Save button updates `tenant_settings` (disabled when no changes)
  - Explanatory text about behavior and existing records
  - Toggle switch CSS added to `Admin.css`
- `Header.js` — added "Settings" link in admin profile dropdown
- `App.js` — added `/admin/settings` route with admin guard
- `CreateGrant.js` — success message and info box conditional on grant approval setting
- `AdminDashboard.js` — pending review queue hidden when grant approval is off
- `AdminGrantReview.js` — budget/expense review section hidden when both approvals are off

**Docs updated:**
- `CLAUDE.md` — added `/admin/settings` route, updated multi-tenancy and approval config status to complete

---

## Stage 38 — Two-Tier SaaS: Tenant Types & Self-Service Provisioning

**Tag:** `stage-38`

Implements Doc 14 (Two-Tier SaaS) database and provisioning layer. Tenants are now either "managed" (invite-based, approval workflows) or "self_service" (open signup, no approvals, no admin role).

**Database (`backend/`):**
- Added `tenant_type` column to `tenants` table: `'managed'` or `'self_service'` (default: `'self_service'`)
- New `enforce_self_service_role()` trigger — BEFORE INSERT/UPDATE on `users`, raises exception if attempting to set `role = 'admin'` on a self-service tenant
- New `provision_self_service_tenant()` RPC function (SECURITY DEFINER) — atomically creates tenant (type=self_service) + settings (all approvals off) + user record in one transaction
- Updated `02-Sample-Data.sql` — TFAC tenant explicitly set to `'managed'`
- Updated `04-Full-Teardown.sql` with new functions

**Frontend:**
- `SignUpClean.js` — dual signup flow:
  - With invite token: creates user in invite's tenant (unchanged)
  - Without invite: calls `provision_self_service_tenant` RPC to atomically create a new self-service tenant + user
- `TenantManagement.js` — updated for tenant types:
  - Type column in tenant table (Managed/Self-service badges)
  - Type dropdown in create tenant form
  - Self-service tenants auto-created with all approvals off

**Docs updated:**
- `CLAUDE.md` — updated Two-Tier SaaS progress

---

## Stage 39 — Two-Tier SaaS: Dual Signup Flows & Conditional UI

**Tag:** `stage-39`

Completes Doc 14 (Two-Tier SaaS). Self-service users see a simplified UI without approval workflows, status badges, or admin-related elements.

**Frontend:**
- `App.js` — session `tenantConfig` now includes `type` field fetched from `tenants` table (both in initial load and handleLogin)
- `SignUpClean.js` — updated subtitle for self-service flow: "Create your own workspace to track grants and expenses"
- `Main.js` — Pending, Needs Changes, and Rejected stat cards hidden for self-service tenants
- `Grants.js` — status filter tabs simplified to "All" and "Approved" for self-service
- `GrantDetail.js` — admin comments section hidden for self-service tenants
- `GrantBreakdown.js` — budget item and expense status badges and Status column hidden for self-service

**Docs updated:**
- `CLAUDE.md` — Two-Tier SaaS marked as complete

---

## Stage 40 — Documentation Overhaul, Multi-Tenant Sample Data & Super Admin Guide

**Tag:** `stage-40`

Comprehensive documentation update to reflect all changes from Stages 33–39. Expanded sample data to cover multi-tenant scenarios.

**Database (`backend/`):**
- `02-Sample-Data.sql` — expanded from 1 tenant/4 users to 4 tenants/9 users:
  - TFAC (managed): Maria, Jacob, Faizan (grantees), Eric (admin) — 6 grants
  - Bright Horizons (managed): Priya, David (grantees), Amara (admin) — 3 grants
  - Lopez Consulting (self-service): Carlos — 1 grant (auto-approved)
  - Greenleaf Bookkeeping (self-service): Nadia — 1 grant (auto-approved)
- `03-Large-Sample-Data.sql` — added `tenant_id` to user insert (TFAC tenant)
- `05-After-User-Creation.sql` — added UUID linking for all 9 sample users
- New `backend/README-Sample-Data.md` — quick reference for all tenants, users, and grants

**Docs updated (all in `docs-tfac/`):**
- `01-Dev-Onboarding.md` — 3 roles + 2 tenant types, 13 tables in database section, architecture docs reframed
- `04-Database-Schema.md` — added tenants/tenant_settings/invites tables, tenant_id on all tables, new triggers and functions, updated storage paths
- `05-Supabase-Setup.md` — 13 tables, 9 sample users across 4 tenants, updated verification counts
- `07-Er-Diagram.md` — added 3 new entities, tenant_id on all entities, new relationships, updated roles
- `09-Grantee-Guide.md` — managed vs self-service signup context, approval conditional notes
- `10-Admin-Guide.md` — managed-only note, invite user instructions, new Approval Settings section
- `11-Quick-Reference.md` — approval status notes, Settings and Invite User entries
- `12-Future-Multi-Tenancy.md` — reframed: "Architecture: Multi-Tenancy" (Status: Implemented)
- `13-Future-Approval-Config.md` — reframed: "Architecture: Configurable Approval Workflows" (Status: Implemented)
- `14-Future-Two-Tier-SaaS.md` — reframed: "Architecture: Two-Tier SaaS Model" (Status: Implemented)
- New `15-Super-Admin-Guide.md` — end-user guide for super admins: tenant management, tenant types, onboarding flows, limitations
- `CLAUDE.md` — updated sample data counts, sample users list, documentation index

---

## Stage 41 — Bug Fixes, Super Admin Refinements & Walkthrough Formatting

**Tag:** `stage-41`

Miscellaneous fixes, super admin UI improvements, database FK hardening, and walkthrough guide formatting.

**Database (`backend/`):**
- All FK references to `auth.users` changed to RESTRICT (no CASCADE or SET NULL) — prevents accidental deletion of Auth users who have data in the system. Users should be disabled via `is_active = false` instead.
- `00-Full-Teardown.sql` — renamed from `04-Full-Teardown.sql`
- New `04-Check-Missing-Auth-Users.sql` — shows which sample users still need Auth accounts with status column (CREATE / Auth exists / Already linked)
- `02-Sample-Data.sql` — added Sam Reeves (super_admin) to TFAC tenant
- `05-After-User-Creation.sql` — added UUID linking for Sam Reeves

**Frontend bug fixes:**
- `AdminDashboard.js` — fixed crash: component now accepts `session` prop (was referencing undefined `session`)
- `SignUpClean.js` — added client-side validation (name, phone, org, password length) before Auth signup call to prevent orphaned Auth accounts
- `SignUpClean.js` — fixed `await onSignup()` so session is set before navigation (same fix as Login.js)
- `App.js` — fixed account disabled page logo reference (`logo-rect-transparent.png` → `logo.png`)

**Super admin UI refinements (`TenantManagement.js`):**
- Removed slug column from tenant table (not user-facing)
- Removed slug field from create tenant form (auto-generated behind the scenes)
- Removed self-service option from create tenant dropdown (self-service tenants are only created via open signup)
- Updated search placeholder to "Search by name…"
- `Header.js` — hidden Grants/Expenses nav for super_admin role

**Walkthrough guides:**
- All image tags in 16/17/18 converted from `![alt](path)` to `<img>` tags with `style="max-width: 700px"`

**Docs updated:**
- `CLAUDE.md` — updated file tree with renamed scripts
- `01-Dev-Onboarding.md` — updated script table and file tree
- `05-Supabase-Setup.md` — updated teardown references
- `06-Troubleshooting.md` — updated teardown reference
- `README-Sample-Data.md` — added Sam Reeves, updated script references

---

## Stage 42 — CSV Export, Tenant Disable/Enable, Admin Invite on Tenant Creation, UI Polish

**Tag:** `stage-42`

Three priority features plus UI refinements.

**Features:**
- **Admin invite on tenant creation** — super admin create tenant form now requires admin email, auto-generates invite link
- **CSV export** — "Export CSV" button on grantee Expense Reports and admin All Grants pages
- **Tenant disable/enable** — `is_active` column on tenants, super admin toggle in UI, blocked login for disabled tenants (super admins exempt)
- **User bar** — slim bar below header showing logged-in user name and role
- **Footer cleanup** — removed quick links, two-column layout, removed location

**Docs and screenshots updated.**

---

## Stage 43 — Tenant-Aware Support Contact, Platform Settings, Audit Log Styling, Pagination

**Tag:** `stage-43`

Configurable support contact info and miscellaneous polish.

**Database (`backend/`):**
- Added `support_email` and `support_phone` columns to `tenant_settings`
- New `platform_settings` table (single-row, managed by super admin) with `default_support_email` and `default_support_phone`
- RLS: anyone can read platform settings, super admins can update
- New `21-PROD-Setup.sql` — production bootstrap script (first tenant + super admin + training tenant guidance)
- Updated `00-Full-Teardown.sql` with `platform_settings`

**Frontend:**
- `AdminSettings.js` — new "Support Contact" section with email and phone fields below approval toggles
- `TenantManagement.js` — new "Platform Defaults" card at bottom with default support email/phone, save button
- `Footer.js` — reads contact info from tenant settings → platform defaults → hardcoded fallback
- `App.js` — fetches `platform_settings` on mount, passes to Footer
- `Admin.css` — audit log expanded row: removed blue tint, dark green header row with white text, white background for diff
- `TenantManagement.js` — shortened approval column headers (Grants/Budgets/Expenses), removed slug from UI
- `Grants.js` — increased grants per page from 5→10 (table) and 3→6 (card)

**Docs updated:**
- `CLAUDE.md` — added docs 16-18 to index, added 21-PROD-Setup to file tree, updated stage count
- `01-Dev-Onboarding.md` — added 21-PROD-Setup to script table and file tree
- `README-Sample-Data.md` — added development-only disclaimer
- `17-Admin-Walkthrough.md` — added Section 12: support contact configuration
- `18-Super-Admin-Walkthrough.md` — added Section 9: platform default settings

---

## Stage 44 — Filters, Expired Grants, Receipts, UI Polish

**Tag:** `stage-44`

Comprehensive round of new filters, expired grant handling, and UI refinements.

**Bug fixes:**
- Super admin exempt from tenant `is_active` check on login
- Tenant admins can no longer modify super_admin users (actions column shows "—")
- Date filters on tenant management and audit log now use local timezone instead of UTC
- Totals triggers (`update_grant_record_totals`, `update_budget_item_totals`) optimized with `IS DISTINCT FROM` guard to prevent empty audit log entries from cascade updates

**New features:**
- Audit log: user filter dropdown (filter by who made the change)
- Admin All Grants: From/To date range filter
- Admin All Grants: separate "Pending Budgets" and "Pending Expenses" filter buttons with split counts (3B 2E) in one column
- Admin All Grants + Grantee Grants: "Hide Expired" / "Show Expired" toggle
- Expired grant banner on GrantDetail and GrantBreakdown pages ("spend period has ended")
- Expense date warning in AddExpenseModal when date falls outside grant spend period (warning only, does not block)
- Expense Reports: status filter dropdown (All/Approved/Pending/Rejected)
- Expense Reports: grants dropdown sorted alphabetically
- GrantBreakdown: pending/rejected expense count badges on budget item rows
- Receipts now optional when `require_expense_approval` is false (self-service and managed with expense approval off)

**UI polish:**
- Footer: removed quick links, two-column layout, removed location
- User bar below header showing logged-in user name and role
- Header and footer responsive for narrow screens, no horizontal overflow
- Grant badge: fixed vertical alignment and text truncation on expense reports
- Status badge: `white-space: nowrap` prevents "Needs Changes" wrapping
- Expense amounts: always show two decimal places
- Grantee search box widened
- Expense table font reduced to 0.9rem
- New Grant button: fixed underline and icon alignment
- Date input font: Montserrat applied in modals via Forms.css
- Non-clickable admin stat cards no longer have hover effect
- User list: "—" vertically centered for self/super_admin rows
- Tenant table headers shortened (Grants/Budgets/Expenses)
- Admin dashboard pending links auto-activate correct filter
- Audit log search hint shortened with full tooltip on hover
- Em dashes replaced with hyphens in user-facing text

---

## Stage 45 — Two-Step Signup with Email Verification Support

**Tag:** `stage-45`

Split the signup flow into two steps to support email verification. Previously, all user info was collected in a single form and the Auth account + user record were created together. With email verification ON, the profile data was lost between signup and verification.

**Frontend:**
- `SignUpClean.js` — simplified to collect only email + password. Calls `signUp()` with `emailRedirectTo` pointing to `/complete-profile` (preserves invite token). Detects whether email confirmation is required (`data.session` null = needs verification) and shows "Check your email" screen or redirects to profile completion.
- New `CompleteProfile.js` — collects first name, last name, phone, org, tax month after email is verified. Handles both invite-based (reads invite token from URL, creates user in correct tenant with correct role) and self-service (calls `provision_self_service_tenant` RPC) flows.
- `App.js` — detects authenticated user with no `users` table record (`needsProfile` state), redirects to `/complete-profile`. New `handleProfileComplete` handler. Root route checks `needsProfile` before other redirects. Duplicate CompleteProfile import fixed.
- `Login.js` — when a verified user logs in but has no profile, redirects to `/complete-profile` instead of showing "No user record found" error.

**Production note:** Email verification is OFF for initial deployment. The invite flow provides implicit trust for managed tenants. Google OAuth is being considered as a future solution for email verification without rate limits.

**Database:**
- `01-Complete-Fresh-Setup.sql` — optimized totals triggers with `IS DISTINCT FROM` guard

---

## Stage 46 — Bug Fixes, RLS Policies, UI Fixes, Doc Updates

**Tag:** `stage-46`

**Bug fixes:**
- Expense without receipt crash — `uploadReceipt` now guarded with `if (receiptFile)` check
- Edit expense no longer resets status to pending — `status` field excluded from UPDATE payload
- Edit budget item no longer resets status to pending — same fix in BudgetItemModal
- Date timezone off-by-one — expired grant checks now use `T23:59:59` local time
- Complete profile redirect flash — session set before clearing `needsProfile` to prevent race condition to `/login`
- Profile complete after invite — `handleProfileComplete` fetches tenant data before updating state
- Missing grant attachments DELETE policy — users can now delete attachments on their own grants
- Missing storage DELETE policies — added for both `receipts` and `grant-documents` buckets
- Default support email changed from `.com` to `.org`

**Frontend:**
- Admin comment success message with 8-second auto-fade
- Signup/login container narrowed to 450px (CompleteProfile keeps 650px with `wide` class)
- App content flex column for vertical centering of login/signup modals
- Disabled user row: action buttons no longer dimmed
- Grant breakdown: "Back to Expenses" changed to "Back to Grant Details"
- Expense reports: column widths adjusted (Amount 16%, Date 14%), sort highlight overlap fixed
- Expense table font reduced to 0.9rem
- Create Grant info text corrected: budget items can be added while application is being reviewed
- Duplicate tenant error: friendly message instead of raw database constraint error
- "Organization Name" renamed to "Tenant Name" in create tenant form
- Tenant name tooltip on hover in tenant table

**Docs updated:**
- `16-Grantee-Walkthrough.md` — signup flow updated for two-step process (email/password then complete profile)
- `17-Admin-Walkthrough.md` — invite flow explains two-step signup, "Review" button references corrected to arrow button
- `18-Super-Admin-Walkthrough.md` — self-service and invite flows updated for two-step signup

---

## Stage 47 — Edit Status Reset, RLS Tenant Policy, Doc Consolidation & Walkthrough Overhaul

**Tag:** `stage-47`

**Backend (SQL):**
- New RLS policy: `"Authenticated users can read tenant names"` on `tenants` table — allows Complete Profile page to display tenant name for invite signups
- Existing policies unchanged

**Frontend — Edit Status Reset (managed tenants only):**
- Budget item edits now reset status to `pending` for admin re-review
- Expense edits now reset status to `pending` for admin re-review
- Self-service tenants unaffected (status preserved on edit)
- Info note warns grantee before saving: "Saving changes will reset this item to pending for admin review" (only shown when status would change)
- Budget allocation floor guard: cannot set allocation below total expenses recorded (`amount_spent`)
- Hint text shows minimum when expenses exist

**Frontend — UI fixes:**
- SignUpClean: invite subtitle changed to "You've been invited to join as a [role]" (removed blank tenant name from RLS-blocked join)
- CompleteProfile: restored tenant name display ("Welcome! Your grants will be managed by [Tenant Name].") — works now with new RLS policy
- CompleteProfile: organization field no longer pre-filled with tenant name
- ExpenseReports: grant badge tooltip on hover (shows full grant name for truncated badges)
- BudgetItemModal/AddExpenseModal: `session` prop passed from GrantBreakdown for tenant type detection

**Documentation — Consolidated from 15 to 9 docs:**
- Merged `01-Dev-Onboarding` + `02-React-Supabase-Patterns` + `06-Troubleshooting` → `01-Developer-Guide.md`
- Merged `03-Deployment-Ftp` + `05-Supabase-Setup` → `02-Deployment-Guide.md`
- Merged `12-Multi-Tenancy` + `13-Approval-Config` + `14-Two-Tier-SaaS` → `03-Architecture.md`
- Deleted: 01, 02, 03, 05, 06, 09, 10, 11, 12, 13, 14, 15
- Kept: 04 (Database Schema), 07 (ER Diagram), 08 (Changelog), 16/17/18 (Walkthroughs)
- Terminology section added: tenant vs organization clarification

**Documentation — Walkthrough overhaul (all three docs):**
- Formatting standardized: `**Label**: Capitalized` pattern replacing em-dashes and hyphens
- Images: consistent indentation (3-space inside lists, flush left under headings)
- Callouts: ⚠️ for destructive warnings, ℹ️ for informational notes
- Tenant vs organization explanation rewritten with concrete TFAC example

**16-Grantee-Walkthrough — features added:**
- Section 1: two-step signup flow with exact subtitle text per flow
- Section 2: user bar description (name, role, tenant on every page)
- Section 3: clickable stat cards, dimmed zero-count cards, "Spent (Pending)" bar in chart
- Section 4: summary stat strip, Hide Expired toggle, pagination, pending items clock icon, time remaining color coding, self-service tab differences
- Section 5: supporting documents tip
- Section 6: expired grant banner, donut chart with spent % and disbursed %
- Section 7: split into managed (resubmit) and self-service (edit any time) subsections
- Section 8: expired banner, collapsible budget items, pending/rejected expense badges, empty state CTA, edit status reset note, budget allocation floor, delete cascade warning
- Section 9: split layout, budget info box, date warning, receipt specs (500KB, JPG/PNG/PDF), receipt optional for self-service, replace workflow, edit status reset note, delete totals note
- Section 10: file metadata display, category badges, two-click delete
- Section 11: sortable columns with sort arrows, "Other" grouping for 8+ grants, grant badge tooltip, CSV exports current sort
- Section 12: notification badge "99+" cap, empty state
- Section 13: new footer section (support contact, copyright)

**17-Admin-Walkthrough — features added:**
- Section 2: conditional stat card visibility, clickable pending cards, "+X more" message, support contact nudge banner
- Section 3: two separate pending filters (Budgets/Expenses), date range filter, Hide Expired, sortable columns, "2B 1E" shorthand
- Section 4: expired grant banner, comments only when they exist, comment success message
- Section 5-6: approve/reject buttons only visible for pending items
- Section 7: Linked column explained, super admin rows show "—"
- Section 9: save button disabled until changes made
- Section 10: user filter with admin badge, color-coded action badges, pagination (50/page), `updated_at` filtered from diffs

---

## Stage 48 — Subscription & Billing (Stripe Integration)

**Tag:** `stage-48`

Subscription and billing feature integrated into the codebase. Adds Stripe-based membership tiers (Basic and Premium) with route guards for grantees.

**Backend (SQL):**
- 2 new columns on `platform_settings`: `basic_membership_product_id`, `premium_membership_product_id`
- 4 new tables: `billing_customers`, `billing_webhook_events`, `subscriptions`, `user_memberships`
- 3 new triggers: `set_billing_updated_at`, `enforce_subscription_tier_product_match`, `enforce_membership_eligibility`
- 6 new membership functions: `is_membership_exempt`, `has_basic_membership`, `has_premium_membership` (each with INT and no-arg variants)
- RLS policies for all 4 billing tables
- Realtime publication extended with billing tables
- Teardown script updated with DROP statements for all billing objects

**Frontend:**
- `lib/billing.js` — Membership tiers, feature flags, Stripe checkout/portal helpers
- `SubscriptionPage.js` + `.css` — Plan selection UI with Basic/Premium cards, checkout flow, billing portal
- `App.js` — `loadMembershipStatus`/`refreshMembership` functions, membership state in session, route guards on all grantee routes redirecting to `/subscription` without active subscription
- `Header.js` — "Subscription" nav link for grantees
- `ExpenseReports.js` — Excel export (Premium feature gate) using `xlsx` library, budget items fetch, dual export buttons (Export Excel / Export CSV)
- `package.json` — added `xlsx` dependency

**Supabase Edge Functions (4 new):**
- `create-checkout-session` — Premium tier Stripe checkout
- `create-basic-membership-checkout-session` — Basic tier Stripe checkout
- `create-billing-portal-session` — Billing portal for managing subscriptions
- `stripe-webhook` — Webhook handler for checkout and subscription events
- `_shared/stripe.ts` — Shared Stripe utilities, customer management, subscription upsert

**Configuration:**
- `.gitignore` updated to exclude `supabase/.temp/`, `supabase/supabase/`, `supabase/.env.local`
- `supabase/README.md` — Edge function setup guide (CLI install, secrets, deployment, webhook config)

**18-Super-Admin-Walkthrough — features added:**
- Section 1: user bar with Super Admin badge, nav isolation explained
- Section 2: Status column in table, search by slug, subtitle count, date range constraints, Total Users clarified as platform-wide
- Section 3: Copy "Copied!" feedback, form locks after creation, slug auto-generation
- Section 8: inline confirmation UI (Yes/No, not modal)
- Section 9: save button disabled until changes, hardcoded fallback values specified

---

## Stage 49 — Subscription Exemptions, Admin Waiver UI, Walkthrough Updates, HTML Export

**Tag:** `stage-49`

Subscription exemption controls for super admins and tenant admins, RLS fixes for billing tables, walkthrough documentation updates with subscription sections, and self-contained HTML export via pandoc template.

**Backend (SQL):**
- Added `require_subscription BOOLEAN NOT NULL DEFAULT true` to `tenant_settings`
- Updated `is_membership_exempt()` to check `tenant_settings.require_subscription` instead of `tenant_type = 'self_service'` — self-service tenants now require subscriptions by default
- Fixed RLS policies on all 4 billing tables: `"Service role can manage..."` policies now restricted to `auth.role() = 'service_role'` (were `USING (true)` which leaked data across users)
- Added RLS policy `"Admins can manage memberships in their tenant"` so tenant admins can waive/remove subscriptions

**Frontend — Subscription exemptions:**
- `TenantManagement.js` — "Subscription" column in tenant table with clickable Required/Exempt toggle. Toggling a self-service tenant back to Required auto-cleans manual waiver rows.
- `AdminUserList.js` — Subscription status badge column (Exempt/Premium Paid/Basic Paid/Waived/None) and Waive/Remove Waiver action buttons for grantees
- `SubscriptionPage.js` — Status label distinguishes Paid, Waived ("subscription waived by your administrator"), tenant-exempt ("subscription not required for your account"), and Admin/Super Admin exempt. Plan buttons and Manage Subscription hidden when user has access. Hero text changes based on access state.
- `Admin.css` — Admin page max-width increased to 1400px, table wrapper `overflow-x: auto` for horizontal scroll

**Frontend — Other:**
- `GrantBreakdown.js` — Disbursed card now shows undisbursed amount sub-label (e.g. "$15,000 undisbursed")

**Documentation:**
- `16-Grantee-Walkthrough.md` — Section 14 (Subscription & Membership) added, subscription references in signup flows and expense export section, Excel export documented
- `17-Admin-Walkthrough.md` — Section 13 (Managing Grantee Subscriptions) added, subscription badge table in user list, waive/remove waiver flow documented
- `18-Super-Admin-Walkthrough.md` — Section 10 (Managing Tenant Subscriptions) added, subscription column in tenant table, exemption flow documented
- All three walkthroughs: blank line fixes before lists for correct pandoc rendering
- `template.html` — Pandoc HTML template with sidebar TOC, collapsible sections, expand/collapse all, lightbox for images, back-to-top button, prev/next section navigation, GrantTrail logo
- `print.css` — Updated for pandoc HTML conversion (centered layout, heading styles, blockquote callouts)
- Generated self-contained HTML walkthroughs (16/17/18) with embedded images via pandoc
