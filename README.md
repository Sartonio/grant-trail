# GrantTrail

GrantTrail is a multi-tenant web application for non-profits and public sector organizations to manage grant funding, budget allocations, expense reporting, and administrative review workflows.

Built with **React** on the frontend and **Supabase** (Postgres, Auth, Storage, and Edge Functions) on the backend. Supports independent workspaces, configurable approval workflows, and Stripe-based subscription billing.

> [!NOTE]
> **Deployment:** production is deployed from this repo by the **Deploy to
> Production** GitHub Actions workflow (manual trigger).
> All prod config has one source of truth — `.deploy/production.env`, synced to the
> GitHub `production` environment with `npm run deploy:secrets`. See the
> [Production Setup](docs/how_to/prod_setup.md).

---

## Key Features

- **Multi-tenant isolation** — Independent workspaces (managed or self-service) with database-level tenant isolation via Postgres Row Level Security. RLS is the enforcement boundary — the frontend mirrors it for UX, but access is decided in the database.
- **Subscription billing** — Stripe integration for tier-based access with admin waiver support
- **Role-based workflows** — Three roles with distinct interfaces: **grantees** (own grants/expenses), **tenant admins** (review workflows for their workspace), and **platform super admins** (operate across tenants via `/super/tenants`). `/grants*` and `/expenses` are grantee-only; an admin whose tenant subscription has lapsed keeps **read-only** admin access rather than being locked out.
- **Tenant-agnostic platform root** — The platform-root workspace is config-driven via `platform_settings.platform_root_slug` (default `'tfac'`), not hardcoded.
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
│   │   └── tests/                 # Shell-based payment-flow integration tests
│   ├── tests/                     # RLS adversarial / platform-root SQL tests
│   └── seed.sql                   # Local dev seed data
│
├── scripts/                       # CLI automation (deploy, promote admin)
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

`npm run setup` also installs a git **pre-push hook** (via `core.hooksPath`) that blocks pushes containing local database changes not captured in a migration file. It uses the same Docker-based local stack as `npm run db:start`, so no extra tooling is required — just have Docker running and the local DB started. See [Dev Practices](docs/how_to/dev_practices.md).

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

### Setup & deploy — the three flows
- [Dev Setup](docs/how_to/dev_setup.md) — local environment from scratch
- [Staging Setup](docs/how_to/staging_setup.md) — staging project + deploy
- [Production Setup](docs/how_to/prod_setup.md) — production bootstrap + deploy

### How-To Guides
Task-oriented guides for specific goals:
- [Dev Practices](docs/how_to/dev_practices.md) — schema changes, resets, promote admin, troubleshooting
- [Local Stripe / Billing Testing](docs/how_to/local_stripe_testing.md)
- [Local Email Testing](docs/how_to/local_email_testing.md)

### Tutorials
Step-by-step guides for learning by doing:
- [Grantee Walkthrough](docs/tutorials/Grantee-Walkthrough.md)
- [Admin Walkthrough](docs/tutorials/Admin-Walkthrough.md)
- [Super Admin Walkthrough](docs/tutorials/Super-Admin-Walkthrough.md)

### Reference
Lookup material:
- [Environment Variables](docs/reference/environment_variables.md)
- [Conventions](docs/reference/conventions.md)
- [Pitfalls](docs/reference/pitfalls.md)
- [CSS Design Tokens](docs/reference/css_design_tokens.md)
- [Security Headers](docs/reference/security_headers.md)
- [Data Protection](docs/reference/data_protection.md)
- [Test Users & Signup](docs/reference/test_users_and_signup.md)

### Explanation
Background and design rationale:
- [System Architecture](docs/explanation/system_architecture.md)
- [Authentication Flow](docs/explanation/authentication_flow.md)
- [Development Patterns](docs/explanation/development_patterns.md)
- [Deploy Architecture](docs/explanation/deploy_architecture.md)
