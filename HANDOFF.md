# Handoff — deploy architecture (Option A) & prod-workflow test

_Last updated: 2026-06-24_

Working note on the deploy/staging→prod work. Delete once the open items below are closed.

## Done (merged to `main`)

- **#57** — `deploy_secrets.js`: removed Bitwarden/`--from-env`; added CLI preflight (gh/supabase/stripe install + auth) and `--env` flag.
- **#58** — Workflows: extracted reusable `.github/workflows/deploy.yml` (`workflow_call`, `environment` input). `deploy-staging.yml` auto-runs on push to `main` → `staging`; `deploy-prod.yml` is gated `workflow_dispatch` → `production`. Added `environment: ci` to the Stripe CI job.
- **#59 / #60** — Infra + secrets tooling: `vercel.json` Git auto-deploy disabled; `deploy_secrets.js` generalized to `--env ci|staging|production` with per-stage `deploy/*.env.example` templates and `npm run deploy:secrets[:staging|:ci]`. Renamed `SUPABASE_PROD_PROJECT_REF` → canonical `SUPABASE_PROJECT_REF`.
- **#61** — Docs: moved deploy doc into `docs/explanation/deploy_architecture.md` (Diátaxis).

## Current infrastructure state

GitHub Environments: `ci`, `staging` exist with **placeholder** values. `Production` was **deleted** (clean slate — prod was never live). `Preview` is Vercel's, unrelated.

- Old production variable values backed up at `.deploy/production-env-backup-2026-06-24.txt` (git-ignored).
- Production secret values are unrecoverable — re-mint on rebuild (this also closes the pending token rotation).
- Only one real Supabase project (`grant-trail` / `ufjuuwliqajymqaakyrq`) and one Vercel `grant-trail` project exist — both are the live app; there is no separate staging/dev target.

## Open / blocked

### 1. Throwaway full-run test of the production deploy pipeline (BLOCKED on tokens)
Goal: exercise `deploy.yml` end-to-end against disposable infra, never touching prod.
Blocked on three credentials only the user can mint — **do not paste in chat**. Create `.deploy/throwaway.env`:
```
SUPABASE_ACCESS_TOKEN=sbp_...      # supabase.com/dashboard/account/tokens
VERCEL_TOKEN=...                   # vercel.com/account/settings/tokens
STRIPE_SECRET_KEY=sk_test_...      # dashboard.stripe.com/test/apikeys (TEST mode)
```
Then the agent: creates a throwaway Supabase project (free, $0 confirmed — may hit free-tier 2-project cap; stop if so), a throwaway Vercel project, 2 Stripe test prices + webhook; creates a throwaway GitHub env; adds a temporary `workflow_dispatch` wrapper around `deploy.yml`; dispatches + observes; then tears it all down.

### 2. Rebuild the `production` environment
Run `npm run deploy:secrets` with a filled `.deploy/production.env` (freshly-minted, rotated tokens; canonical `SUPABASE_PROJECT_REF`).

### 3. Fill real values into `ci` and `staging`
`npm run deploy:secrets:ci` and `:staging`. Until then CI's `stripe-edge-function-tests` stays red (placeholders) and staging deploys fail.

### 4. Manual dashboard steps (no API)
- **Supabase GitHub integration**: GitHub-side check showed **no Supabase integration connected** (no "Supabase" check on commits) — likely already satisfied; confirm in Supabase dashboard → Integrations.
- **Vercel Git deploys**: confirm disabled (Settings → Git); `vercel.json` covers `main`.

### 5. Production approval gate (NOT set)
The `production` env had **no required-reviewer protection**, so a `workflow_dispatch` prod deploy would run unapproved. Add reviewers when rebuilding the env to restore the "gated prod" guarantee.

## Quick reference
- Env templates: `deploy/{ci,staging,production}.env.example`
- Sync tooling: `scripts/deploy_secrets.js` (`--env`, `--dry-run`, `--keep`, `--recreate-webhook`)
- Architecture: `docs/explanation/deploy_architecture.md`
