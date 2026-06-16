# GrantTrail

GrantTrail is a modern, multi-tenant web application designed for non-profits and public sector organizations to manage grant funding, budget allocations, expense reporting, and administrative review workflows. 

Built with **React** on the frontend and **Supabase** (Postgres, Auth, Storage, and Edge Functions) on the backend, the platform supports independent workspaces, automated workflows, and Stripe-based subscription billing.

---

## 🚀 Key Features

* **Multi-Tenant Isolation:** Supports independent workspaces (managed or self-service) with database-level tenant isolation using Postgres Row-Level Security (RLS).
* **Subscription & Billing:** Integrated with Stripe for tier-based subscription access (Basic and Premium) with auto-provisions and admin waivers.
* **Role-Based Workflows:** Distinct interfaces and permissions for Grantees (submit grants, log expenses, upload receipts), Tenant Admins (review grants, manage users, waive subscriptions), and Platform Super Admins (tenant management, defaults config).
* **Audit Logging:** Comprehensive, trigger-based change log that records inserts, updates, and deletes across key database tables.
* **In-App Realtime Notifications:** Live updates via Supabase Realtime when grants, budgets, or expenses change status.
* **Data Visualization:** Built-in charts (using Recharts) for grant spending, budget distribution, and overall funding tracking.
* **Export Options:** Supports exporting tables to CSV, and premium Excel exports for detailed financial reports.

---

## 📂 Repository Structure

```text
grant-trail/
├── backend/                       # Database layer
│   ├── 00-Full-Teardown.sql       # Wipe database tables/functions
│   ├── 03-Large-Sample-Data.sql   # Large grant load testing (50+ grants)
│   ├── 04-Check-Missing-Auth-Users.sql # Dev utility to track Auth status
│   ├── 05-After-User-Creation.sql # Link seeded database profiles to Auth UUIDs
│   ├── 06-Randomize-Expense-Dates.sql # Randomize dates for testing charts
│   ├── 21-PROD-Setup.sql          # Production bootstrap script
│   └── 22-Admin-Subscription-Update.sql # Database migration/patch script
│
├── frontend/                      # React SPA
│   ├── public/                    # Assets and index.html
│   ├── src/                       # Components, hooks, and context
│   │   ├── components/            # UI components and pages
│   │   ├── hooks/                 # Custom state hooks
│   │   └── lib/                   # API, billing, and auth helpers
│   └── package.json               # Dependencies and scripts
│
├── supabase/                      # Edge Functions, Database Migrations, & Seeds
│   ├── migrations/                # Supabase database schema migrations
│   ├── functions/                 # Stripe checkout, webhooks, billing portal
│   └── seed.sql                   # Seed data for local dev (10 users, 4 tenants)
│
└── docs/                          # Project documentation and walkthroughs
```

---

## 💻 Quick Start Guide

### 1. Database & Supabase Setup
1. Create a new project on [Supabase](https://supabase.com).
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started).
3. Start the local database, which will automatically apply schema migrations and seed data:
   ```bash
   supabase start
   ```
4. Set up the environment variables in `frontend/.env.local` using your local project API credentials (or remote if deploying):
   ```env
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_KEY=your-anon-public-key
   ```

### 2. Loading Development Seeding
If you are developing locally, `supabase start` already seeds your database via `supabase/seed.sql`.
To re-apply migrations and reset the seed data anytime, simply run:
```bash
supabase db reset
```
2. Create Auth accounts manually in your Supabase dashboard (**Authentication → Users**) matching the seeded emails (e.g., `eric.hobbs@example.com`, `maria.smith@example.com`, `sam.reeves@example.com`).
3. Run `backend/05-After-User-Creation.sql` to link the database profile records to the new Auth UUIDs.

### 3. Run the Frontend
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm start
   ```

---

## 📖 Documentation Index

The repository contains comprehensive guides, architecture specs, and step-by-step walkthroughs to help developers, administrators, and super administrators navigate and manage the system:

* **[Developer Onboarding & Guide](file:///home/ryan/Documents/grant-trail/DEVELOPER.md):** In-depth local setup, project structure, routing patterns, Auth architecture, and helper scripts.
* **[Deployment & FTP Guide](file:///home/ryan/Documents/grant-trail/DEPLOYMENT.md):** Manual Supabase configuration, environment files setup, React builds compilation, and Apache server `.htaccess` routing instructions.
* **[System Architecture Spec](file:///home/ryan/Documents/grant-trail/ARCHITECTURE.md):** Architectural boundaries, tenant type comparisons (managed vs. self-service), and custom database trigger behaviors.
* **[Database Schema Reference](file:///home/ryan/Documents/grant-trail/DATABASE.md):** Data types, indices, constraints, RLS policies, and database triggers.
* **[ER Diagram (Mermaid)](file:///home/ryan/Documents/grant-trail/docs/ER-Diagram.md):** Graphic representation of entity relations and associations.
* **[Stage-by-Stage Changelog](file:///home/ryan/Documents/grant-trail/CHANGELOG.md):** Complete version history and commit diff notes.
* **[API Specification](file:///home/ryan/Documents/grant-trail/API.md):** (Placeholder) OpenAPI/Swagger endpoint reference and request/response models.
* **[Security Policy](file:///home/ryan/Documents/grant-trail/SECURITY.md):** (Placeholder) Vulnerability disclosure policy and reporting process.
* **[Runbooks & Disaster Recovery](file:///home/ryan/Documents/grant-trail/RUNBOOK.md):** (Placeholder) Operations runbooks, alert response steps, and database failover processes.

### Persona-Based Walkthroughs

Step-by-step UI guides including screen-by-screen navigation and workflows:
* **Grantee Walkthrough:** [Markdown Guide](file:///home/ryan/Documents/grant-trail/docs/Grantee-Walkthrough.md) | [HTML Version](file:///home/ryan/Documents/grant-trail/docs/Grantee-Walkthrough.html)
* **Admin Walkthrough:** [Markdown Guide](file:///home/ryan/Documents/grant-trail/docs/Admin-Walkthrough.md) | [HTML Version](file:///home/ryan/Documents/grant-trail/docs/Admin-Walkthrough.html)
* **Super Admin Walkthrough:** [Markdown Guide](file:///home/ryan/Documents/grant-trail/docs/Super-Admin-Walkthrough.md) | [HTML Version](file:///home/ryan/Documents/grant-trail/docs/Super-Admin-Walkthrough.html)
