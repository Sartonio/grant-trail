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
│   │                       #   invites.js, inquiries.js, format.js, storage.js
│   │                       #   (+ co-located .test.js)
│   └── data/               # per-entity access layer (grants, expenses, ...) — see DoD
├── hooks/                  # useSession, useMembership, useNotifications, etc.
│   │                       #   (session/role/membership + data-fetching)
├── utils/                  # grantsList.js
└── styles/                 # global.css, variables.css (design tokens), Forms/Charts/etc.

supabase/
├── migrations/             # YYYYMMDDHHMMSS_name.sql — squashed_schema baseline + new ones
├── functions/              # Edge Functions (Deno): create-checkout-session,
│   │                       #   create-billing-portal-session, sync-my-subscription,
│   │                       #   stripe-webhook, notify-inquiry, _shared/, tests/
├── tests/                  # RLS adversarial + platform-root SQL tests
├── seed.sql, config.toml   # local dev seed + CLI config
```

## Commands

The frontend lives in `frontend/`. Root scripts proxy via `--prefix frontend`; run from repo root.

| Command                                             | What it does                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run setup`                                     | Install deps + scaffold `.env` files + install git hooks                                 |
| `npm run db:start` / `db:stop` / `db:reset`         | Local Supabase stack (Docker + migrations + seed)                                        |
| `npm run dev`                                       | Vite dev server (http://localhost:3000)                                                  |
| `npm run build`                                     | Production build to `frontend/dist/`                                                     |
| `npm test`                                          | Vitest unit suite (once)                                                                 |
| `npm run verify`                                    | Definition-of-Done fast tier: lint + typecheck + unit tests                              |
| `npm run verify:full`                               | verify + security-critical stack tier (RLS, edge-fn, webhook, e2e; fail-open w/o Docker) |
| `npm run verify:changed [-- <base>]`                | fast tier + only the stack tiers the diff touches (path heuristic; CI still runs full)   |
| `npm run verify:rls` / `verify:edge` / `verify:e2e` | run one stack tier on its own (boots the local stack)                                    |
| `npm run typecheck` (`--prefix frontend`)           | `tsc --noEmit` over the load-bearing JS scope (checkJs)                                  |
| `npm run db:types` (`--prefix frontend`)            | Regenerate `lib/database.types.ts` from the local DB                                     |
| `npm run e2e` / `e2e:install`                       | Playwright E2E suite / install browsers                                                  |
| `npm --prefix frontend run lint`                    | ESLint over `frontend/src` (no root proxy)                                               |
| `npm run db:check`                                  | `supabase db diff` — flag uncommitted schema drift                                       |
| `npm run stack:who`                                 | Is the shared local stack free? Prints the holding worktree/branch/command if not        |

**The local Supabase stack is ONE shared instance across all worktrees** (fixed ports, fixed
container name). Every stack-touching command (`verify:full`, `verify:changed`, `verify:rls`,
`verify:edge`, `verify:e2e`/`e2e`, `db:start/stop/reset`) takes a cross-worktree `flock`
(`scripts/stack-lock.sh`, lock in `/tmp`) before booting/resetting. On contention it prints who
holds the stack and waits (up to `STACK_LOCK_TIMEOUT`, default 30 min). Check with
`npm run stack:who`; never bypass the lock by calling `supabase` directly for destructive ops.

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
  keys are absent (stack tier skipped with a warning) — run it where they exist. For the local/dev
  loop, `npm run verify:changed` is the preferred day-to-day command; `verify:full` remains
  required before merge and runs fully in CI (including the CI-only slow Stripe scenarios).
- **NEW code uses the `lib/data/` access layer.** No raw `supabase.from(...)` in components; add or
  reuse a thin function in `frontend/src/lib/data/<entity>.js` (each typed to its table via the
  generated `lib/database.types.ts`). Components import from there. ESLint enforces this
  (`no-restricted-syntax` over `src/components/**` in `frontend/package.json`) — raw
  `supabase.from(...)` in a component fails lint. `supabase.auth`/`.storage` are exempt.
- **Types stay honest.** After any migration, regenerate `lib/database.types.ts`
  (`npm run db:types --prefix frontend`); annotate new `lib/`/`hooks/` code with JSDoc so
  `npm run typecheck` stays green over the enforced scope.
- **Structure conventions hold:** co-locate `.css` and `.test.js` next to their module; keep modules
  small / single-responsibility; follow the existing domain-folder layout.

## Architecture boundaries & report-only metrics

- **Import boundaries are generated from `frontend/module-map.json`.** That file
  is the single source of truth for the frontend's module areas (lib/data, lib,
  hooks, utils, supabaseClient, and each `components/<domain>`) and their
  `allowedImports`. `frontend/.eslintrc.cjs` `require()`s the map and GENERATES
  the `eslint-plugin-boundaries` element types + rule matrix from it — **edit the
  map to change what an area may import, never hand-edit the eslint file.** The
  map is shrink-only by intent: adding an `allowedImport` is a new cross-layer
  dependency that must show up (and be justified) in review. The
  `supabaseClient` import allowlist (which component files may import the client
  directly) is a shrink-only list in `.eslintrc.cjs` — remove entries as they
  migrate to `lib/data`, never add. `npm --prefix frontend run lint` enforces
  both.
- **Report-only checks (not yet gates):** `npm --prefix frontend run deadcode`
  (knip — unused files/exports/deps) and `npm --prefix frontend run coverage`
  (v8 coverage over `src/lib/**` + `src/hooks/**`, no thresholds). Neither is
  wired into `npm run verify` this wave; both are planned to become gates once
  their baselines stabilize (baseline recorded in `DEBT.md`).

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

## Task scoping & the bug ledger (vendored guardrails)

A vendored scope-guard (from `ai-first-starter`; see
`.claude/hooks/FRAMEWORK-SOURCE.md`) keeps agent edits inside the task at hand.

- **Scope a task before editing:** `npm run scope <path-or-glob>` writes
  `.task/allowed-files.json` (the allowed set). Example:
  `npm run scope frontend/src/lib`. Pass a directory and it expands to
  `<dir>/**`.
- **`add` widens, a plain re-run replaces.** `npm run scope add
supabase/functions/notify-inquiry` adds to the current scope; re-running
  without `add` starts a fresh scope. (The `--add` flag still works when the
  runner forwards it, but `npm run` swallows `--add` — it parses it as its
  own config flag — so always use the `add` subcommand with npm.) Bare catch-alls (`**`, `frontend/**`,
  `supabase/**`, …) are refused.
- **The PreToolUse scope-guard hook** (`.claude/hooks/scope-guard.ts`, fires
  only for Claude Code sessions started in this repo) blocks agent file edits
  that fall outside the active scope and logs every scope set and every block to
  repo-root **`edit-log.jsonl`** (tracked). With no scope active you get a
  one-time nudge for edits under `frontend/src/` or `supabase/functions/`.
- **Bug ledger:** any bug or limitation found but **not fixed** in a task gets an
  entry in **`DEBT.md`** in the **same commit** (status `open`/`fixed`/`wontfix`).
  Never delete entries — flip their status.

## Docs

Full docs under `docs/` (Diátaxis: `tutorials/`, `how_to/`, `reference/`, `explanation/`).
Setup is three flows: `docs/how_to/dev_setup.md`, `staging_setup.md`, `prod_setup.md`; everyday
ops in `docs/how_to/dev_practices.md`. Open work and known issues/flakes: `TASK-CHECKLIST.md`.
