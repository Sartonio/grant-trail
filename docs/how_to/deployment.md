# Production Deployment Guide

This guide covers every step required to take GrantTrail from zero to a live production environment.

**Architecture overview:**
- **Backend** — Supabase (database, auth, storage, edge functions)
- **Frontend** — Vercel (builds and hosts the React/Vite app)
- **Payments** — Stripe (subscriptions + webhook)

---

## Production Deployment Checklist

Use this as your top-level checklist. Each section below has full details.

### Supabase
- [ ] 1. Create a Supabase project
- [ ] 2. Run the schema migration
- [ ] 3. Configure authentication settings
- [ ] 4. Set Edge Function secrets (Stripe keys + APP_URL)
- [ ] 5. Configure the Stripe webhook endpoint

### Vercel
- [ ] 6. Import the GitHub repo into Vercel
- [ ] 7. Set Vercel environment variables
- [ ] 8. Deploy

### Post-Deploy
- [ ] 9. Allow your Vercel domain in Supabase auth
- [ ] 10. Promote the first super admin
- [ ] 11. Verify the deployment

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

## Step 2 — Run the Schema Migration

From the repository root, run:

```bash
npm run db:deploy
```

When prompted, enter your **Project Reference ID** from Step 1.

This script will:
- Link the local project to your remote Supabase project via the Supabase CLI
- Apply all migrations to build the complete schema
- Deploy all Edge Functions
- Provision the default platform root tenant (`tfac`) and default settings

**What gets created:**
- All database tables, indexes, and constraints
- All triggers (totals, status history, audit log, auto-approval, RLS enforcement)
- Helper functions (`is_admin()`, `current_tenant_id()`, `is_super_admin()`, `provision_self_service_tenant()`)
- RLS policies on every table
- Storage buckets: `receipts` and `grant-documents`
- All Edge Functions

---

## Step 3 — Configure Authentication Settings

In the Supabase Dashboard:

1. Go to **Authentication → Providers → Email**
   - Enable **Confirm email** for production (prevents unverified accounts)

2. Go to **Authentication → URL Configuration**
   - Set **Site URL** to your Vercel domain: `https://your-app.vercel.app` (or your custom domain)
   - You will add the full redirect URL after Vercel is configured in Step 9

---

## Step 4 — Set Edge Function Secrets

The Edge Functions need Stripe credentials to process payments. These are stored securely in Supabase's secrets vault — **never in code or committed files**.

Run from the repository root:

```bash
npx supabase secrets set --project-ref <your-project-ref> \
  STRIPE_SECRET_KEY="sk_live_your_secret_key" \
  STRIPE_PRICE_BASIC="price_your_basic_price_id" \
  STRIPE_PRICE_PRO="price_your_pro_price_id" \
  STRIPE_WEBHOOK_SECRET="whsec_your_webhook_signing_secret" \
  APP_URL="https://your-app.vercel.app"
```

Replace each value with the real credentials. See the table below for where to find each one.

| Secret | Where to get it |
|--------|----------------|
| `STRIPE_SECRET_KEY` | [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys) — use the **Secret key** (`sk_live_...`) |
| `STRIPE_PRICE_BASIC` | [Stripe Dashboard → Product Catalog](https://dashboard.stripe.com/products) — open your Basic plan product, copy the **Price ID** (`price_...`) |
| `STRIPE_PRICE_PRO` | Same as above, for your Pro plan product |
| `STRIPE_WEBHOOK_SECRET` | Created in Step 5 below — come back and set this after |
| `APP_URL` | Your Vercel deployment URL (e.g. `https://your-app.vercel.app`) |

> You can also view and manage these in the Supabase Dashboard under **Project Settings → Edge Functions → Secrets**.

---

## Step 5 — Configure the Stripe Webhook

Stripe must be told where to send payment events (subscription created, payment failed, etc.).

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
7. Go back and set `STRIPE_WEBHOOK_SECRET` in your secrets (Step 4)

---

## Step 6 — Import the Repo into Vercel

1. Go to [vercel.com](https://vercel.com) and click **Add New → Project**
2. Connect your GitHub account if prompted, then select the `granttrail` repository
3. On the configuration screen, set the **Root Directory** to `frontend`
4. Leave the build settings at their defaults (Vercel auto-detects Vite)
5. **Do not deploy yet** — proceed to Step 7 first

---

## Step 7 — Set Vercel Environment Variables

In the Vercel project settings, before deploying, go to **Settings → Environment Variables** and add:

| Variable | Value | Scope |
|----------|-------|-------|
| `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | Production |
| `VITE_SUPABASE_KEY` | Your Supabase **anon/public** key (`eyJ...`) | Production |

> **How this works:** These are `VITE_` prefixed variables, so Vite statically embeds them into the compiled JavaScript bundle at build time. There is no `.env.production` file to create or manage — Vercel injects them during the build.

---

## Step 8 — Deploy

Click **Deploy** in Vercel (or push a commit to `main`). Vercel will:
1. Pull the repo
2. Run `npm run build` inside `frontend/`
3. Publish the compiled static assets to their CDN

Your app will be live at `https://your-app.vercel.app` once the build completes (typically 1–2 minutes).

---

## Step 9 — Allow Your Domain in Supabase Auth

Now that you have your Vercel URL, update Supabase to allow it:

1. Go to **Authentication → URL Configuration** in the Supabase Dashboard
2. Set **Site URL** to your Vercel URL: `https://your-app.vercel.app`
3. Under **Redirect URLs**, add: `https://your-app.vercel.app`

If you are using a custom domain on Vercel, add that domain here too.

---

## Step 10 — Promote the First Super Admin

For security, admin rights are never seeded or committed. The first super admin must be created through the app itself.

1. Visit your live app and **register a new account** using the admin's email address
2. Complete the profile setup in the browser (this writes the user row to the database)
3. From the repository root, run:
   ```bash
   npm run admin:promote <email-address>
   ```

See [promote_superadmin.md](promote_superadmin.md) for full details on what this script does.

---

## Step 11 — Verify the Deployment

Work through this checklist on the live site:

- [ ] Visit the app URL and confirm the login page loads
- [ ] Log in as the super admin — confirm you land on the dashboard
- [ ] Navigate to a grant page, then **press F5** — confirm it reloads without a 404
- [ ] Create a test tenant (if applicable) and confirm the provisioning flow works
- [ ] Click through the subscription/checkout flow to confirm Stripe integration is live
- [ ] Check the browser developer console for errors
- [ ] In Stripe Dashboard, confirm the test webhook event received a `200` response

---

## Reference: All Credentials at a Glance

| Credential | Used In | Where to Find It |
|------------|---------|-----------------|
| `VITE_SUPABASE_URL` | Vercel env vars | Supabase → Project Settings → API |
| `VITE_SUPABASE_KEY` | Vercel env vars | Supabase → Project Settings → API (anon/public key) |
| `STRIPE_SECRET_KEY` | Supabase secrets | Stripe → Developers → API keys |
| `STRIPE_PRICE_BASIC` | Supabase secrets | Stripe → Product Catalog → Basic plan → Price ID |
| `STRIPE_PRICE_PRO` | Supabase secrets | Stripe → Product Catalog → Pro plan → Price ID |
| `STRIPE_WEBHOOK_SECRET` | Supabase secrets | Stripe → Developers → Webhooks → your endpoint → Signing secret |
| `APP_URL` | Supabase secrets | Your Vercel deployment URL |

---

## Related Guides

- [Promoting Users to Super Admin](promote_superadmin.md)
- [Resetting Test Data & Troubleshooting](reset_test_data.md)
- [Making Schema Changes](make_schema_changes.md)
