# Local Onboarding Tutorial

This guide gets a new developer from zero to a running local environment and gives enough context to start contributing without asking questions.

---

## Key Terminology

- **Tenant** = the GrantTrail account (data isolation boundary, settings, admin control). Stored in `tenants` table.
- **Organization** = the real-world entity a user belongs to. Stored in `users.organization_name`. A managed tenant (e.g. TFAC) can have grantees from many different organizations.
- These are NOT interchangeable. See the [Architecture explanation](../explanation/system_architecture.md) for the full distinction.
- **User Roles & Business Mapping:**
  - **Grantee** (DB role: `'grantee'`) represents the **Applicant** or **Non-Profit** user.
  - **Admin** (DB role: `'admin'`) represents the **Fiscal Agent** or **Charity Admin** managing the tenant.
  - **Super Admin** (DB role: `'super_admin'`) represents the **Platform Admin** managing global configuration and tenants.

---

## 1. Project Overview

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

## 2. Prerequisites

Before you start, make sure you have:

- **Node.js 18+** and **npm** — verify with `node -v` and `npm -v`
- **Git**
- **Docker** — installed and running on your local machine (required for local Supabase)

---

## 3. Local Setup

Follow these steps to spin up the local development environment:

```bash
# 1. Clone the repo
git clone <repo-url>
cd grant-trail

# 2. Bootstrap dependencies and environment
npm run setup

# 3. Start local Supabase services (requires Docker running)
npm run db:start

# 4. Start the frontend development server
npm run dev
```

After running `npm run db:start`, the CLI will output your local credentials, URLs, and keys. Because the environment files are pre-configured, you do not need to copy-paste them manually.

---

## 4. Database Setup (Local-First Workflow)

The project uses the **Supabase CLI** and version-controlled migration files in `supabase/migrations/`. 

> [!WARNING]
> **DO NOT** make schema changes directly on cloud Supabase instances. All database schema changes must be driven through local development and generated into Git-tracked migration files. See the [How-To Guide on Schema Changes](../how_to/make_schema_changes.md) for detail.

### Starting a Clean Database
When you run `supabase start` (or when you want to start completely fresh):
1. The CLI spins up a local Postgres database.
2. It automatically applies all SQL migrations in `supabase/migrations/` sequentially.
3. It automatically executes `supabase/seed.sql` to populate sample tenants, users, grants, budget items, and expenses.

### Bootstrapping Local Auth Users
Because we have integrated the Auth UUIDs directly into the `supabase/seed.sql` file, **all test users are completely automated**. You do not need to manually create users in the Supabase Studio! 

The default test users (with password `password123`) are:
- `maria.smith@example.com` (Grantee)
- `jacob.soto@example.com` (Grantee)
- `faizan.sharp@example.com` (Grantee)
- `eric.hobbs@example.com` (Admin)
- `sam.reeves@example.com` (Super Admin)
- *See `seed.sql` for self-service and managed tenant 2 test accounts.*

### Connecting the Frontend
1. Create or edit `frontend/.env.local`:
   ```env
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_KEY=your-local-anon-key-here
   ```
   *Replace `your-local-anon-key-here` with the `anon key` printed in the terminal after running `supabase start`.*
2. Start the React app:
   ```bash
   cd frontend
   npm run dev
   ```

---

## 5. Project Structure

```
grant-trail/
├── frontend/                     # React application
│   ├── public/
│   └── src/
├── supabase/                     # Supabase local environment
│   ├── migrations/               # Version-controlled schema changes
│   ├── seed.sql                  # Auto-executed local sample data + Auth users
│   ├── large_sample_data.sql     # Optional script to insert mass data for UI testing
│   └── prod_setup.sql            # Optional script for production bootstrapping
├── tests/
│   └── load/                     # Load testing scripts
└── docs/                         # Project documentation + brand assets
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
        │   ├── SignUpClean.js            # Auth signup form (invite + self-service flows)
        │   ├── CompleteProfile.js        # Profile completion after OAuth/invite signup
        │   ├── ResetPassword.js          # Password reset page
        │   ├── LandingPage.js / .css     # Public landing page + logged-in home
        │   ├── NotificationBell.js / .css# Notification bell in header (realtime)
        │   ├── SubscriptionPage.js / .css# Stripe membership / subscription management
        │   ├── Grants.js / .css          # Grantee grants list with filter/search
        │   ├── GrantDetail.js / .css     # Single grant: info, status history, charts
        │   ├── GrantBreakdown.js / .css  # Budget items + expenses for a grant
        │   ├── CreateGrant.js / .css     # New grant form + edit grant form
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
        │   ├── AdminUserList.js          # Admin: user management — role toggle, enable/disable, membership status
        │   ├── AdminSettings.js          # Admin: tenant approval workflow settings
        │   ├── TenantManagement.js       # Super admin: create and manage all tenants
        │   └── Admin.css                 # Shared admin styles
        │
        ├── hooks/
        │   └── useGrantee.js     # Custom hook: fetch current user's DB record
        ├── lib/
        │   └── billing.js        # Stripe billing helpers: checkout, portal, membership status
        └── styles/
            ├── variables.css     # CSS custom properties (colors, spacing, fonts)
            ├── global.css        # Base element resets
            ├── utilities.css     # Utility classes
            ├── Forms.css         # Modal and form styles (shared)
            ├── Charts.css        # recharts card wrappers (shared)
            └── Login.css         # Auth page styles
```

---

## 6. Environment Variables

Create `frontend/.env.local` for local development. This file is git-ignored. Use `frontend/.env.example` (committed to the repo) as a template.

| Variable | Required | Used by | Where to find it |
|----------|----------|---------|-----------------|
| `VITE_SUPABASE_URL` | Yes | `supabaseClient.js`, `lib/billing.js` | Supabase Dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_KEY` | Yes | `supabaseClient.js`, `lib/billing.js` | Supabase Dashboard → Project Settings → API → anon / public key |

**Important:** Variables must start with `VITE_` or they will be invisible to the app. They are baked into the JavaScript bundle at build time — restart the dev server after changing `.env.local`. The Supabase URL and anon key end up inside the compiled JS files — this is normal and expected for Supabase anon keys, which are designed to be public. If you see the app sending requests to `undefined.supabase.co`, the env file is missing or mis-named.

**Note on `billing.js`:** In addition to the shared Supabase client, `lib/billing.js` reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` directly to construct authenticated HTTP calls to Supabase Edge Functions (Stripe checkout, billing portal, subscription sync). Both variables are required for billing flows to work.

> [!IMPORTANT]
> **Standard for Adding New Environment Variables:**
> When adding new environment variables to the project:
> 1. **Prefix**: Ensure the variable starts with `VITE_` so it is visible to the frontend client.
> 2. **Update `.env.example`**: You **must** add a placeholder value for the variable in `frontend/.env.example` (e.g., `VITE_STRIPE_KEY=""`).
> 3. **Avoid Runtime Crashes**: Ensure the codebase handles the variable being empty or undefined gracefully (e.g., disable the feature or show a fallback UI instead of crashing the app).
