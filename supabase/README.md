# Supabase Functions Setup

This folder contains the Edge Functions used for Stripe billing flows.

## Install Supabase CLI

Choose one method below.

### Ubuntu (apt with .deb package)

```bash
sudo apt update
sudo apt install -y curl
DEB_URL=$(curl -s https://api.github.com/repos/supabase/cli/releases/latest | grep -o 'https://[^"]*linux_amd64\.deb' | head -n1)
curl -L "$DEB_URL" -o supabase_latest_linux_amd64.deb
sudo apt install -y ./supabase_latest_linux_amd64.deb
```

### Linux (manual binary install)

```bash
TAR_URL=$(curl -s https://api.github.com/repos/supabase/cli/releases/latest | grep -o 'https://[^"]*linux_amd64\.tar\.gz' | head -n1)
curl -L "$TAR_URL" -o supabase_latest_linux_amd64.tar.gz
tar -xzf supabase_latest_linux_amd64.tar.gz
sudo install -m 0755 supabase /usr/local/bin/supabase
```

### macOS (Homebrew)

```bash
brew install supabase/tap/supabase
```

### Windows (Scoop)

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

### npm (fallback)

```bash
npm install -g supabase
```

Verify install:

```bash
supabase --version
```

## Prerequisites

From repo root:

```bash
cd <repo-root>
supabase login
supabase link --project-ref <your-project-ref>
```

## Required Secrets

Set these in your linked Supabase project:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=<your-stripe-secret-key> \
  STRIPE_PRICE_BASIC=<your-basic-stripe-price-id> \
  STRIPE_PRICE_PRO=<your-premium-stripe-price-id> \
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID=<optional-portal-config-id> \
  APP_URL=http://localhost:3000
```

Notes:
- Do not set SUPABASE_* secrets for deployed functions. Supabase provides those automatically.
- STRIPE_PRICE_BASIC and STRIPE_PRICE_PRO must be Stripe Price IDs (price_...), not Product IDs (prod_...).
- STRIPE_BILLING_PORTAL_CONFIGURATION_ID is optional, but recommended if you want to disable upgrades or plan switching in Stripe's customer portal.
- Use your production app URL for production deploys.

## Set Secrets Without Supabase CLI (curl)

1. Create a personal access token in Supabase Dashboard:
   Account -> Access Tokens
2. Export token and project ref:

```bash
export SUPABASE_ACCESS_TOKEN=<your-personal-access-token>
export SUPABASE_PROJECT_REF=<your-project-ref>
```

3. Set secrets:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/secrets" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[
    {"name":"STRIPE_SECRET_KEY","value":"<your-stripe-secret-key>"},
    {"name":"STRIPE_PRICE_BASIC","value":"<your-basic-stripe-price-id>"},
    {"name":"STRIPE_PRICE_PRO","value":"<your-premium-stripe-price-id>"},
    {"name":"STRIPE_BILLING_PORTAL_CONFIGURATION_ID","value":"<optional-portal-config-id>"},
    {"name":"APP_URL","value":"http://localhost:3000"}
  ]'
```

4. Verify secrets:

```bash
curl -sS "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/secrets" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"
```

## Disable Upgrades In Stripe Portal

If you do not want users to upgrade or switch memberships inside Stripe:

1. In Stripe Dashboard, go to Settings -> Billing -> Customer portal.
2. Create or edit a portal configuration.
3. Turn off subscription updates or plan switching for that configuration.
4. Copy the configuration ID.
5. Save it in Supabase as STRIPE_BILLING_PORTAL_CONFIGURATION_ID.
6. Redeploy create-billing-portal-session.

That forces the app to use the restricted Stripe portal configuration instead of the Stripe default.

## Deploy Functions

Run from repo root:

```bash
cd <repo-root>
supabase functions deploy create-checkout-session --no-verify-jwt
supabase functions deploy create-basic-membership-checkout-session --no-verify-jwt
supabase functions deploy create-billing-portal-session --no-verify-jwt
supabase functions deploy sync-my-subscription --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy send-test-email --no-verify-jwt
```

## Local Development

Serve functions locally from repo root:

```bash
cd <repo-root>
supabase functions serve --env-file ./supabase/.env.local
```

Example ./supabase/.env.local values:

```env
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
STRIPE_SECRET_KEY=<your-stripe-secret-key>
STRIPE_PRICE_BASIC=<your-basic-price-id>
STRIPE_PRICE_PRO=<your-premium-price-id>
APP_URL=http://localhost:3000
```

## Stripe Webhook

After deploying stripe-webhook, set your Stripe webhook endpoint to:

```text
https://<your-project-ref>.functions.supabase.co/stripe-webhook
```

Recommended events:
1. customer.subscription.created
2. customer.subscription.updated
3. customer.subscription.deleted
4. checkout.session.completed

Then set the webhook signing secret:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=<your-webhook-signing-secret>
```

## Quick Smoke Test

1. Start frontend and sign in as a grantee user.
2. Go to Subscription page.
3. Click Purchase Basic and confirm Stripe checkout opens.
4. Click Manage Subscription and confirm billing portal opens.