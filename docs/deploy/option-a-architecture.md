# Deploy Architecture — Option A

This document describes the "Option A" deploy architecture for grant-trail.

## Single source of truth: GitHub Environments

All deploy-time configuration (secrets and variables) lives in **GitHub
Environments**. The CI/CD workflows read config from the relevant environment
and fan it out to Supabase and Vercel at deploy time. Nothing is configured
"out of band" in the Supabase or Vercel dashboards as the source of truth —
the dashboards are downstream targets, not the origin of config.

There are three environments:

| Environment  | Purpose                              | Deploy trigger                              |
|--------------|--------------------------------------|---------------------------------------------|
| `ci`         | Test-only secrets used by CI checks  | Runs on PRs / CI; never deploys             |
| `staging`    | Staging deploy target                | **Auto** on every push to `main`            |
| `production` | Production deploy target             | **Gated** manual `workflow_dispatch` + approval |

> GitHub environment names are case-insensitive. The live production
> environment is named `Production`; `production` resolves to the same env.

### Canonical key names per environment

`staging` and `production` carry identical key names with different values:

- **Secrets:** `SUPABASE_ACCESS_TOKEN`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID`, `RESEND_API_KEY`
- **Variables:** `SUPABASE_PROJECT_REF`, `STRIPE_PRICE_BASIC`,
  `STRIPE_PRICE_PRO`, `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`, `APP_URL`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`, `VITE_SENTRY_DSN`,
  `RESEND_FROM_EMAIL`

`ci` carries **secrets only**: `STRIPE_SECRET_KEY_TEST`,
`STRIPE_PRICE_BASIC_TEST`, `STRIPE_PRICE_PRO_TEST`.

## One deploy path per stage

Each stage has **exactly one** deploy path: the GitHub Actions workflows.

- **Staging** deploys automatically when commits land on `main`.
- **Production** deploys only via a gated, manually dispatched workflow
  (`workflow_dispatch`) with the environment's approval/protection rules.

Because the workflows are the single deploy path, the **Git auto-deploy
integrations on Vercel and Supabase must be turned off** — otherwise a push to
`main` would trigger a second, uncontrolled deploy that bypasses the
GitHub-Environment config and the production approval gate.

## What is codified vs. what is manual

### Codified

- **Vercel Git auto-deploy is disabled in `vercel.json`:**

  ```json
  "git": { "deploymentEnabled": { "main": false } }
  ```

  This stops Vercel from auto-deploying on pushes to `main`. Deploys instead
  flow exclusively through the GitHub Actions workflows using `VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` from the relevant environment.

- **GitHub Environments** (`ci`, `staging`, `production`) and their
  secrets/variables — provisioned via `gh`.

### Manual dashboard steps (cannot be codified)

These must be performed by a human in the respective dashboards:

1. **Disable the Supabase GitHub integration's auto-apply of migrations.**
   The Supabase ↔ GitHub integration applies migrations automatically when
   commits land on the connected branch. Turn this off so migrations are
   applied only by the workflows (single deploy path). In the Supabase
   dashboard: Project → Integrations / GitHub → disable automatic migration
   application (branch deploys).

2. **Confirm Vercel Git deployments are disabled.** The `vercel.json` change
   above handles `main`, but verify in the Vercel dashboard
   (Project → Settings → Git) that production/preview Git deployments are not
   re-enabled and that no other branch is configured to auto-deploy. The
   workflows are the only intended deploy path.

## Key-name migration: `SUPABASE_PROD_PROJECT_REF` → `SUPABASE_PROJECT_REF`

The canonical Supabase project-ref variable is **`SUPABASE_PROJECT_REF`** in
every environment (`staging` and `production` use the same key name with
different values). The live `production` environment historically used
`SUPABASE_PROD_PROJECT_REF`.

- A placeholder `SUPABASE_PROJECT_REF` has been added to `production` so the
  key exists. The old `SUPABASE_PROD_PROJECT_REF` is left in place untouched.
- **ACTION REQUIRED:** Before the next production deploy, sync the **real**
  Supabase project ref into `production.SUPABASE_PROJECT_REF` (currently a
  placeholder). The real value is the one held in `SUPABASE_PROD_PROJECT_REF`.
  Once `SUPABASE_PROJECT_REF` carries the real value and the workflows have
  switched to reading it, the old `SUPABASE_PROD_PROJECT_REF` variable can be
  removed.

## Placeholder values

The `ci` and `staging` environments, and the newly added
`production.SUPABASE_PROJECT_REF`, were provisioned with **placeholder**
values. Real values must be filled in (GitHub → Settings → Environments)
before those environments can deploy successfully.
