# Production Setup & Deploy

Production config has **one source of truth**: a git-ignored `.deploy/production.env`.
Fill it once, run `npm run deploy:secrets`, and every value lands in the GitHub
`production` environment. The *Deploy to Production* workflow is the only thing that reads
it — each run sets Supabase secrets, applies migrations, deploys edge functions, and builds
+ deploys the frontend (injecting the Vite vars). **Never set variables by hand in the
GitHub, Vercel, or Supabase dashboards.**

Both prod and staging deploy the **same Vercel project** (`grant-trail`,
https://grant-trail.vercel.app): production is the `--prod` deploy, staging is a preview
deploy. Staging has its own GitHub `staging` env pointing at a separate Supabase project —
see [staging_setup.md](staging_setup.md).

- **Part A — one-time owner bootstrap.** Create external resources + verify the email
  domain. Done once by the account owner. **A developer given access to the existing
  Supabase / Vercel / Resend / Stripe accounts skips Part A entirely (including all DNS).**
- **Part B — deploying.** What anyone with access does to ship. No DNS, no account creation.

---

## Part A — one-time owner bootstrap

1. **Supabase project** — [supabase.com](https://supabase.com) → New project. Note the
   **project ref**; mint an access token (Account → Access Tokens).
2. **Stripe (live) products + prices** — in the Stripe **live** dashboard create the
   **Basic** and **Premium** ("Fiscal Agents Plan") products, each with a recurring price.
   Copy the live `price_…` ids.
3. **Stripe webhook endpoint** — Stripe reveals a webhook's signing secret only at creation,
   so this is a one-time manual step. With your **live** key:

   ```bash
   stripe webhook_endpoints create \
     --api-key sk_live_… \
     --url https://<project-ref>.supabase.co/functions/v1/stripe-webhook \
     --enabled-events checkout.session.completed \
     --enabled-events customer.subscription.created \
     --enabled-events customer.subscription.updated \
     --enabled-events customer.subscription.deleted \
     --enabled-events invoice.payment_failed
   ```

   Copy the `whsec_…` into `STRIPE_WEBHOOK_SECRET` (Part B). If the project ref changes,
   delete the old endpoint in the Stripe dashboard and repeat (the URL contains the ref).
4. **Resend sending domain (email DNS)** — the only step with external DNS propagation, so
   start it early. In [Resend → Domains](https://resend.com/domains): add your sending domain
   (e.g. `send.example.org`), add the SPF/DKIM/DMARC records at your registrar, wait for
   propagation, then **Verify**. Create an API key. Outputs: `RESEND_API_KEY` and a verified
   `EMAIL_FROM` (`onboarding@resend.dev` only delivers to the account owner — no good for prod).
5. **Populate the `production` GitHub env** — run Part B's [Fill & push config](#1-fill--push-config)
   once, including `RESEND_API_KEY` + `EMAIL_FROM`. After this the config lives in GitHub;
   developers never touch it unless a value rotates.

> **Reusing an existing Supabase project as prod?** Clear it first — see
> [Clearing the database](#clearing-the-database).

---

## Part B — deploying

Assumes Part A is done (resources exist, domain verified, you have access). No DNS here.

### 1. Fill & push config

```bash
npm run deploy:secrets        # first run scaffolds .deploy/production.env, then exits
```

Fill the **MANDATORY** block (each key has a comment saying where its value comes from):
Supabase access token + ref, `STRIPE_SECRET_KEY=sk_live_…`, the live `price_…` ids,
`STRIPE_WEBHOOK_SECRET=whsec_…` (from Part A step 3), `VERCEL_TOKEN`, `APP_URL`,
`RESEND_API_KEY` + `EMAIL_FROM` (on the verified domain). Leave **AUTOFILLED** blank — the
next run derives the Supabase URL/key and Vercel ids.

```bash
npm run deploy:secrets        # pushes to GitHub `production`, shreds the file
```

`--dry-run` previews without changing anything; re-run any time you rotate a key (idempotent).

### 2. Trigger the deploy

GitHub → Actions → **Deploy to Production** → Run workflow → approve the environment prompt.
Confirm the run is green.

### 3. Verify Stripe product IDs (optional)

`deploy.yml` already seeds `platform_settings` from the `STRIPE_PRODUCT_*` config. Only if
the product IDs are wrong, in the prod
[Supabase SQL editor](https://supabase.com/dashboard/project/_/sql):

```sql
UPDATE platform_settings
SET basic_membership_product_id   = 'prod_...',   -- Basic product ID
    premium_membership_product_id = 'prod_...'    -- Premium product ID
WHERE id = 1;
```

### 4. Smoke test

Sign up as a new user on https://grant-trail.vercel.app → hit the paywall → purchase (live
card, **refund after** in Stripe) → confirm the paywall lifts, and — if email is on — the
receipt lands with the right plan / amount / date. If the email doesn't arrive: check
`system_logs` for `payment_confirmation_email_failure` and the Resend → **Emails** dashboard.

---

## Clearing the database

Reusing an existing Supabase project as the new prod? Wipe it first so migrations re-apply
from scratch. Run in that project's SQL editor:

```sql
drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
delete from supabase_migrations.schema_migrations;   -- re-run every migration
delete from auth.users;                              -- optional: drop test users
```

The next *Deploy to Production* rebuilds the schema from `supabase/migrations/`.

---

## Re-deploying later

- **Config change** (rotated key, new price id)? Edit `.deploy/production.env` →
  `npm run deploy:secrets`.
- **Code / schema only?** Actions → Deploy to Production → Run workflow → approve.

---

## Rollback

**Migrations are forward-only.** `supabase db push` never runs `down` migrations, so there
is no "roll back the last migration" button. Recovery paths, in order of preference:

- **Fix-forward (default).** Write a *new* migration that corrects the problem (e.g. re-adds a
  dropped column, relaxes a bad constraint) and deploy it the normal way. This keeps the
  migration history linear and reproducible across staging/prod.
- **Revert the code.** For a bad frontend/edge-function deploy that didn't touch the schema,
  revert the offending commit on `main` and re-run *Deploy to Production* (Vercel also keeps
  instant-rollback deployments in its dashboard for the frontend).
- **PITR — catastrophic only.** For data loss or a destructive migration you cannot fix
  forward, use Point-in-Time Recovery from the Supabase dashboard (Project → Database →
  Backups) to restore to a timestamp just before the bad deploy. This rewinds the whole
  database, so treat it as a last resort and coordinate the downtime.

---

