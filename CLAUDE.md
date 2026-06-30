# CLAUDE.md — GrantTrail

First file to read when orienting in this repo. Keep it accurate; it is the source of truth for agents.

## What this is

GrantTrail is a multi-tenant grant-management web app for non-profits and public-sector orgs:
grants, budget allocations, expense reporting, and admin review workflows. The frontend is a
**React 19 + Vite SPA** (`frontend/`). The backend is **Supabase** — Postgres with Row Level
Security, Auth, Storage, and Edge Functions. **Stripe** powers subscription billing. Also ships a
Fiscal Agent / Charity Directory feature (seekers browse, charities own listings).

## Directory map

```text
frontend/src/
├── App.js                  # Router + route guards; the route table lives here
├── index.js                # React entry (+ Sentry)
├── supabaseClient.js       # The Supabase client — import from here, do not re-create
├── components/             # Domain-grouped (reorganized into these folders)
│   ├── admin/              # AdminDashboard, AdminGrantList/Review, AdminUserList,
│   │                       #   AdminSettings, AdminAuditLog, TenantManagement (/super)
│   ├── grant/              # Grants, GrantDetail, CreateGrant, GrantBreakdown,
│   │                       #   ExpenseReports, AddExpenseModal, BudgetItemModal, Main
│   ├── fiscalAgent/        # Charity Directory: Directory, Profile, ListingEditor,
│   │                       #   Inbox, OwnerDashboard, intake, checkout return, data/map
│   ├── auth/               # Login, SignUpClean, Join, CompleteProfile, ResetPassword
│   ├── billing/            # SubscriptionPage
│   ├── layout/             # Header, Footer, NotificationBell
│   ├── common/             # ReadOnlyBanner, ConfirmDialog, StatusBadge, ErrorFallback
│   └── landing/            # LandingPage
├── lib/                    # policy.js, guards.js, useWriteGuard.js, billing.js,
│   │                       #   invites.js, inquiries.js (+ co-located .test.js)
├── hooks/                  # useGrantee.js (session/role/membership)
├── utils/                  # grantsList.js
└── styles/                 # global.css, variables.css (design tokens), Forms/Charts/etc.

supabase/
├── migrations/             # YYYYMMDDHHMMSS_name.sql — schema + RLS (14 files)
├── functions/              # Edge Functions (Deno): create-checkout-session,
│   │                       #   create-basic-membership-checkout-session,
│   │                       #   create-fiscal-agent-checkout-session,
│   │                       #   create-billing-portal-session, sync-my-subscription,
│   │                       #   stripe-webhook, notify-inquiry, _shared/, tests/
├── tests/                  # RLS adversarial + platform-root SQL tests
├── seed.sql, config.toml   # local dev seed + CLI config
```

## Commands

The frontend lives in `frontend/`. Root scripts proxy via `--prefix frontend`; run from repo root.

