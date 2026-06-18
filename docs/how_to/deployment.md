# Deployment Guide

> [!IMPORTANT]
> **There is no production environment yet — everything described here currently
> ships to _staging_.** The live Supabase project connected to this repository
> (`grant-trail`, ref `yfkmoeuimqpegfuhplwr`) and every merge to `main` deploy to
> **staging only**. Supabase labels that project's default branch `PRODUCTION`,
> but that is just Supabase's name for the project's single environment on the
> Free plan — treat it as staging.
>
> **Production will be a separate GitHub repository** wired to its own Supabase
> project via the same GitHub integration. Promoting a change to production will
> mean merging it into that production repo; this repo's `main` is the staging
> line. Until that repo exists, do not treat any data here as production data.

GrantTrail deployment has two phases:

- **[First-time bootstrap](#part-a--first-time-bootstrap-do-once)** — provision the infrastructure and wire up config. You do this once.
- **[Deploying changes](#part-b--deploying-changes-every-time-after)** — the steady state after bootstrap: merging to `main` ships both code and schema changes automatically.

**Architecture overview:**
- **Backend** — Supabase (database, auth, storage, edge functions)
- **Frontend** — Vercel (builds and hosts the React/Vite app)
- **Payments** — Stripe (subscriptions + webhook)

---

# Part A — First-Time Bootstrap (do once)

**The credential approach:** instead of hunting for each key at the moment a command needs it, you gather every API key you can up front into **two temporary, git-ignored scratch files** under `.deploy/` — one per destination (Step 2). The values you can't know yet — the Stripe webhook secret and your live app URL — get appended the moment each step produces them. Then `npm run deploy:secrets` pushes each file to its platform, verifies, and **shreds `.deploy/`** in one shot (Step 6). The files live only for the few minutes of bootstrap and never touch your local dev config or the repo.

## Bootstrap Checklist

- [ ] 1. Create a Supabase project
- [ ] 2. Gather all credentials into temporary `.deploy/` files
- [ ] 3. Run the schema migration
- [ ] 4. Configure the Stripe webhook endpoint → append `STRIPE_WEBHOOK_SECRET`
- [ ] 5. Import the GitHub repo into Vercel → append `APP_URL`
- [ ] 6. Push secrets & verify (`npm run deploy:secrets`)
- [ ] 7. Configure authentication & custom domain
- [ ] 8. Deploy
- [ ] 9. Promote the first super admin
- [ ] 10. Verify the deployment

---

## Step 1 — Create a Supabase Project

1. Log in to [supabase.com](https://supabase.com) and click **New project**
2. Fill in:
   - **Organization:** select your org (or create one)
   - **Project name:** e.g. `granttrail-prod`
   - **Database password:** choose a strong password and save it somewhere safe
   - **Region:** choose the region closest to your users
3. Click **Create new project** and wait 1–2 minutes for provisioning

Once ready, go to **Project Settings → API** and save:
- **Project URL** — `https://<ref>.supabase.co`
- **Project Reference ID** — the short ID in the URL (e.g. `abcdefghijkl`)
- **anon / public key** — the long JWT starting with `eyJ...`

> **Do not use the `service_role` key in the frontend.** It bypasses all RLS security policies.

---

## Step 2 — Gather All Credentials Into Temporary `.deploy/` Files

This is the time-saving step. In a single pass through the Supabase and Stripe dashboards, collect everything you can and write it into **two throwaway files**, split by where each one is headed. The whole `.deploy/` directory is git-ignored (and is *not* one of your dev env files), so production keys never get committed and never bleed into local development. Step 6 deletes it automatically once the secrets are pushed.

Create both files:

```bash
mkdir -p .deploy

cat > .deploy/vercel.env <<'EOF'
VITE_SUPABASE_URL=
VITE_SUPABASE_KEY=
EOF

cat > .deploy/supabase.env <<'EOF'
STRIPE_SECRET_KEY=
STRIPE_PRICE_BASIC=
STRIPE_PRICE_PRO=
STRIPE_WEBHOOK_SECRET=   # leave blank — filled in Step 4
APP_URL=                 # leave blank — filled in Step 5
EOF
```

Keeping them separate means each file pushes cleanly to exactly one destination — no frontend vars leaking into your Supabase function secrets, and vice versa.

Now fill in everything available right now:

| File | Variable | Value | Source |
|------|----------|-------|--------|
| `vercel.env` | `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | Step 1 |
| `vercel.env` | `VITE_SUPABASE_KEY` | Your **anon/public** key (`eyJ...`) | Step 1 |
| `supabase.env` | `STRIPE_SECRET_KEY` | `sk_live_...` | [Stripe → Developers → API keys](https://dashboard.stripe.com/apikeys) |
| `supabase.env` | `STRIPE_PRICE_BASIC` | `price_...` | [Stripe → Product Catalog](https://dashboard.stripe.com/products) → Basic plan → Price ID |
| `supabase.env` | `STRIPE_PRICE_PRO` | `price_...` | Same, for your Pro plan product |

**Leave `STRIPE_WEBHOOK_SECRET` and `APP_URL` blank** — they don't exist yet. You'll append them in Steps 4 and 5.

Also keep your **Project Reference ID** handy — Steps 3 and 6 ask for it.

> These files are deployment scratch only. Don't confuse them with `frontend/.env.local` or `supabase/.env`, which hold your *local dev* values and should never contain `sk_live_...` production keys.

---

## Step 3 — Deploy the Schema & Edge Functions (via the GitHub integration)

Production Supabase is connected to this repository through the **Supabase GitHub integration**. You don't run a deploy script — merging to the production branch deploys for you.

One-time setup (Supabase Dashboard → **Project Settings → Integrations → GitHub**):
1. Authorize GitHub and connect this repository; set the **Working directory** to `.` (the `supabase/` folder is at the repo root).
2. Enable **Deploy to production** so merges to the production branch are applied automatically.
3. Strongly recommended: enable the integration's **required status check** in your GitHub branch protection so a failing migration blocks the merge.

After that, deploying is just merging a PR that touches `supabase/`. On merge the integration:
- Applies any **new migrations** under `supabase/migrations/` (builds the schema; never re-runs applied migrations)
- Deploys the **Edge Functions declared in `config.toml`** (`verify_jwt = false` for `stripe-webhook`)
- Deploys **storage buckets** created by the migrations
- Provisions the default root tenant (`tfac`) and its settings, via the `bootstrap_initial_tenant` migration

> Secrets are **not** handled by the integration — set them separately with `npm run deploy:secrets` (Step 6). Functions will deploy but fail at runtime until their secrets exist.
>
> The integration does **not** snapshot the database before applying migrations. Make sure **Point-in-Time Recovery** is enabled (or take a manual `supabase db dump`) before merging risky migrations.

**What gets created:**
- All database tables, indexes, and constraints
- All triggers (totals, status history, audit log, auto-approval, RLS enforcement)
- Helper functions (`is_admin()`, `current_tenant_id()`, `is_super_admin()`, `provision_self_service_tenant()`)
- RLS policies on every table
- Storage buckets: `receipts` and `grant-documents`
- All Edge Functions

---

## Step 4 — Configure the Stripe Webhook

Stripe must be told where to send payment events (subscription created, payment failed, etc.). The endpoint URL is deterministic from your project ref, so you can do this as soon as the project exists.

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Set the endpoint URL to your `stripe-webhook` Edge Function URL:
   ```
   https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook
   ```
4. Under **Events to listen to**, select:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**
6. Click the newly created endpoint, then **Reveal** the **Signing secret** (`whsec_...`)
7. **Paste it straight into `.deploy/supabase.env`** as `STRIPE_WEBHOOK_SECRET` — no need to remember it for later, it's now in the file Step 6 reads.

---

## Step 5 — Import the Repo into Vercel

1. Go to [vercel.com](https://vercel.com) and click **Add New → Project**
2. Connect your GitHub account if prompted, then select the `granttrail` repository
3. On the configuration screen, set the **Root Directory** to `frontend`
4. Leave the build settings at their defaults (Vercel auto-detects Vite)
5. **Do not deploy yet** — proceed to the next steps first

> **SPA routing:** client-side routes (deep links and post-auth redirects like `/complete-profile`) are handled by `frontend/vercel.json`, which rewrites all unmatched paths to `/index.html`. It's committed and applied automatically — **do not delete it**, or those paths return a Vercel `404: NOT_FOUND`. Real static files (e.g. `/assets/*`) are served before the rewrite.

Your app URL will be `https://<project-name>.vercel.app`. **Paste it into `.deploy/supabase.env`** as `APP_URL` now. (If you'll use a custom domain, set `APP_URL` to that domain instead — see Step 7.)

With that, both deferred values are filled and `.deploy/supabase.env` is complete.

---

## Step 6 — Push Secrets & Verify

Both `.deploy/` files are now complete. One command does the rest:

```bash
npm run deploy:secrets
```

When prompted, enter your **Project Reference ID**. The script:

1. Validates both files are present and fully filled in (fails fast if `STRIPE_WEBHOOK_SECRET` or `APP_URL` is still blank)
2. Checks you're logged in to both CLIs and stops with instructions if not
3. Pushes `supabase.env` → Supabase Edge Function secrets, and `vercel.env` → Vercel **Production** env vars — no key ever touches your shell history
4. Prints the resulting Supabase and Vercel listings so you can confirm everything landed
5. **Shreds `.deploy/`** — but only after both pushes succeed; on any failure it leaves the files in place so you can fix and re-run

**Prerequisites:** log in to both CLIs once — `npx supabase login` and `npx vercel login`, then `npx vercel link` to connect this repo to the Vercel project. (The script verifies this before pushing.) If you'd rather not use the Vercel CLI at all, paste the two values from `.deploy/vercel.env` into **Settings → Environment Variables** in the Vercel dashboard; the script is idempotent, so re-running it later overwrites cleanly.

> **Why `VITE_`?** Vite statically embeds those two variables into the compiled bundle at build time, so Vercel injects them during the build — there is no `.env.production` to manage on the server.

---

## Step 7 — Configure Authentication & Custom Domain

In the Supabase Dashboard:

1. Go to **Authentication → Providers → Email**
   - Enable **Confirm email** for production (prevents unverified accounts)

2. Go to **Authentication → URL Configuration**
   - Set **Site URL** to your live app URL
   - Under **Redirect URLs**, add the same URL

**Using a custom domain?** Apply it consistently in all three places, or auth redirects will break:
- Vercel → **Settings → Domains** (add the domain)
- Supabase **Site URL** and **Redirect URLs** above (use the custom domain, not `*.vercel.app`)
- `APP_URL` in Supabase secrets (the value you set in Step 5/6)

---

## Step 8 — Deploy

Click **Deploy** in Vercel (or push a commit to `main`). Vercel will:
1. Pull the repo
2. Run `npm run build` inside `frontend/`
3. Publish the compiled static assets to their CDN

Your app will be live at `https://your-app.vercel.app` once the build completes (typically 1–2 minutes).

---

## Step 9 — Promote the First Super Admin

For security, admin rights are never seeded or committed. The first super admin must be created through the app itself.

1. Visit your live app and **register a new account** using the admin's email address
2. Complete the profile setup in the browser (this writes the user row to the database)
3. From the repository root, run:
   ```bash
   npm run admin:promote <email-address>
   ```

See [promote_superadmin.md](promote_superadmin.md) for full details on what this script does.

---

## Step 10 — Verify the Deployment

Work through this checklist on the live site:

- [ ] Visit the app URL and confirm the login page loads
- [ ] Log in as the super admin — confirm you land on the dashboard
- [ ] Navigate to a grant page, then **press F5** — confirm it reloads without a 404
- [ ] Create a test tenant (if applicable) and confirm the provisioning flow works
- [ ] Click through the subscription/checkout flow to confirm Stripe integration is live
- [ ] Check the browser developer console for errors
- [ ] In Stripe Dashboard, confirm the test webhook event received a `200` response

Bootstrap is complete. From here on, use **Part B** for every change.

---

# Part B — Deploying Changes (every time after)

Once bootstrap is done, the infrastructure and secrets stay put. Day-to-day deployment is just:

| You changed… | Do this |
|--------------|---------|
| **Code / UI** | `git push origin main` — Vercel auto-builds and ships. (PRs get a preview deploy automatically.) |
| **The database schema** | Add an incremental migration under `supabase/migrations/` (see [Making Schema Changes](make_schema_changes.md)) and **merge it**. The Supabase GitHub integration applies *new* migrations only, on merge — there is no manual push step. |
| **A secret** (rotated Stripe key, etc.) | Recreate just the relevant `.deploy/` file with the new value, then `npm run deploy:secrets`. |
| **The first super admin** | One-time only — see Step 9. |

> **Schema changes are always incremental.** Never edit an already-applied migration or hand-edit the remote database — add a new timestamped file under `supabase/migrations/`. On merge to the production branch, the **Supabase GitHub integration** applies only the pending migrations (it never re-runs applied ones), so it cannot replay an edited file. Avoid `DROP`/destructive statements unless intended: the integration applies whatever the migration contains and does not back up first. **The integration is the single source of truth for schema deploys** — there is no manual `db push` path. Never run `supabase db push` against the remote by hand; doing so applies migrations out of band and drifts the environment from what the integration believes is deployed.

---

# Part C — Safety: Secrets, Backup & Recovery

The Supabase GitHub integration applies migrations and deploys functions on
merge, but it does **not** set secrets, snapshot the database, or roll back on a
partial failure. This section is the runbook for those gaps (issue #29).

## Edge-function secret prerequisites

The integration deploys the functions declared in `config.toml`, but they
**500 at runtime until their secrets exist**. Set secrets *before or immediately
after* the first deploy of a function — order: **declare in `config.toml` →
merge (deploys the function) → `npm run deploy:secrets` (sets secrets) → verify**.

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically by the platform. The secrets **you** must provide:

| Secret | Used by | Required |
|--------|---------|----------|
| `STRIPE_SECRET_KEY` | all billing functions | Yes |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` | Yes |
| `STRIPE_PRICE_BASIC` | checkout / sync | Yes |
| `STRIPE_PRICE_PRO` | checkout / sync | Yes |
| `APP_URL` | checkout / portal redirects | Yes |
| `STRIPE_PRICE_FISCAL_AGENT_ACCESS` | basic-membership checkout | Only if that plan is used |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | billing portal | Optional (Stripe default if unset) |

### Preflight check (run after any deploy that touches functions or secrets)

```bash
# 1. Confirm every required secret is present in the project
npx supabase secrets list --project-ref <ref>

# 2. Smoke-test the webhook endpoint is reachable and the function booted
#    (401/400 = function is up and rejecting an unsigned request; 500 = a
#    secret is missing or the function crashed on boot)
curl -i -X POST https://<ref>.supabase.co/functions/v1/stripe-webhook
```

A `500` from that curl almost always means a missing/blank secret — fix it and
re-run `npm run deploy:secrets` before sending real traffic.

## Backup before risky migrations

The integration does not snapshot before applying. Before merging a migration
that contains `DROP`, `ALTER ... TYPE`, a `NOT NULL` add, or any
backfill/data-mutating statement:

1. Confirm **Point-in-Time Recovery** is enabled (Dashboard → Database → Backups),
   **or** take a manual logical dump as an explicit restore point:
   ```bash
   npx supabase db dump --linked -f backups/pre-deploy-$(date +%Y%m%d-%H%M).sql
   ```
2. Note the **commit SHA** and timestamp of the merge — the integration has no
   built-in audit trail, so record who merged what and when (the PR + merge
   commit is the lightweight version of this).

Plain additive migrations (new table/column/policy, like the subscription-gating
migration) do not need a manual dump — PITR is sufficient.

## Partial-failure recovery runbook

A merge can leave production half-applied: a migration succeeds but a function
deploy fails, or vice versa. Diagnose and recover:

| Symptom | Likely cause | Recovery |
|---------|--------------|----------|
| Migration applied, function not updated | Function not declared in `config.toml`, or integration deploy step failed | Add/fix the `[functions.*]` entry and re-merge (or `npx supabase functions deploy <name> --project-ref <ref>` as a manual escape hatch) |
| Function deployed, migration failed | Migration errored against real prod state (e.g. constraint violated by existing rows) | The ledger only records *applied* migrations, so the failed one is **not** marked done. Fix the migration in a new commit and re-merge; nothing was partially committed (each migration runs in its own transaction) |
| Function returns 500 after deploy | Missing secret | Run the preflight check above, set the secret, no redeploy needed |
| Bad data written before you caught it | Destructive/incorrect migration | Restore via PITR to just before the merge timestamp, or `psql` the manual dump from the backup step |

**Key invariant:** each migration applies in its own transaction and is only
recorded in the ledger on success — so a failed migration never leaves a
half-applied schema. The risk is *cross-resource* inconsistency (schema vs.
functions vs. secrets), which the table above addresses. When in doubt, the
safe order to re-establish consistency is: **migrations → functions → secrets →
preflight**.

---

## Reference: All Credentials at a Glance

All seven are gathered into the temporary `.deploy/` files (Step 2), then pushed to their destination and shredded by `npm run deploy:secrets` (Step 6).

| Credential | Goes to | Where to Find It |
|------------|---------|-----------------|
| `VITE_SUPABASE_URL` | Vercel env vars | Supabase → Project Settings → API |
| `VITE_SUPABASE_KEY` | Vercel env vars | Supabase → Project Settings → API (anon/public key) |
| `STRIPE_SECRET_KEY` | Supabase secrets | Stripe → Developers → API keys |
| `STRIPE_PRICE_BASIC` | Supabase secrets | Stripe → Product Catalog → Basic plan → Price ID |
| `STRIPE_PRICE_PRO` | Supabase secrets | Stripe → Product Catalog → Pro plan → Price ID |
| `STRIPE_WEBHOOK_SECRET` | Supabase secrets | Stripe → Developers → Webhooks → your endpoint → Signing secret (Step 4) |
| `APP_URL` | Supabase secrets | Your Vercel deployment URL (Step 5) |

---

## Related Guides

- [Promoting Users to Super Admin](promote_superadmin.md)
- [Resetting Test Data & Troubleshooting](reset_test_data.md)
- [Making Schema Changes](make_schema_changes.md)
