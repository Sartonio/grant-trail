# Production Setup Checklist

Run these steps once, in order, before triggering the first prod deploy. 
For the easiest experience, open four tabs: **GitHub**, **Supabase**, **Stripe**, and **Vercel**.

---

## 1. Prepare GitHub & Vercel Environments

1. **GitHub:** Go to your repo → [Settings → Environments](https://github.com/settings/environments) → **New environment**. Name it `production`.
2. Add a required reviewer (yourself or a team).
3. **Vercel:** Go to your Vercel project → [Settings → Environment Variables](https://vercel.com/dashboard). Make sure to select the **Production** environment only when adding variables below.

---

## 2. Supabase Setup & Variables

1. **GitHub Secret:** Go to your Supabase [Access Tokens](https://supabase.com/dashboard/account/tokens) page. Generate a new personal access token and add it to your GitHub `production` environment as a Secret:
   - **Name:** `SUPABASE_ACCESS_TOKEN`
   - **Value:** (your new token)
2. **Create Project:** Go to [supabase.com](https://supabase.com) → New project. Wait for it to provision.
3. **GitHub Variable:** Go to your new project's [General Settings](https://supabase.com/dashboard/project/_/settings/general). Copy the **Project Ref** (e.g. `abcdefghijklmnop`) and add it to your GitHub `production` environment as a Variable:
   - **Name:** `SUPABASE_PROD_PROJECT_REF`
   - **Value:** (your project ref)
4. **Vercel Variables:** Go to your project's [API Settings](https://supabase.com/dashboard/project/_/settings/api). Copy the following and add them to your Vercel Production environment:
   - **Name:** `VITE_SUPABASE_URL` | **Value:** Project URL (e.g. `https://abcdefghijklmnop.supabase.co`)
   - **Name:** `VITE_SUPABASE_KEY` | **Value:** `anon` `public` key

---

## 3. Stripe Products & Prices

Do this in the Stripe [**live** dashboard](https://dashboard.stripe.com/products) (not test mode).

1. Go to **Products** and create two products, each with one recurring monthly price:
   - **Basic Membership**
   - **Premium Membership**
2. **GitHub Variables (Prices):** As you create them, grab the **Price IDs** (`price_...`) and add them to your GitHub `production` environment as Variables:
   - **Name:** `STRIPE_PRICE_BASIC` | **Value:** (Basic price ID)
   - **Name:** `STRIPE_PRICE_PRO` | **Value:** (Premium price ID)

---

## 4. Stripe API Keys & Webhook

1. **GitHub Secret (API Key):** In Stripe, go to [Developers → API keys](https://dashboard.stripe.com/apikeys). Reveal your live Secret key (`sk_live_...`) and add it to your GitHub `production` environment as a Secret:
   - **Name:** `STRIPE_SECRET_KEY`
   - **Value:** `sk_live_...`
2. **Create Webhook:** In Stripe, go to [Developers → Webhooks → Add endpoint](https://dashboard.stripe.com/webhooks/create).
   - **Select events:** `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - **Endpoint URL:** `https://<your-prod-project-ref>.supabase.co/functions/v1/stripe-webhook`
3. **GitHub Secret (Webhook):** After saving the webhook, reveal the **Signing secret** (`whsec_...`). Add it to your GitHub `production` environment as a Secret:
   - **Name:** `STRIPE_WEBHOOK_SECRET`
   - **Value:** `whsec_...`

---

## 5. Stripe Billing Portal Configuration

1. In Stripe, go to [Settings → Billing → Customer portal](https://dashboard.stripe.com/settings/billing/portal).
2. Configure allowed actions (cancel, update payment method, etc.) to match your product requirements.
3. **GitHub Variable:** Save and copy the **Configuration ID** (`bpc_...`). Add it to your GitHub `production` environment as a Variable:
   - **Name:** `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`
   - **Value:** `bpc_...`

---

## 6. Final Environment Variables

Add these remaining variables to their respective platforms:

1. **GitHub Variable:**
   - **Name:** `APP_URL` | **Value:** `https://your-prod-domain.com`
2. **Vercel Variable:** (If using a separate Sentry project for prod)
   - **Name:** `VITE_SENTRY_DSN` | **Value:** Your Sentry DSN

> The GitHub deploy workflow reads the `SUPABASE_...` and `STRIPE_...` secrets/vars and pushes them into your Supabase project automatically on each deploy.

---

## 7. Trigger the first prod deploy

1. Go to your GitHub repo → [Actions → `Deploy to Production`](https://github.com/Programmer484/grant-trail/actions/workflows/deploy-prod.yml).
2. Click **Run workflow**.
3. GitHub will pause and prompt for Environment approval — approve it.
4. The workflow will:
    - Push Supabase secrets from GitHub Environment secrets/vars into your prod project
    - Apply all DB migrations (`supabase db push`)
    - Deploy all edge functions (`supabase functions deploy`)
5. Verify in the Supabase dashboard that migrations applied and functions are listed.

---

## 8. Seed prod database data

After the first deploy finishes, open the [Supabase SQL editor](https://supabase.com/dashboard/project/_/sql) for your prod project and run this snippet to link the database to your Stripe products. You can find the Product IDs in your [Stripe dashboard](https://dashboard.stripe.com/products).

```sql
UPDATE platform_settings
SET
  basic_membership_product_id  = 'prod_...',   -- Basic product ID
  premium_membership_product_id = 'prod_... '  -- Premium product ID
WHERE id = 1;
```

> This is the only step that cannot be automated via the deploy workflow — it's data, not config.

---

## 9. Smoke test

- Sign up as a new user on the prod URL.
- Attempt a Basic checkout — confirm Stripe live mode fires and the webhook is received (Stripe dashboard → Developers → Webhooks → your endpoint → recent events).
- Confirm subscription status reflects correctly in the app.

---

## Re-deploying later

Future prod deploys are the same as step 7 — go to Actions → `Deploy to Production` → Run workflow → approve. No other manual steps unless Stripe objects or Vercel vars change.
