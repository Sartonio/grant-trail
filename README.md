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
├── frontend/                      # React SPA (Vite + Playwright + Vitest)
│   ├── src/                       # Components, hooks, and context
│   │   ├── components/            # UI components and pages
│   │   ├── hooks/                 # Custom state hooks
│   │   └── lib/                   # API, billing, and auth helpers
│   ├── package.json               # Dependencies and scripts (includes local Supabase CLI)
│   └── .env.example               # Pre-filled template for local development keys
│
├── supabase/                      # Edge Functions, Database Migrations, & Seeds
│   ├── migrations/                # Supabase database schema migrations (squashed schema)
│   ├── functions/                 # Stripe checkout, webhooks, billing portal
│   └── seed.sql                   # Seed data for local dev (users, tenants, and mock grants)
│
├── docs/                          # Project documentation (tutorials, how-to, reference, explanation)
└── package.json                   # Root-level command delegation wrappers
```

---

## 💻 Quick Start Guide

You can bootstrap the entire development environment (database + auth + frontend) in just three commands, starting from absolute zero.

### Prerequisites
Make sure you have **Node.js 18+**, **npm**, and **Docker** installed and running on your local machine.

### Setup Instructions
Run these commands from the repository root:

```bash
# 1. Install dependencies & configure local environment
npm run setup

# 2. Start the local database (Supabase Docker containers + migrations + seed data)
npm run db:start

# 3. Start the frontend React development server
npm run dev
```

*Note: The local setup runs completely offline, uses deterministic API keys pre-configured in `.env.example`, and automatically seeds test auth users. You do not need to register accounts manually.*

---

## 📖 Documentation Index

This repository organizes comprehensive documentation into the four Diátaxis quadrants under the `docs/` folder:

### 1. Tutorials (Learning-Oriented)
* **[Local Onboarding Guide](file:///home/ryan/Documents/grant-trail/docs/tutorials/local_onboarding.md):** Step-by-step local workspace and database setup.
* **[AI Setup & Bootstrap Prompt](file:///home/ryan/Documents/grant-trail/docs/tutorials/ai_setup_prompt.md):** Command guide for bootstrapping environment in AI agents.
* **User Walkthroughs:** Step-by-step UI guides containing screen-by-screen walkthroughs:
  - **Grantee Walkthrough:** [Markdown Guide](file:///home/ryan/Documents/grant-trail/docs/tutorials/Grantee-Walkthrough.md) | [HTML Version](file:///home/ryan/Documents/grant-trail/docs/tutorials/Grantee-Walkthrough.html)
  - **Admin Walkthrough:** [Markdown Guide](file:///home/ryan/Documents/grant-trail/docs/tutorials/Admin-Walkthrough.md) | [HTML Version](file:///home/ryan/Documents/grant-trail/docs/tutorials/Admin-Walkthrough.html)
  - **Super Admin Walkthrough:** [Markdown Guide](file:///home/ryan/Documents/grant-trail/docs/tutorials/Super-Admin-Walkthrough.md) | [HTML Version](file:///home/ryan/Documents/grant-trail/docs/tutorials/Super-Admin-Walkthrough.html)

### 2. How-To Guides (Task-Oriented)
* **[Staging & Production Deployment](file:///home/ryan/Documents/grant-trail/docs/how_to/deployment.md):** Cloud project setups, builds compilation, and FTP uploads.
* **[Super Admin Promotion Workflow](file:///home/ryan/Documents/grant-trail/docs/how_to/promote_superadmin.md):** Securely promoting registered users to Super Admin.
* **[Making Database Schema Changes](file:///home/ryan/Documents/grant-trail/docs/how_to/make_schema_changes.md):** Local-first database update operations.
* **[Resetting Test Data & Troubleshooting](file:///home/ryan/Documents/grant-trail/docs/how_to/reset_test_data.md):** Resetting local DB seeds and fixing common setup/login bugs.

### 3. Reference (Information-Oriented)
* **[Database Schema Specification](file:///home/ryan/Documents/grant-trail/docs/reference/database_schema.md):** Details of all tables, columns, constraints, and triggers.
* **[Entity Relationship Diagram (Mermaid)](file:///home/ryan/Documents/grant-trail/docs/reference/er_diagram.md):** Structural diagram of database entities.
* **[Application Routing Index](file:///home/ryan/Documents/grant-trail/docs/reference/routing_index.md):** Path mappings, page components, and role access list.
* **[CSS Variables & Design Tokens](file:///home/ryan/Documents/grant-trail/docs/reference/css_design_tokens.md):** Style custom variables and guidelines.

### 4. Explanation (Understanding-Oriented)
* **[Multi-Tenant & System Architecture](file:///home/ryan/Documents/grant-trail/docs/explanation/system_architecture.md):** Isolation bounds, configurable triggers, and SaaS tier architecture.
* **[Authentication Flow details](file:///home/ryan/Documents/grant-trail/docs/explanation/authentication_flow.md):** UUID vs. integer Profile PK lookup logic.
* **[React & Supabase Coding Patterns](file:///home/ryan/Documents/grant-trail/docs/explanation/development_patterns.md):** Silent RLS, storage uploads, and React hooks configurations.
