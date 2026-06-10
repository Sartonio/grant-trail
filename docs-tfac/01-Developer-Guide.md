# GrantTrail - Developer Guide

This consolidated guide covers everything a developer needs to set up, understand, and troubleshoot GrantTrail.

---

## Key Terminology

- **Tenant** = the GrantTrail account (data isolation boundary, settings, admin control). Stored in `tenants` table.
- **Organization** = the real-world entity a user belongs to. Stored in `users.organization_name`. A managed tenant (e.g. TFAC) can have grantees from many different organizations.
- These are NOT interchangeable. See the [Architecture doc](03-Architecture.md) for the full distinction.

---

## Table of Contents

- [Part 1: Onboarding](#part-1-onboarding)
  - [1.1 Project Overview](#11-project-overview)
  - [1.2 Prerequisites](#12-prerequisites)
  - [1.3 Local Setup](#13-local-setup)
  - [1.4 Database Setup](#14-database-setup)
  - [1.5 Project Structure](#15-project-structure)
  - [1.6 Routing](#16-routing)
  - [1.7 How Authentication Works](#17-how-authentication-works)
  - [1.8 Key Workflows — Where to Find the Code](#18-key-workflows--where-to-find-the-code)
  - [1.9 Database Tables](#19-database-tables)
  - [1.10 Environment Variables](#110-environment-variables)
  - [1.11 CSS System](#111-css-system)
  - [1.12 Architecture Documentation](#112-architecture-documentation)
- [Part 2: React & Supabase Patterns](#part-2-react--supabase-patterns)
  - [2.1 RLS Silent Failures](#21-rls-silent-failures)
  - [2.2 Database Triggers Do Work For You](#22-database-triggers-do-work-for-you)
  - [2.3 Supabase Storage — Signed URLs](#23-supabase-storage--signed-urls)
  - [2.4 Compensating Transactions (Manual Rollback)](#24-compensating-transactions-manual-rollback)
  - [2.5 The `useCallback` + `useEffect` Combination](#25-the-usecallback--useeffect-combination)
  - [2.6 IIFE in JSX for Inline Chart Calculations](#26-iife-in-jsx-for-inline-chart-calculations)
  - [2.7 Two-Click Delete (Without a Modal)](#27-two-click-delete-without-a-modal)
  - [2.8 `Set` for O(1) Membership Lookup](#28-set-for-o1-membership-lookup)
  - [2.9 Fetching Multiple Related Records in One Query (`.in()`)](#29-fetching-multiple-related-records-in-one-query-in)
  - [2.10 `.single()` vs Array Results](#210-single-vs-array-results)
  - [2.11 Intentional `eslint-disable` on useEffect Dependencies](#211-intentional-eslint-disable-on-useeffect-dependencies)
  - [2.12 Modal Backdrop Click to Close](#212-modal-backdrop-click-to-close)
- [Part 3: Troubleshooting](#part-3-troubleshooting)
  - [3.1 Authentication & Login](#31-authentication--login)
  - [3.2 Database / RLS Errors](#32-database--rls-errors)
  - [3.3 Frontend / React Issues](#33-frontend--react-issues)
  - [3.4 File Upload Issues](#34-file-upload-issues)
  - [3.5 Resetting Test Data](#35-resetting-test-data)

---

# Part 1: Onboarding

This section gets a new developer from zero to a running local environment and gives enough context to start contributing without asking questions.

---

## 1.1 Project Overview

**GrantTrail** is a grant management web application built for The Family Advocates Canada (TFAC). It lets non-profit organizations track grant funding, log expenses against budget line items, and upload supporting documents — while giving TFAC administrators a portal to review and approve grant applications.

**Three user roles:**

| Role | What they do |
|------|--------------|
| **Grantee** | Submits grants, manages budgets, logs expenses, uploads receipts and documents |
| **Admin** | Reviews and approves/rejects grant applications, adds comments, manages users within their tenant |
| **Super Admin** | Cross-tenant access. Creates and manages tenants, views all data across tenants |

**Two tenant types:**

| Type | Description |
|------|-------------|
| **Managed** | Full approval workflows, invite-based signup, admin role available (e.g. TFAC) |
| **Self-service** | Open signup, all records auto-approved, no admin role, simplified UI |

**Tech stack:**
- **Frontend:** React 19, React Router 7, custom CSS (no UI library)
- **Backend-as-a-Service:** Supabase (auth, PostgreSQL database, file storage)
- **Charts:** recharts 3.7.0
- **Icons:** react-icons 5.5.0
- **State management:** none — local `useState` per component

---

## 1.2 Prerequisites

Before you start, make sure you have:

- **Node.js 18+** and **npm** — verify with `node -v` and `npm -v`
- **Git**
- The **Supabase project URL and anon key** for the team's Supabase instance (ask the team lead) — OR your own Supabase account if starting fresh

---

## 1.3 Local Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd CapstoneStages

# 2. Install frontend dependencies
cd frontend
npm install

# 3. Create the environment file (see Section 1.10 for details)
#    Create frontend/.env.local with:
#    REACT_APP_SUPABASE_URL=https://your-project.supabase.co
#    REACT_APP_SUPABASE_KEY=your-anon-key-here

# 4. Set up the database (see Section 1.4 below)

# 5. Start the dev server
npm start
# Opens http://localhost:3000
```

The app will show a login page. Use the sample user accounts from Section 1.4.

---

## 1.4 Database Setup

All SQL scripts live in `backend/`. Run them in the Supabase Dashboard → SQL Editor.

| Script | When to run | What it does |
|--------|-------------|--------------|
| `01-Complete-Fresh-Setup.sql` | **First** — required | Creates all tables, functions, triggers, RLS policies, and storage buckets |
| `02-Sample-Data.sql` | After `01` | Inserts 3 grantee accounts + 6 grants with budget items and expenses |
| `05-After-User-Creation.sql` | After creating Auth accounts (see below) | Links Supabase Auth UUIDs to the users table rows; adds sample admin comments |
| `03-Large-Sample-Data.sql` | Optional | 50+ grants for one user (Alex Tan) — good for pagination/chart testing |
| `04-Check-Missing-Auth-Users.sql` | Before creating Auth accounts | Shows which users still need Auth accounts created in Supabase Dashboard |
| `00-Full-Teardown.sql` | When starting over | Drops all tables, functions, and policies — safe to run repeatedly |
| `06-Randomize-Expense-Dates.sql` | Dev utility | Randomizes existing expense dates to spread them across grant periods for better charts |
| `21-PROD-Setup.sql` | Production only | Bootstraps the first tenant and super_admin user for a production deployment |

**Sample user setup flow:**

1. Run `01-Complete-Fresh-Setup.sql`
2. Run `02-Sample-Data.sql` — this inserts user rows in the `users` table but leaves the auth UUID column (`user_id`) null
3. In Supabase Dashboard → Authentication → Users, manually create accounts for these emails with any password:
   - `maria.smith@example.com` (grantee)
   - `jacob.soto@example.com` (grantee)
   - `faizan.sharp@example.com` (grantee)
   - `eric.hobbs@example.com` (admin)
4. Run `05-After-User-Creation.sql` — this fills in the UUID column by matching emails

**Sample login credentials:** Use whatever password you set in step 3. Log in as `eric.hobbs@example.com` for admin access.

---

## 1.5 Project Structure

```
CapstoneStages/
├── backend/                      # SQL scripts only
│   ├── 00-Full-Teardown.sql
│   ├── 01-Complete-Fresh-Setup.sql
│   ├── 02-Sample-Data.sql
│   ├── 03-Large-Sample-Data.sql
│   ├── 04-Check-Missing-Auth-Users.sql
│   ├── 05-After-User-Creation.sql
│   ├── 06-Randomize-Expense-Dates.sql
│   └── 21-PROD-Setup.sql
│
├── docs-tfac/                    # Project documentation + brand assets
│
└── frontend/
    ├── public/
    └── src/
        ├── App.js                # Root: auth, session, routing
        ├── supabaseClient.js     # Supabase singleton client
        │
        ├── components/
        │   ├── Header.js / .css          # Top nav bar (role-conditional links)
        │   ├── Footer.js / .css          # Page footer
        │   ├── Main.js / .css            # Grantee dashboard (stats + charts)
        │   ├── Login.js                  # Auth login form
        │   ├── SignUpClean.js            # Auth signup form
        │   ├── Grants.js / .css          # Grantee grants list with filter/search
        │   ├── GrantDetail.js / .css     # Single grant: info, status history, charts
        │   ├── GrantBreakdown.js / .css  # Budget items + expenses for a grant
        │   ├── CreateGrant.js / .css     # New grant form
        │   ├── ExpenseReports.js / .css  # Expense analytics dashboard
        │   ├── AddExpenseModal.js        # Modal: add/edit expense + receipt upload
        │   ├── BudgetItemModal.js        # Modal: add/edit budget item
        │   ├── GrantAttachments.js / .css# File upload/view/delete for grant docs
        │   ├── StatusBadge.js            # Reusable status pill (pending/approved/etc.)
        │   ├── StatCard.js               # Reusable stat card
        │   ├── ConfirmDialog.js          # Reusable confirm dialog
        │   ├── AdminDashboard.js         # Admin home: stats + charts
        │   ├── AdminGrantList.js         # Admin: table of all grants
        │   ├── AdminGrantReview.js       # Admin: review single grant, change status, approve/reject budget items & expenses
        │   ├── AdminAuditLog.js          # Admin: audit log viewer with filters and diff view
        │   ├── AdminUserList.js          # Admin: user management — role toggle, enable/disable
        │   └── Admin.css                 # Shared admin styles
        │
        ├── hooks/
        │   └── useGrantee.js     # Custom hook: fetch current user's DB record
        │
        └── styles/
            ├── variables.css     # CSS custom properties (colors, spacing, fonts)
            ├── global.css        # Base element resets
            ├── utilities.css     # Utility classes
            ├── Forms.css         # Modal and form styles (shared)
            ├── Charts.css        # recharts card wrappers (shared)
            └── Login.css         # Auth page styles
```

---

## 1.6 Routing

| URL | Component | Who can access |
|-----|-----------|----------------|
| `/login` | Login.js | Public |
| `/signup` | SignUpClean.js | Public |
| `/` | Main.js | Grantee |
| `/grants` | Grants.js | Grantee |
| `/grants/new` | CreateGrant.js | Grantee |
| `/grants/:id` | GrantDetail.js | Grantee (own grants only) |
| `/grants/:id/breakdown` | GrantBreakdown.js | Grantee (own grants only) |
| `/expenses` | ExpenseReports.js | Grantee |
| `/admin` | AdminDashboard.js | Admin |
| `/admin/grants` | AdminGrantList.js | Admin |
| `/admin/grants/:id` | AdminGrantReview.js | Admin |
| `/admin/audit` | AdminAuditLog.js | Admin |
| `/admin/users` | AdminUserList.js | Admin |

Route protection is in `App.js`. Any unauthenticated user is redirected to `/login`. Admins are redirected to `/admin` when they try to access `/`. Access control beyond routing is enforced by Supabase RLS policies on the database.

---

## 1.7 How Authentication Works

This is the most important thing to understand before touching any data-fetching code.

**There are two different user identifiers:**

```
Supabase Auth user:   user.id = "550e8400-e29b-41d4-a716-..."  (UUID)
                             ↓
                      stored in users.user_id column
                             ↓
users table row:      userRecord.id = 3                          (integer PK)
                             ↓
                      used as FK in grant_record, expenses, etc.
```

The `users` table has two ID-related columns:
- `user_id` (UUID) — matches the Supabase Auth user — used only for login lookup
- `id` (integer) — the primary key — used as a foreign key in every other table

**Session object shape** (built in App.js, passed as prop to every page):

```js
// App.js — how the session is built
const { data: { user } } = await supabase.auth.getUser();
const { data: userRecord } = await supabase
  .from('users')
  .select('*')
  .eq('user_id', user.id)   // match auth UUID to users table
  .single();
setSession({ user, userRecord });

// Later, in any component:
session.user.id          // UUID — only needed to query the users table itself
session.userRecord.id    // integer — use this as FK when inserting grants, expenses, etc.
session.userRecord.role  // 'admin' or 'grantee'
```

**In practice:**
- Use `session.user.id` (UUID) only when querying the `users` table itself
- Use `session.userRecord.id` (integer) as FK when inserting into `grant_record`, `expenses`, etc.
- Use `session.userRecord.role` to check if the logged-in user is an admin

**File:** `frontend/src/App.js`

---

## 1.8 Key Workflows — Where to Find the Code

| Workflow | Files involved |
|----------|----------------|
| Login / Signup | `Login.js`, `SignUpClean.js`, `App.js` |
| Create a grant | `CreateGrant.js` |
| View grant overview + status history | `GrantDetail.js` |
| Manage budget items | `GrantBreakdown.js` + `BudgetItemModal.js` |
| Add / edit an expense + upload receipt | `GrantBreakdown.js` + `AddExpenseModal.js` |
| View all expenses | `ExpenseReports.js` |
| Upload / view grant documents | `GrantAttachments.js` (embedded in GrantDetail and AdminGrantReview) |
| Admin: review and approve / reject a grant | `AdminGrantReview.js` |
| Admin: approve / reject budget items and expenses | `AdminGrantReview.js` (Budget & Expense Review section) |
| Admin: see all grantees and grants | `AdminGrantList.js`, `AdminDashboard.js` |
| Admin: view change history | `AdminAuditLog.js` |
| Admin: manage users (role, enable/disable) | `AdminUserList.js` |

---

## 1.9 Database Tables

| Table | Description |
|-------|-------------|
| `tenants` | Independent organizations. Each tenant's data is fully isolated via RLS. Has `tenant_type` (`managed` or `self_service`). |
| `tenant_settings` | Per-tenant approval workflow config (grant, budget, expense approval toggles). One row per tenant. |
| `invites` | Signup invite tokens for managed tenants (token, role, email, expiry, usage tracking). |
| `users` | Grantee, admin, and super_admin accounts (linked to Supabase auth via `user_id` UUID). Scoped to a tenant. Includes `tax_month` for tax reminder. |
| `grant_record` | Grant applications: name, amount, status, dates, approval notes |
| `budget_items` | Budget line items per grant: name, allocated amount, running totals. Each item has a `status` (`pending` / `approved` / `rejected`) — only approved items' expenses count toward totals |
| `expenses` | Expense entries per budget item: item name, amount spent, date. Each expense has a `status` (`pending` / `approved` / `rejected`) — only approved expenses count toward `grant_record.total_spent` and `budget_items.amount_spent` |
| `receipts` | Receipt file metadata for expenses (stored in Supabase Storage `receipts/` bucket) |
| `grant_attachments` | Supporting document metadata (stored in `grant-documents/` bucket) |
| `grant_status_history` | Audit trail of every status change (written automatically by DB trigger) |
| `grant_comments` | Admin comments on individual grants |
| `audit_log` | General-purpose audit log for inserts, updates, deletes |
| `notifications` | In-app notifications for users (created by DB triggers on status changes, comments, submissions). Realtime-enabled via Supabase Realtime. |

---

## 1.10 Environment Variables

Create `frontend/.env.local` for local development. This file is git-ignored.

| Variable | Required | Where to find it |
|----------|----------|------------------|
| `REACT_APP_SUPABASE_URL` | Yes | Supabase Dashboard → Project Settings → API → Project URL |
| `REACT_APP_SUPABASE_KEY` | Yes | Supabase Dashboard → Project Settings → API → anon / public key |

**Important:** Variables must start with `REACT_APP_` or they will be invisible to the app. They are baked into the JavaScript bundle at build time — restart the dev server after changing `.env.local`. Changing `.env.local` requires restarting `npm start` (in development) or re-running `npm run build` (for production). The Supabase URL and anon key end up inside the compiled JS files — this is normal and expected for Supabase anon keys, which are designed to be public. If you see the app sending requests to `undefined.supabase.co`, the env file is missing or mis-named.

**File:** `frontend/src/supabaseClient.js`

---

## 1.11 CSS System

All design tokens (colors, spacing, shadows, border radii, fonts) are CSS custom properties in `frontend/src/styles/variables.css`. Every component CSS file inherits them.

```css
/* In variables.css */
:root {
  --color-primary: #063F1E;    /* deep green */
  --color-gold:    #D89F01;    /* heritage gold */
  --spacing-md:    1rem;
  --radius-md:     8px;
  --shadow-md:     0 4px 8px rgba(0, 0, 0, 0.08);
}

/* In any component CSS */
.my-button {
  background: var(--color-primary);
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
}
```

Never hardcode a color or spacing value in component CSS — use the variable, or add a new one to `variables.css` if the value isn't there yet.

```css
/* Correct — use the variable */
color: var(--color-primary);

/* Wrong — hardcoded value */
color: #063F1E;
```

- **Brand colors**: deep green `#063F1E` (primary), heritage gold `#D89F01` (accent).
- **Fonts**: Libre Baskerville (headings), Montserrat (body).
- **Neutrals**: 
  - White: `#FFFFFF` - Backgrounds, text on dark
  - Light Beige: `#F9F8F6` - Page backgrounds, section dividers
  - Light Gray: `#E3E3E3` - Borders, input fields
  - Medium Gray: `#888888` - Subtext, icons
  - Dark Gray: `#222222` - Main Body Text

---

## 1.12 Architecture Documentation

The following documents describe the multi-tenant and approval architecture that is **fully implemented** in the current codebase (Stages 33–39).

| Document | What it covers |
|----------|---------------|
| `12-Future-Multi-Tenancy.md` | Multi-tenant isolation: `tenants` table, `tenant_id` on every table, RLS with `current_tenant_id()`, storage path prefixes, super_admin role |
| `13-Future-Approval-Config.md` | Configurable approval workflows: `tenant_settings` flags, BEFORE INSERT auto-approval triggers, `/admin/settings` page |
| `14-Future-Two-Tier-SaaS.md` | Two tenant types: **managed** (invite-based, configurable approvals) and **self-service** (open signup, auto-approve, no admin role). Covers `provision_self_service_tenant()` RPC, invite tokens, `enforce_self_service_role()` trigger |

These documents were originally design specs and now serve as architecture reference. The implementation was done in order: doc 12 → doc 13 → doc 14.

---

# Part 2: React & Supabase Patterns

This section explains the non-obvious patterns used in the GrantTrail codebase. It assumes you know JavaScript but may be new to React hooks or Supabase. For each pattern, the exact file where it appears is noted so you can read the real code alongside this guide.

---

## 2.1 RLS Silent Failures

Supabase uses Row Level Security (RLS) — database policies that control which rows a user can see. When a policy denies access, the query returns **`null` data and `null` error** — not an exception.

```js
// A grantee trying to view another user's grant:
const { data, error } = await supabase
  .from('grant_record')
  .select('*')
  .eq('id', someOthersGrantId)
  .single();

// Result:  data = null,  error = null
// NOT:     error = { message: 'Access denied' }
```

This means UI code always needs a null check:

```js
if (!data) {
  setError('Grant not found.');
  return;
}
setGrant(data);
```

**Files:** `GrantDetail.js`, `GrantBreakdown.js`, `AdminGrantReview.js`

---

## 2.2 Database Triggers Do Work For You

Several things happen automatically in the database when you insert or update a record — you don't need to write extra code for them:

- **Status history:** When you change `grant_record.status`, a new row appears in `grant_status_history` automatically (via `trg_grant_status_tracking`)
- **Budget totals:** When you insert/update/delete an expense, `budget_items.amount_spent` and `grant_record.total_spent` / `remaining_balance` are recalculated automatically

This is why you won't find code in the frontend that manually inserts into `grant_status_history` — the trigger handles it.

**Schema file:** `backend/01-Complete-Fresh-Setup.sql` (Section 4: Triggers)

---

## 2.3 Supabase Storage — Signed URLs

Files in Supabase Storage buckets are private (controlled by RLS policies). You can't link to them directly. To let a user view a file, you create a short-lived signed URL:

```js
// GrantAttachments.js
const { data, error } = await supabase.storage
  .from('grant-documents')        // bucket name
  .createSignedUrl(att.file_path, 60);   // 60-second expiry

if (data?.signedUrl) {
  window.open(data.signedUrl, '_blank'); // open PDF/image in new tab
}
```

The 60-second expiry means the URL can't be bookmarked or shared — the user gets a fresh URL each time they click "View". Storage paths are stored in the database (`grant_attachments.file_path`, `receipts.receipt_files`).

**File:** `GrantAttachments.js` — `handleView` function

---

## 2.4 Compensating Transactions (Manual Rollback)

Supabase JS has no client-side transactions. If you upload a file to Storage and then the database insert fails, the file is now an orphan. The pattern used here is a manual compensating delete:

```js
// GrantAttachments.js — upload first, then DB insert
const { error: uploadErr } = await supabase.storage
  .from('grant-documents')
  .upload(storagePath, file);

if (uploadErr) throw new Error(uploadErr.message);

const { error: dbErr } = await supabase.from('grant_attachments').insert({ ...payload });
if (dbErr) {
  // Compensate: delete the orphaned file
  await supabase.storage.from('grant-documents').remove([storagePath]);
  throw dbErr;
}
```

The same pattern appears in `AddExpenseModal.js` — if the receipt file uploads but the expense DB insert fails, the expense row is deleted to avoid orphan data.

**Files:** `GrantAttachments.js`, `AddExpenseModal.js`

---

## 2.5 The `useCallback` + `useEffect` Combination

This pattern solves a specific problem: you want to define an async data-fetching function and also call it from button clicks (not just on mount). If you define the function inside `useEffect`, you can't call it from elsewhere. If you define it outside and list it as a `useEffect` dependency, you get an infinite loop.

The solution is `useCallback`:

```js
// AdminGrantReview.js
const load = useCallback(async () => {
  const { data: g } = await supabase.from('grant_record').select('*').eq('id', id).single();
  setGrant(g);
  // ... more fetching
}, [id]);  // only recreates the function when `id` changes

useEffect(() => {
  load();
}, [load]);  // runs whenever `load` changes (= whenever `id` changes)
```

After a successful admin action, the code calls `load()` directly to refresh the data — the same function, no extra logic needed.

**File:** `AdminGrantReview.js`

---

## 2.6 IIFE in JSX for Inline Chart Calculations

Some components need to compute derived data (for charts) without adding extra state or `useEffect`. An Immediately Invoked Function Expression (IIFE) inside JSX lets you run code and return JSX inline:

```jsx
// ExpenseReports.js — charts section
{items.length > 0 && (() => {
  // Calculate monthly spending from `items` state
  const monthlyMap = {};
  items.forEach(item => { ... });
  const monthlyData = Object.entries(monthlyMap).map(...);

  // Calculate spending by grant
  const byGrantData = grants.map(...).filter(d => d.value > 0);

  return (
    <div className="charts-row">
      <BarChart data={monthlyData} ... />
      <PieChart ... />
    </div>
  );
})()}
```

The `(() => { ... })()` syntax means: define a function and call it immediately. This is equivalent to extracting the logic into a helper function, but keeps it co-located with the JSX it produces.

**Files:** `ExpenseReports.js`, `GrantDetail.js`

---

## 2.7 Two-Click Delete (Without a Modal)

`GrantAttachments.js` implements a confirm-before-delete pattern without needing a popup modal. The component tracks which item is "armed" for deletion:

```js
// GrantAttachments.js
const [deletingId, setDeletingId] = useState(null);

const handleDelete = async (att) => {
  if (deletingId !== att.id) {
    setDeletingId(att.id);  // First click: arm this item
    return;
  }
  // Second click on the same item: execute deletion
  await supabase.storage.from('grant-documents').remove([att.file_path]);
  await supabase.from('grant_attachments').delete().eq('id', att.id);
  setDeletingId(null);
  await fetchAttachments();
};
```

In the render, the button text changes based on whether this item is armed:

```jsx
<button onClick={() => handleDelete(att)}>
  {deletingId === att.id ? 'Confirm?' : 'Delete'}
</button>
```

Clicking anywhere else (or a different delete button) doesn't reset the state, but in practice the confirmation window is small enough that users understand it.

**File:** `GrantAttachments.js` — `handleDelete` function

---

## 2.8 `Set` for O(1) Membership Lookup

`ExpenseReports.js` fetches receipt data once and stores which expense IDs have receipts as a JavaScript `Set`. This avoids scanning an array for every row in the expense table when rendering:

```js
// State
const [expensesWithReceipt, setExpensesWithReceipt] = useState(new Set());

// Fetch once after expenses load
const { data: receiptData } = await supabase
  .from('receipts')
  .select('expense_id')
  .in('expense_id', itemData.map(i => i.id));

setExpensesWithReceipt(new Set(receiptData.map(r => r.expense_id)));

// In table render — each row is O(1) instead of O(n)
{expensesWithReceipt.has(item.id)
  ? <Link>View receipt</Link>
  : <span>—</span>
}
```

A `Set` lookup (`has()`) is O(1). An array scan (`array.find()`) is O(n). For tables with hundreds of rows, Sets are noticeably faster.

**File:** `ExpenseReports.js`

---

## 2.9 Fetching Multiple Related Records in One Query (`.in()`)

To fetch all expenses for a user's grants without running one query per grant:

```js
// ExpenseReports.js
// Step 1: get all grants for this user
const { data: grantData } = await supabase
  .from('grant_record')
  .select('*')
  .eq('user_id', session.userRecord.id);

// Step 2: get all expenses for all those grants in one query
const { data: itemData } = await supabase
  .from('expenses')
  .select('*')
  .in('grant_id', grantData.map(g => g.id));
// SQL equivalent: WHERE grant_id IN (1, 2, 3, 4, ...)
```

This is more efficient than a separate `select` per grant and avoids N+1 query problems.

**File:** `ExpenseReports.js` — `fetchData` function

---

## 2.10 `.single()` vs Array Results

Without `.single()`, Supabase always returns data as an array:

```js
// Returns array
const { data } = await supabase.from('grant_record').select('*').eq('user_id', id);
// data = [ {id: 1, ...}, {id: 2, ...} ]

// Returns single row object (or null if not found)
const { data } = await supabase.from('grant_record').select('*').eq('id', id).single();
// data = { id: 1, grant_name: 'Community Outreach...', ... }
//   or  = null  (if the row doesn't exist or RLS denied it)
```

Use `.single()` when you know the query should return exactly one row (fetching by primary key, or fetching the current user's profile). Without it, you'd have to write `data[0]` everywhere and check `data.length > 0`.

**File:** `App.js`, `GrantDetail.js`, `GrantBreakdown.js`, `AdminGrantReview.js`

---

## 2.11 Intentional `eslint-disable` on useEffect Dependencies

```js
// GrantAttachments.js
useEffect(() => {
  if (grantId) fetchAttachments();
}, [grantId]); // eslint-disable-line react-hooks/exhaustive-deps
```

The linting rule `react-hooks/exhaustive-deps` wants you to list every value used inside a `useEffect` as a dependency — including `fetchAttachments`. But `fetchAttachments` is defined inside the component, so it would be recreated on every render, making the effect re-run on every render (infinite loop).

The `// eslint-disable-line` comment tells the linter "I know what I'm doing here." The effect should only run when `grantId` changes, not when the internal function reference changes. This is a deliberate omission, not a bug.

**File:** `GrantAttachments.js`

---

## 2.12 Modal Backdrop Click to Close

`AddExpenseModal.js` closes the modal when you click the dark overlay behind it — but not when you click the modal content itself. This is done by checking the CSS class of the click target:

```js
const handleBackdropClick = (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    onClose();
  }
};

// In JSX
<div className="modal-backdrop" onClick={handleBackdropClick}>
  <div className="modal-content">
    {/* Clicking here does NOT close because this div lacks the class */}
  </div>
</div>
```

An alternative approach (`e.target === e.currentTarget`) works similarly, but checking the class name is more readable and slightly more resilient if the wrapper structure changes.

**File:** `AddExpenseModal.js`

---

# Part 3: Troubleshooting

This section covers problems you are likely to encounter while developing or setting up GrantTrail, along with their root causes and fixes.

---

## 3.1 Authentication & Login

### Problem: Login succeeds but redirects back to the login page

**Symptom:** You enter the correct email and password. Supabase Auth accepts the login (no error message), but the app immediately redirects back to `/login`.

**Root cause:** The `users` table has a row for this email but `user_id` (the UUID column) is NULL. When App.js fetches the user record by UUID, it finds nothing and treats the session as invalid.

**Fix:** Run `05-After-User-Creation.sql` to link the Auth UUIDs to the `users` table rows. If you've added new users manually in Auth, add the corresponding UPDATE statement to that script:

```sql
UPDATE users
SET user_id = (SELECT id FROM auth.users WHERE email = 'new.user@example.com')
WHERE email = 'new.user@example.com';
```

---

### Problem: "Invalid login credentials" error

**Symptom:** Login fails with an error message about invalid credentials.

**Root cause options:**
1. Wrong password — reset it in Supabase Dashboard → Authentication → Users → click user → Reset password
2. No Auth account exists for this email — the user exists in the `users` table but was never created in Supabase Auth
3. Email confirmation is required but the email hasn't been confirmed

**Fix:** Check Supabase Dashboard → Authentication → Users. If the account is missing, create it. If "Email confirmed" is No, disable email confirmation for development (Auth → Providers → Email → toggle "Confirm email" off).

---

### Problem: Session loads but `session.userRecord` is null

**Symptom:** The app loads, doesn't redirect to login, but crashes or shows blank pages because `session.userRecord` is null.

**Root cause:** App.js successfully got the auth user but the `users` table query returned no rows — either because `user_id` is NULL (see above) or because the RLS policy is blocking the SELECT.

**Fix:** Check the browser console Network tab. Look for the Supabase request to `users?user_id=eq.<uuid>`. If it returns an empty array, the UUID isn't linked. If it returns an RLS error, check the policy in the Supabase Dashboard.

---

## 3.2 Database / RLS Errors

### Problem: Error 42P17 — infinite recursion in RLS policy

**Symptom:** Any Supabase query on the `users` table (including login) returns:
```
ERROR:  infinite recursion detected in policy for relation "users"
```

**Root cause:** An admin RLS policy was defined with an inline `EXISTS (SELECT 1 FROM users WHERE ...)` subquery, which causes Postgres to recursively check the policy while evaluating the policy itself.

**Fix:** This was the original bug and is fixed in `01-Complete-Fresh-Setup.sql` by using the `is_admin()` SECURITY DEFINER function. If you're running an older schema, run the patch:

```sql
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE user_id = auth.uid() AND role = 'admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Then update the offending policy (drop and recreate it using is_admin())
```

If you ran a fresh setup with `01-Complete-Fresh-Setup.sql`, this error should not occur.

---

### Problem: Grant, budget item, or expense query returns null with no error

**Symptom:** A component fetches a specific record by ID — `data` is null and `error` is also null. The record definitely exists in the database.

**Root cause:** RLS is silently denying the query. The logged-in user does not pass the row-level policy for the requested row — for example, a grantee trying to access another user's grant. See [Section 2.1 RLS Silent Failures](#21-rls-silent-failures) for more details on this behavior.

**Diagnosis:** Open the Supabase Dashboard → SQL Editor and run the query manually as a superuser:
```sql
SELECT * FROM grant_record WHERE id = <the-id>;
```
If it returns a row, RLS is the issue. Check which policies apply:
```sql
SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'grant_record';
```

**Fix:** Verify the logged-in user's integer `id` matches `grant_record.user_id`. If accessing an admin route, confirm the user actually has `role = 'admin'` in the `users` table.

---

### Problem: Audit log shows empty entries for budget_items and grant_record when an expense is added

**Symptom:** After adding a new expense, the audit log gains two extra rows (`budget_items UPDATE` and `grant_record UPDATE`) where the diff view shows "No tracked field changes".

**Root cause:** The totals trigger cascade — when an expense is inserted, triggers update `budget_items.amount_spent` and `grant_record.total_spent`. Because the new expense is `pending` (and only approved expenses count toward totals), the calculated values are identical to before. PostgreSQL still fires the audit triggers on those rows even though nothing changed.

**Fix:** This is already handled in `01-Complete-Fresh-Setup.sql` — the two audit trigger functions return early when `OLD IS NOT DISTINCT FROM NEW`. If you see this on a fresh setup, verify that you ran the latest version of the schema script.

---

### Problem: Budget item or grant totals are wrong / not updating

**Symptom:** After adding or deleting an expense, `budget_items.amount_spent` or `grant_record.total_spent` and `remaining_balance` don't reflect the change.

**Root cause options:**
1. The frontend is displaying stale state — the component hasn't re-fetched after the mutation
2. A trigger is not firing because the insert used a direct SQL query that bypassed the trigger

**Important:** Only **approved** expenses count toward `budget_items.amount_spent` and `grant_record.total_spent`. If an expense is `pending` or `rejected`, it will not appear in the totals even if the trigger fires correctly. This is expected — an admin must approve the expense first.

**Fix (frontend stale state):** After every insert/update/delete on `expenses`, call `fetchData()` to refresh the component state. This is already done in `GrantBreakdown.js` via the `onSuccess` callback.

**Fix (trigger not firing):** Verify triggers exist:
```sql
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;
```
If the triggers are missing, the schema was not set up with `01-Complete-Fresh-Setup.sql`. Run a teardown and setup again.

---

## 3.3 Frontend / React Issues

### Problem: App shows blank white page on load

**Symptom:** The browser shows a completely blank page. No error in the UI.

**Root cause:** Almost always a JavaScript error during load. Most common cause: missing environment variables.

**Diagnosis:** Open the browser developer console (F12 → Console). Look for errors. If you see:
- `TypeError: Cannot read properties of undefined` near Supabase — the env vars are missing
- Network requests going to `undefined.supabase.co` — same cause

**Fix:** Check that `frontend/.env.local` exists and contains both `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_KEY`. Restart `npm start` after creating or modifying the file.

---

### Problem: Charts not rendering / showing empty state

**Symptom:** The chart area shows the "No data" empty state message even though data exists.

**Root cause options:**
1. The data fetch failed silently — state array is empty
2. The data exists but the chart data derivation produces zero-value entries (filtered out)
3. recharts rendering issue with zero-height container

**Diagnosis:** Add a temporary `console.log` of the state variable being passed to the chart calculation. Verify the data is non-empty and non-zero.

**Fix for recharts container issue:** Ensure the `<ResponsiveContainer>` has a fixed `height` prop (e.g. `height={240}`). Without it, recharts sometimes renders at 0px height.

---

### Problem: "View receipt" link missing for expenses that have receipts

**Symptom:** An expense definitely has a receipt in the database, but the Expense Reports table shows `—` instead of "View receipt".

**Root cause:** The `receipts` table has a row for this expense, but `expense_id` doesn't match the `expenses.id`. This can happen with test data that was inserted manually without matching IDs.

**Diagnosis:** Run in SQL Editor:
```sql
SELECT r.id, r.expense_id, e.id AS actual_expense_id
FROM receipts r
LEFT JOIN expenses e ON r.expense_id = e.id
WHERE e.id IS NULL;
```
Orphaned receipt rows (where `e.id IS NULL`) are the cause.

**Fix:** Either delete the orphaned receipt rows, or update `expense_id` to match the correct expense.

---

### Problem: Budget allocation validation doesn't block over-allocation

**Symptom:** You can add budget items whose total exceeds the grant amount.

**Root cause:** `BudgetItemModal.js` only validates if `grantAmount` and `totalAllocated` props are passed. If the modal is opened without these props, validation is skipped.

**Fix:** Confirm `GrantBreakdown.js` passes both props when rendering `BudgetItemModal`:
```jsx
<BudgetItemModal
  grantAmount={grant.grant_amount || 0}
  totalAllocated={totalAllocated}
  ...
/>
```
`totalAllocated` is computed in `GrantBreakdown.js` as `budgetItems.reduce((s, bi) => s + (bi.budget_allocated || 0), 0)`.

---

## 3.4 File Upload Issues

### Problem: Receipt or attachment upload fails with a storage error

**Symptom:** The modal shows an upload error. Network tab shows a 400 or 403 from Supabase Storage.

**Root cause options:**
1. Storage bucket doesn't exist — the script that creates it wasn't run
2. RLS policy on `storage.objects` is blocking the upload
3. File type or size exceeds the frontend limit (but the check should happen before upload)

**Fix — check buckets exist:**
```sql
SELECT id, name, public FROM storage.buckets;
-- Should show 'receipts' and 'grant-documents'
```
If missing, run `01-Complete-Fresh-Setup.sql` again (it uses `ON CONFLICT DO NOTHING` so it's safe to re-run the bucket creation part).

**Fix — check storage policies:** In Supabase Dashboard → Storage → Policies, confirm policies exist for both buckets. If missing, they're in Section 5 of `01-Complete-Fresh-Setup.sql`.

---

### Problem: "Could not open file" when clicking View on an attachment

**Symptom:** Clicking "View" on an uploaded attachment shows an alert saying the file couldn't be opened.

**Root cause:** The signed URL creation failed. This can happen if:
1. The file was deleted from Storage but the database row still exists
2. The `file_path` stored in `grant_attachments` doesn't match the actual storage path

**Diagnosis:** In Supabase Dashboard → Storage → grant-documents, check whether the file actually exists at the path stored in `grant_attachments.file_path`.

---

## 3.5 Resetting Test Data

### How to completely reset and start over

```
1. SQL Editor: run 00-Full-Teardown.sql
   - Drops all tables, functions, and RLS policies

2. Supabase Dashboard → Storage → receipts
   - Select all files → Delete

3. Supabase Dashboard → Storage → grant-documents
   - Select all files → Delete

4. Supabase Dashboard → Authentication → Users
   - Delete all test user accounts

5. SQL Editor: run 01-Complete-Fresh-Setup.sql
6. SQL Editor: run 02-Sample-Data.sql
7. Auth: recreate test user accounts (maria, jacob, faizan, eric)
8. SQL Editor: run 05-After-User-Creation.sql
```

### How to reset only the expense data (keep grants and budget items)

```sql
DELETE FROM receipts;      -- clears all receipt metadata
DELETE FROM expenses;      -- clears all expenses (triggers update totals to 0)
-- Storage files in the 'receipts' bucket still need manual deletion via Dashboard
```

### How to randomize expense dates for better charts

After inserting sample data, run `06-Randomize-Expense-Dates.sql` to spread expense dates across each grant's spend period. This makes the Monthly Spending chart more interesting.
