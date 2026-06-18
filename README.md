# GrantTrail

GrantTrail is a multi-tenant web application for non-profits and public sector organizations to manage grant funding, budget allocations, expense reporting, and administrative review workflows.

Built with **React** on the frontend and **Supabase** (Postgres, Auth, Storage, and Edge Functions) on the backend. Supports independent workspaces, configurable approval workflows, and Stripe-based subscription billing.

> [!NOTE]
> **Deployment status:** merges to `main` deploy to a **staging** environment only — there is no production environment yet. Production will live in a separate GitHub repository wired to its own Supabase project. See the [Deployment Guide](docs/how_to/deployment.md). The Supabase GitHub integration is the single source of truth for schema deploys (migrations apply on merge; there is no manual `db push`).

---

## Key Features

- **Multi-tenant isolation** — Independent workspaces (managed or self-service) with database-level tenant isolation via Postgres Row Level Security
- **Subscription billing** — Stripe integration for tier-based access with admin waiver support
- **Role-based workflows** — Distinct interfaces for Grantees, Tenant Admins, and Platform Super Admins
- **Audit logging** — Trigger-based change log across all key tables
- **Realtime notifications** — Live updates via Supabase Realtime on status changes
- **Data visualization** — Recharts-based spending and budget charts throughout the app
- **Export** — CSV export on all tables; Excel export for financial reports

---

## Repository Structure

```text
grant-trail/
├── frontend/                      # React SPA (Vite + Playwright + Vitest)
│   ├── src/                       # Components, hooks, and lib helpers
│   ├── tests/                     # Unit and E2E test suites
│   └── .env.example               # Pre-filled template for local dev keys
│
├── supabase/                      # Backend
│   ├── migrations/                # Database schema migrations
│   ├── functions/                 # Edge Functions (Stripe, billing)
│   └── seed.sql                   # Local dev seed data
│
├── scripts/                       # CLI automation (deploy, promote admin)
├── tests/load/                    # k6 load test scripts
├── docs/                          # Project documentation
└── package.json                   # Root-level command delegation
```

---

## Quick Start

Bootstrap the full development environment in three commands:

**Prerequisites:** Node.js 18+, npm, and Docker installed and running.

```bash
# 1. Install dependencies & scaffold local env files
npm run setup

# 2. Start the local database (Docker + migrations + seed data)
npm run db:start

# 3. Start the frontend development server
npm run dev
```

The local setup runs completely offline, uses pre-configured deterministic API keys, and seeds test auth users automatically. No manual account creation is needed.

`npm run setup` also installs a git **pre-push hook** (via `core.hooksPath`) that blocks pushes containing local database changes not captured in a migration file. It uses the same Docker-based local stack as `npm run db:start`, so no extra tooling is required — just have Docker running and the local DB started. See [Making Schema Changes](docs/how_to/make_schema_changes.md).

### Test accounts

| Name | Email | Role |
|------|-------|------|
| Maria Smith | `maria.smith@example.com` | Grantee |
| Eric Hobbs | `eric.hobbs@example.com` | Admin |
| Sam Reeves | `sam.reeves@example.com` | Super Admin |

Password for all accounts: `password123`

---

## Documentation

Documentation is organized under `docs/` using the [Diátaxis](https://diataxis.fr) framework.

### Tutorials
Step-by-step guides for learning by doing:
- [Local Onboarding](docs/tutorials/local_onboarding.md) — full local setup walkthrough
- [Grantee Walkthrough](docs/tutorials/Grantee-Walkthrough.md)
- [Admin Walkthrough](docs/tutorials/Admin-Walkthrough.md)
- [Super Admin Walkthrough](docs/tutorials/Super-Admin-Walkthrough.md)

### How-To Guides
Task-oriented guides for specific goals:
- [Production Deployment](docs/how_to/deployment.md)
- [Making Schema Changes](docs/how_to/make_schema_changes.md)
- [Resetting Test Data](docs/how_to/reset_test_data.md)
- [Promoting a Super Admin](docs/how_to/promote_superadmin.md)
- [Local Stripe / Billing Testing](docs/how_to/local_stripe_testing.md)

### Reference
Lookup material:
- [Environment Variables](docs/reference/environment_variables.md)
- [Database Schema](docs/reference/database_schema.md)
- [RLS Policy Audit](docs/reference/rls_policy_audit.md)
- [ER Diagram](docs/reference/er_diagram.md)
- [Routing Index](docs/reference/routing_index.md)
- [CSS Design Tokens](docs/reference/css_design_tokens.md)
- [Coding Standards](docs/reference/coding_standards.md)
- [AI Context](docs/reference/ai_context.md)
- [AI Setup Prompt](docs/reference/ai_setup_prompt.md)

### Explanation
Background and design rationale:
- [System Architecture](docs/explanation/system_architecture.md)
- [Authentication Flow](docs/explanation/authentication_flow.md)
- [Development Patterns](docs/explanation/development_patterns.md)
- [Scalability & Performance](docs/explanation/scalability.md)
