# Production Setup & Deploy

Production config has **one source of truth**: a git-ignored `.deploy/production.env`.
You fill it once, run `npm run deploy:secrets`, and every value lands in the GitHub
`production` environment. The *Deploy to Production* workflow is the only thing that
reads that environment — each run sets the Supabase secrets, injects the Vite build
vars, applies migrations, deploys edge functions, and deploys the frontend. **You never
set variables by hand in the GitHub, Vercel, or Supabase dashboards** — with one
exception: the public Vite vars on Vercel's **preview** environment (Part A step 6),
which the workflow can't reach.

```
.deploy/production.env ──(npm run deploy:secrets)──▶ GitHub `production` env
                                                      │ (Deploy to Production workflow)
                                                      ├─▶ Supabase secrets + migrations + edge functions
                                                      └─▶ Vercel build + deploy
```

This guide has two parts:

- **Part A — One-time owner bootstrap.** Create the external resources and verify the
  email sending domain. Done **once** by the account owner.
- **Part B — Deploying.** What anyone with access does to ship. **No DNS, no account
  creation** — it assumes Part A is done.

---

## Part A — One-time owner bootstrap (done once)

These create external resources the deploy can't make for you. **A developer who is
given access to the existing Supabase / Vercel / Resend / Stripe accounts skips Part A
entirely** — including all the DNS work.

1. **Supabase project** — [supabase.com](https://supabase.com) → New project. Note the
   **project ref**; mint an access token (Account → Access Tokens).
2. **Stripe (live) products + prices** — in the Stripe **live** dashboard create the
   **Basic** and **Premium** ("Fiscal Agents Plan") products, each with a recurring price.
   Copy the live `price_…` ids
3. **Resend sending domain (email DNS)** — verify your domain in Resend so receipts can
   deliver to any customer. Full step-by-step incl. the DNS records is in
   [`EMAIL-DNS-SETUP.md`](../../EMAIL-DNS-SETUP.md). This is the only step with external
   DNS propagation, so start it early. Outputs: a `RESEND_API_KEY` and a verified
   `EMAIL_FROM` address.
4. **Populate the `production` GitHub environment** — run Part B's
   [Fill & push config](#2-fill--push-config) once, including `RESEND_API_KEY` +
   `EMAIL_FROM`. After this the config lives in GitHub; developers never touch it again
   unless a value rotates.
5. **(Recommended, once)** Add a **required reviewer** to the `production` environment
   (Settings → Environments → production) so prod deploys pause for approval. The script
   can't set reviewers via the API.
6. **Vercel preview env vars (one-time).** The `Vercel – grant-trail` /
   `grant-trail-staging` checks on a PR are Vercel's **Git-integration preview builds** —
   they build on Vercel's own infra and do **not** run through *Deploy to Production*, so
   they can't read the GitHub `production`/`staging` env. The frontend's `prebuild` guard
   (`frontend/scripts/check-env.mjs`) then fails the build with *"Missing required
   environment variable(s): VITE_SUPABASE_URL, VITE_SUPABASE_KEY"*. Set those two **public**
   client vars once per Vercel project so preview builds pass — both are safe to store
   (the publishable/anon key is inlined into the browser bundle either way):

   ```bash
   # repeat for each project: grant-trail, grant-trail-staging
   npx vercel link --project grant-trail
   for scope in preview production; do
     printf '%s' "https://<project-ref>.supabase.co" \
       | npx vercel env add VITE_SUPABASE_URL "$scope" --token="$VERCEL_TOKEN"
     printf '%s' "sb_publishable_…" \
       | npx vercel env add VITE_SUPABASE_KEY "$scope" --token="$VERCEL_TOKEN"
   done
   ```

   `<project-ref>` is the Supabase project ref; the publishable key is in **Supabase →
   Project Settings → API**. Equivalent to typing them into **Vercel → Settings →
   Environment Variables** (Preview + Production) by hand. The prod/staging *workflow*
   deploys still inject their own copies from the GitHub env (`deploy.yml`), so this only
   affects the Git-integration preview builds.

> **Reusing an existing Supabase project as prod?** Clear it first so migrations apply
> onto a clean schema — see [Clearing the database](#clearing-the-database).

---

## Part B — Deploying to production

Assumes Part A is done (resources exist, domain verified, you have access). **No DNS here.**

### 1. Fill & push config

```bash
npm run deploy:secrets        # first run scaffolds .deploy/production.env, then exits
```

Fill the **MANDATORY** block (every key has a comment saying where its value comes from):
Supabase access token + ref, `STRIPE_SECRET_KEY=sk_live_…`, the live `price_…` ids,
`VERCEL_TOKEN`, `APP_URL`. If the email domain is verified, also set `RESEND_API_KEY`
(secret) + `EMAIL_FROM` (variable, on the verified domain). Leave **AUTOFILLED** blank —
the next run derives the Supabase URL/key, Vercel ids, and the Stripe webhook secret.

```bash
npm run deploy:secrets        # pushes to GitHub `production`, creates the live Stripe webhook, shreds the file
```

`--dry-run` previews without changing anything; re-run any time you rotate a key (idempotent).

> **Email is optional to deploy.** Leave `RESEND_API_KEY`/`EMAIL_FROM` blank and prod
> stands up with receipts off (the send no-ops cleanly — no errors, no failure rows).
> Turn them on later — see [Turning on email](#turning-on-email).

### 2. Trigger the deploy

GitHub → [Actions → **Deploy to Production**](https://github.com/Programmer484/grant-trail/actions/workflows/deploy-prod.yml)
→ Run workflow → approve the environment prompt. It pushes Supabase secrets, applies
migrations, deploys edge functions, and builds + deploys the frontend (injecting the Vite
vars from the `production` env). Confirm the run is green.

### 3. Seed Stripe product IDs (data, not config)

In the prod [Supabase SQL editor](https://supabase.com/dashboard/project/_/sql):

```sql
UPDATE platform_settings
SET basic_membership_product_id   = 'prod_...',   -- Basic product ID
    premium_membership_product_id = 'prod_...'    -- Premium product ID
WHERE id = 1;
```

### 4. Smoke test

Sign up as a new user on the prod URL → hit the paywall → purchase (live card, **refund
after** in Stripe) → confirm the paywall lifts, and — if email is on — the receipt lands
with the right plan / amount / date. If the email doesn't arrive: check `system_logs` for
`payment_confirmation_email_failure` and the Resend → **Emails** dashboard.

---

## Turning on email

Email is deploy-optional; turn it on once the sending domain is verified (Part A step 3):

```bash
gh secret   set RESEND_API_KEY --env production            # paste re_...
gh variable set EMAIL_FROM     --env production --body 'GrantTrail <receipts@send.atkasolutions.org>'
```

Then re-run **Deploy to Production**. Confirm both appear in Supabase → Edge Functions →
Secrets. `EMAIL_FROM` must be on the verified domain; `onboarding@resend.dev` only
delivers to the Resend account owner.

---

## Clearing the database

Reusing an existing Supabase project as the new prod? Wipe it first so migrations re-apply
from scratch. Run in that project's SQL editor — ⚠️ **prod only, never staging**:

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
- **Code / schema only?** Actions → Deploy to Production → Run workflow → approve. No
  dashboard steps.