| Command | What it does |
|---|---|
| `npm run setup` | Install deps + scaffold `.env` files + install git hooks |
| `npm run db:start` / `db:stop` / `db:reset` | Local Supabase stack (Docker + migrations + seed) |
| `npm run dev` | Vite dev server (http://localhost:3000) |
| `npm run build` | Production build to `frontend/dist/` |
| `npm test` | Vitest unit suite (once) |
| `npm run verify` | Definition-of-Done fast tier: lint + typecheck + unit tests |
| `npm run verify:full` | verify + security-critical stack tier (RLS, edge-fn, webhook, e2e; fail-open w/o Docker) |
| `npm run typecheck` (`--prefix frontend`) | `tsc --noEmit` over the load-bearing JS scope (checkJs) |
| `npm run db:types` (`--prefix frontend`) | Regenerate `lib/database.types.ts` from the local DB |
| `npm run e2e` / `e2e:install` | Playwright E2E suite / install browsers |
| `npm --prefix frontend run lint` | ESLint over `frontend/src` (no root proxy) |
| `npm run db:check` | `supabase db diff` — flag uncommitted schema drift |

Test accounts (local, password `password123`): `maria.smith@example.com` (grantee),
`eric.hobbs@example.com` (admin), `sam.reeves@example.com` (super admin).

## Load-bearing invariants (do not break)

- **RLS is the enforcement boundary.** The frontend only MIRRORS access rules for UX. Never rely on
  the UI to keep data safe — the database decides.
- **Access control is centralized** in `frontend/src/lib/policy.js` + `frontend/src/lib/guards.js`
  (the `<Guard>` component). Use them; do not write ad-hoc role/billing checks in components.
- **Roles: grantee / admin (tenant) / super_admin.** `/grants*` and `/expenses` are grantee-only;
  super admins operate across tenants via `/super/tenants`. **super_admin is billing-exempt.**
- **Lapsed-subscription admins keep READ-ONLY admin access** (gated, not locked out). Write paths go
  through `useWriteGuard` / `canMutate`; `<ReadOnlyBanner>` signals the state. Don't hard-redirect a
  lapsed admin off admin routes.
- **Platform root is tenant-agnostic** via `platform_settings.platform_root_slug` (default `'tfac'`).
  Never hardcode the platform-root tenant slug.
- **`grant_comments` are admin-only by design** — grantees cannot post comments. Don't "fix" this.
- **Migrations are `YYYYMMDDHHMMSS_name.sql`.** Any new table MUST get tenant-scoped RLS in the same
  migration. Schema changes only via a migration file (a pre-push hook blocks uncommitted DB drift).

## Required checks — Definition of Done (every agent, every change)

A change is NOT done until it meets these. Don't declare completion otherwise.

- **`npm run verify` must pass.** This is the fast tier every agent can run locally:
  `lint + typecheck + unit tests`. Run it from the repo root before saying a change is done.
- **Security-touching changes must ALSO pass `npm run verify:full`** — the stack tier (RLS
  adversarial, grant triggers, charity-directory RLS, platform-root config, edge-fn identity,
  Stripe webhook/checkout/portal matrix, Playwright e2e). "Security-touching" = anything under
  `supabase/migrations/`, `supabase/functions/`, `lib/policy.js`, `lib/guards.js`,
  `lib/billing.js`, or any data-mutating component. `verify:full` is fail-open when Docker/Stripe
  keys are absent (stack tier skipped with a warning) — run it where they exist.
- **NEW code uses the `lib/data/` access layer.** No raw `supabase.from(...)` in components; add or
  reuse a thin function in `frontend/src/lib/data/<entity>.js` (each typed to its table via the
  generated `lib/database.types.ts`). Components import from there.
- **Types stay honest.** After any migration, regenerate `lib/database.types.ts`
  (`npm run db:types --prefix frontend`); annotate new `lib/`/`hooks/` code with JSDoc so
  `npm run typecheck` stays green over the enforced scope.
- **Structure conventions hold:** co-locate `.css` and `.test.js` next to their module; keep modules
  small / single-responsibility; follow the existing domain-folder layout.

## Conventions

- **Plain JavaScript, no TypeScript.** Function components + hooks only.
- Co-locate `.css` and `.test.js` next to the component/module they belong to.
- Tests: **Vitest** (unit) + **Playwright** (E2E under `frontend/tests/e2e/`).
- Always import the Supabase client from `frontend/src/supabaseClient.js`.
- Design tokens live in `frontend/src/styles/variables.css` — use them over hardcoded values.

## Project subagents

Defined in `.claude/agents/` — prefer them for their domains:
- **migration-author** — writing new Supabase migrations (naming + tenant-scoped RLS).
- **rls-reviewer** — auditing RLS policies for cross-tenant / escalation holes.
- **component-builder** — building React components to the conventions above.

## Docs

Full docs under `docs/` (Diátaxis: `tutorials/`, `how_to/`, `reference/`, `explanation/`, `roadmap/`).
Start with `docs/AI-FRIENDLY-PLAN.md` for the AI-agent-oriented overview.
