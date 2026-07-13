# GrantTrail Frontend

React single-page app for GrantTrail, built with **Vite**. It talks to the Supabase
backend (Postgres + RLS, Auth, Storage, Edge Functions) and renders role-specific
interfaces for grantees, tenant admins, and platform super admins.

> Access control is enforced in the database by Row Level Security; the UI mirrors it
> for UX only. Grantee routes (`/grants*`, `/expenses`) are grantee-only; super admins
> operate across tenants via `/super/tenants`. An admin whose tenant subscription has
> lapsed keeps **read-only** admin access (write actions are gated, not locked out).

## Getting started

From this directory:

```bash
npm install
npm run dev      # start the Vite dev server (http://localhost:3000)
```

Most of the time you'll bootstrap the whole stack from the repo root instead — see the
[root README](../README.md) Quick Start (`npm run setup`, `npm run db:start`, `npm run dev`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm start` | Start the Vite dev server with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest unit suite once |
| `npm run lint` | ESLint over `src` |
| `npm run typecheck` | `tsc --noEmit` over the checkJs scope |
| `npm run verify` | Fast Definition-of-Done tier: lint + typecheck + unit tests |
| `npm run e2e` | Run the Playwright end-to-end suite (see [tests/e2e](tests/e2e/README.md)) |
| `npm run e2e:install` | Install Playwright browsers |

## Testing

- **Unit** — [Vitest](https://vitest.dev/) (`npm test`).
- **End-to-end** — [Playwright](https://playwright.dev/) under `tests/e2e/`, covering
  onboarding, invites, billing, grantee/admin/super-admin flows, and negative authz
  checks. See [tests/e2e/README.md](tests/e2e/README.md).

## Deployment

The SPA deploys to Vercel. The repo-root `vercel.json` configures the SPA rewrite and a
baseline set of **security headers** (`X-Content-Type-Options`, `X-Frame-Options: DENY`,
`Referrer-Policy`, HSTS, and a Content-Security-Policy). See
[Security Headers](../docs/reference/security_headers.md).
