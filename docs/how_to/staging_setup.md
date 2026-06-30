# Staging Setup & Deploy

Staging is its own Supabase project + Vercel project + GitHub `staging` environment,
deployed by the **Deploy to Staging** workflow. Config has one source of truth: a
git-ignored `.deploy/staging.env` pushed to the `staging` GitHub environment with
`npm run deploy:secrets:staging`. Same pipeline as [prod](prod_setup.md); the
differences are below. Background: [Deploy Architecture](../explanation/deploy_architecture.md).

> **Stripe = TEST keys. Resend = real key.** (Local + staging use Stripe test mode;
> only production uses live Stripe.)

> **Prerequisite:** the staging/prod pipelines deploy from a GitHub remote. If the repo
> has no remote yet, none of this can run — re-create the remote and push `main` first.

---

## Part A — One-time bootstrap

1. **Staging Supabase project** — a *separate* project from prod. Note its **own** project
   ref; mint an access token (Account → Access Tokens).
2. **Staging Vercel project** — a *separate* project (e.g. `grant-trail-staging`) with a
   **distinct `VERCEL_PROJECT_ID`**. ⚠️ `deploy.yml` only *warns* on a shared ID — reusing
   prod's `VERCEL_PROJECT_ID` makes staging publish **into prod**.
3. **Stripe test webhook** (signing secret is shown only at creation) — with your **test** key:

   ```bash
   stripe webhook_endpoints create \
     --api-key sk_test_… \
     --url https://<staging-ref>.supabase.co/functions/v1/stripe-webhook \
     --enabled-events checkout.session.completed \
     --enabled-events customer.subscription.updated \
     --enabled-events customer.subscription.deleted
   ```

   Copy the `whsec_…` into Part B's config.
4. **Resend** — staging sends real email. Reuse the verified domain + `RESEND_API_KEY` from
   prod, or verify a domain (see [prod_setup.md](prod_setup.md#part-a--one-time-owner-bootstrap)).
5. **Vercel preview env vars** — set `VITE_SUPABASE_URL` + `VITE_SUPABASE_KEY` on the staging
   Vercel project so its Git-integration preview builds pass (same as prod Part A; the
   publishable key is safe to store).

---

## Part B — Deploying

### 1. Fill & push config

```bash
npm run deploy:secrets:staging   # first run scaffolds .deploy/staging.env, then exits
```

Fill MANDATORY: staging Supabase token + ref, `STRIPE_SECRET_KEY=sk_test_…`, **test**
`price_…`/`prod_…` ids, `STRIPE_WEBHOOK_SECRET=whsec_…` (the value from Part A step 3 — Stripe
reveals it only at creation), the three Vercel values (distinct `VERCEL_PROJECT_ID`),
`RESEND_API_KEY` + `EMAIL_FROM`, `APP_URL` = the staging URL. Leave AUTOFILLED blank (the
Supabase URL/key are derived on the next run).

```bash
npm run deploy:secrets:staging   # pushes to GitHub `staging`, shreds the file
```

> ⚠️ Always use `npm run deploy:secrets:staging`. Do **not** run
> `node scripts/deploy_secrets.js staging` — the positional arg is ignored and it defaults to
> `--env production`, pushing to **prod**.

### 2. Trigger the deploy

GitHub → Actions → **Deploy to Staging** → Run workflow (`workflow_dispatch`, manual-only).
It pushes Supabase secrets, applies migrations, deploys edge functions, and deploys the frontend
as a Vercel **preview** (no `--prod`). Confirm the run is green and reach the preview URL.

### 3. Seed staging (staging gets fake data; prod never does)

`supabase/seed.sql` is self-contained (creates its own `auth.users` + demo rows). Seed a **fresh**
staging DB once by loading it against the staging project. seed.sql is **not idempotent** (plain
INSERTs) — it's a fresh-DB-only operation; re-running errors on duplicate keys, so never run it
against prod. (`db push` never runs seed.sql, so prod stays clean automatically.)

### 4. Smoke test

Log in as a seeded account (`password123`) → Stripe **test** purchase (`4242 4242 4242 4242`)
lifts the paywall → confirm the Resend email lands.
