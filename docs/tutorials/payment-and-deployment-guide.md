# GrantTrail — Payments, Email & Deployment Guide

This tutorial walks a developer through the full lifecycle: getting the local payment and email stack running, testing it end to end, and deploying it to a real environment. It assumes you have already completed the steps in [Local Onboarding](local_onboarding.md) and have a working local Supabase stack.

---

## Table of Contents

1. [How the Payment & Email System Works](#1-how-the-payment--email-system-works)
2. [Local Prerequisites](#2-local-prerequisites)
3. [Configuring `supabase/.env`](#3-configuring-supabaseenv)
4. [Running the Full Local Stack](#4-running-the-full-local-stack)
5. [Testing a Payment End to End](#5-testing-a-payment-end-to-end)
6. [Verifying the Email Was Sent](#6-verifying-the-email-was-sent)
7. [Debugging Failures](#7-debugging-failures)
8. [Deploying to Production](#8-deploying-to-production)
9. [Post-Deployment Checklist](#9-post-deployment-checklist)
10. [Key Things Every Developer Should Know](#10-key-things-every-developer-should-know)

---

## 1. How the Payment & Email System Works

Understanding the data flow prevents most debugging confusion.

```
User clicks "Subscribe"
        │
        ▼
frontend/src/lib/billing.js
  └─ authenticated POST to Supabase Edge Function
        │
        ▼
supabase/functions/create-checkout-session/index.ts   (or create-basic-membership-checkout-session)
  └─ calls Stripe API → returns a Checkout URL
        │
        ▼
User completes payment on Stripe-hosted Checkout page
        │
        ▼  Stripe fires a signed webhook event
        ▼
supabase/functions/stripe-webhook/index.ts
  ├─ verifies stripe-signature header against STRIPE_WEBHOOK_SECRET
  ├─ on checkout.session.completed:
  │     ├─ upsertSubscriptionFromStripe() → writes to subscriptions + user_memberships tables
  │     └─ sendPaymentConfirmationEmail() → calls Resend API → email delivered to customer
  └─ records event in billing_webhook_events (idempotency guard)
```

**Key invariant:** email failures are isolated in their own `try/catch`. If Resend is down or the key is wrong, Stripe still receives a `200` and never retries. The failure is logged to `system_logs` with `event_name = 'payment_confirmation_email_failure'`.

**Three environment variables power this:**

| Variable | What it does |
|---|---|
| `STRIPE_SECRET_KEY` | Authenticates all Stripe API calls from Edge Functions |
| `STRIPE_WEBHOOK_SECRET` | Verifies incoming webhook events are genuinely from Stripe |
| `RESEND_API_KEY` | Authenticates outgoing email calls to [Resend](https://resend.com) |

---

## 2. Local Prerequisites

You need all four of these before the payment stack will work locally:

| Tool | Check | Notes |
|---|---|---|
| Docker (running) | `docker ps` | Required by local Supabase |
| Node.js 18+ | `node -v` | Required for the frontend and Supabase CLI |
| Stripe CLI | `stripe --version` | Install: `winget install Stripe.StripeCLI` (Windows) or `brew install stripe/stripe-cli/stripe` (Mac) |
| A Stripe test account | Log in at [dashboard.stripe.com](https://dashboard.stripe.com) | Use **test mode** (toggle in the dashboard sidebar) |

> **You do not need a Resend account to develop locally.** Leave `RESEND_API_KEY` blank and the email step is silently skipped — a warning is logged but nothing breaks. Add it only when you want to verify that real emails are being sent.

---

## 3. Configuring `supabase/.env`

This file is **git-ignored** — it holds secrets that must never be committed. Your complete `supabase/.env` should look like this:

```dotenv
# Stripe API secrets for local Edge Functions testing
STRIPE_SECRET_KEY="sk_test_51..."

# Price IDs from your Stripe test-mode Product Catalog
STRIPE_PRICE_BASIC="price_..."
STRIPE_PRICE_PRO="price_..."

# Webhook signing secret — printed by `stripe listen` (see Section 4)
STRIPE_WEBHOOK_SECRET="whsec_..."

# Frontend URL — leave as-is for local development
APP_URL="http://localhost:3000"

# Resend — optional locally; leave blank to skip email sending
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="onboarding@resend.dev"
```

### Where to find each value

**`STRIPE_SECRET_KEY`**
Go to [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys). Copy the **Secret key** (`sk_test_...`). Never use a `sk_live_...` key locally.

**`STRIPE_PRICE_BASIC` and `STRIPE_PRICE_PRO`**
Go to [Stripe Dashboard → Product Catalog](https://dashboard.stripe.com/products). Open each product, click on the price, and copy the **Price ID** (`price_...`). You need one for Basic and one for the Fiscal Agents / Pro plan.

**`STRIPE_WEBHOOK_SECRET`**
This is generated dynamically by `stripe listen` — see Section 4. Leave it blank until you have run that command.

**`RESEND_API_KEY`**
Go to [Resend Dashboard → API Keys](https://resend.com/api-keys) and create a key. For local testing you can use Resend's shared `onboarding@resend.dev` sender address (no domain verification needed). For production you must verify your own domain.

---

## 4. Running the Full Local Stack

You need **four terminals** open simultaneously. Start them in this order.

### Terminal 1 — Local Supabase (database + auth + storage)

```bash
npm run db:start
```

Wait until you see a table of local URLs printed. This starts Postgres, applies all migrations, and runs `seed.sql`. You only need to do this once per session (or after a `db:reset`).

### Terminal 2 — Edge Functions server

```bash
npx supabase functions serve --env-file supabase/.env
```

> **Critical:** this command reads your **live, unsaved files** directly. Changes to `supabase/functions/` take effect immediately without restarting — but you must restart if you add a new function or change `config.toml`.

Watch this terminal for output when webhooks arrive. Errors in your Edge Function code appear here.

### Terminal 3 — Stripe webhook listener

```bash
stripe listen \
  --api-key sk_test_51... \
  --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
```

Replace `sk_test_51...` with your actual test secret key. When this starts it prints:

```
Your webhook signing secret is whsec_abc123...
```

**Copy that `whsec_...` value and paste it into `supabase/.env` as `STRIPE_WEBHOOK_SECRET`.** Then restart Terminal 2 (the functions server) so it picks up the new value.

> If the listener was already running from a previous session, re-run it — the signing secret changes each time you start a new `stripe listen` session. A stale `STRIPE_WEBHOOK_SECRET` causes every webhook to return HTTP 400 with "No signatures found matching the expected signature".

### Terminal 4 — Frontend dev server

```bash
npm run dev
```

Opens the app at `http://localhost:3000`.

---

## 5. Testing a Payment End to End

### Using the UI

1. Open `http://localhost:3000` and sign in as a grantee (e.g. `maria.smith@example.com` / `password123`)
2. Go to **Subscription** in the nav
3. Click to purchase Basic or Fiscal Agents plan
4. You are redirected to the Stripe-hosted Checkout page
5. Use the test card:
   - **Card number:** `4242 4242 4242 4242`
   - **Expiry:** any future date (e.g. `12/34`)
   - **CVC:** any 3 digits (e.g. `123`)
   - **Name / address:** anything
6. Click **Subscribe**
7. You are redirected back to the app

Watch **Terminal 2** (Edge Functions) — you should see the webhook arrive and log output like:

```
POST /functions/v1/stripe-webhook  200
```

And **Terminal 3** (Stripe listener) should show:

```
<-- [200] POST http://127.0.0.1:54321/functions/v1/stripe-webhook [checkout.session.completed]
```

### Using `stripe trigger` (faster, no UI needed)

To fire a fake `checkout.session.completed` event without going through the checkout UI:

```bash
stripe trigger checkout.session.completed --api-key sk_test_51...
```

This exercises the entire webhook path — subscription upsert and email — in about two seconds.

### Other useful test cards

| Scenario | Card number |
|---|---|
| Successful payment | `4242 4242 4242 4242` |
| Payment declined | `4000 0000 0000 0002` |
| Requires authentication (3DS) | `4000 0025 0000 3155` |
| Insufficient funds | `4000 0000 0000 9995` |

---

## 6. Verifying the Email Was Sent

### If you have a Resend API key set

Log in to your [Resend Dashboard](https://resend.com) and go to **Emails**. The sent email should appear within a few seconds of the webhook firing. Click it to preview the HTML receipt.

### Checking the database directly

After a successful payment, verify that the subscription row was written:

```bash
docker exec supabase_db_grant-trail psql -U postgres -d postgres \
  -c "SELECT stripe_subscription_id, status, current_period_end FROM subscriptions ORDER BY id DESC LIMIT 3;"
```

And that the webhook event was recorded (idempotency guard):

```bash
docker exec supabase_db_grant-trail psql -U postgres -d postgres \
  -c "SELECT stripe_event_id, event_type, created_at FROM billing_webhook_events ORDER BY id DESC LIMIT 5;"
```

### If the email is skipped (no API key)

Check Terminal 2 for this log line:

```
RESEND_API_KEY not set — skipping email send.
```

That means the email module loaded correctly but intentionally skipped the send. Everything else (subscription write, webhook record) still works.

---

## 7. Debugging Failures

### Email failed but payment succeeded

The email failure is isolated — the payment still completes. Check `system_logs`:

```bash
docker exec supabase_db_grant-trail psql -U postgres -d postgres \
  -c "SELECT event_name, error_message, created_at FROM system_logs WHERE event_name = 'payment_confirmation_email_failure' ORDER BY created_at DESC LIMIT 5;"
```

### Webhook returns HTTP 400

| Symptom | Cause | Fix |
|---|---|---|
| `No signatures found matching…` | `STRIPE_WEBHOOK_SECRET` doesn't match the running `stripe listen` session | Stop and restart `stripe listen`; copy the new `whsec_...` into `supabase/.env`; restart the functions server |
| `Missing Stripe webhook configuration` | `STRIPE_WEBHOOK_SECRET` is blank in `.env` | Set it and restart the functions server |
| `Webhook processing failed` | An unhandled exception in `stripe-webhook/index.ts` | Check Terminal 2 for the stack trace; also check `system_logs` for `event_name = 'stripe_webhook_failure'` |

### Every billing function returns an error on startup

The most common cause is a missing `STRIPE_SECRET_KEY`. The shared `stripe.ts` module throws on import if the key is blank, which crashes every function that imports it.

```
Error: Missing STRIPE_SECRET_KEY
```

Fix: set the key in `supabase/.env` and restart the functions server.

### Subscription was not written after checkout

Check that the `checkout.session.completed` event was received (Terminal 3). If the event shows `[200]` but no row exists in `subscriptions`, the `upsertSubscriptionFromStripe` call may have failed — check Terminal 2 for the error and look at `system_logs`.

---

## 8. Deploying to Production

> **Important:** there is currently no separate production environment. Merging to `main` deploys to the **staging** Supabase project (`grant-trail`, ref `yfkmoeuimqpegfuhplwr`). Production will be a separate repo/project. Treat everything below as the guide for when that production project exists.

### What you must change from local → production

This is the complete list of changes required. Nothing else needs to change in the codebase — the code itself is environment-agnostic.

#### 1. Stripe keys: switch from test to live

| Variable | Local value | Production value |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` from [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_PRICE_BASIC` | your test price ID | **live** price ID from your Stripe product catalog |
| `STRIPE_PRICE_PRO` | your test price ID | **live** price ID from your Stripe product catalog |

> Your live price IDs are different from your test ones. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products) — make sure you are **not** in test mode when you copy these.

#### 2. Stripe webhook: create a production endpoint

The local `stripe listen` forwarder only works on your machine. In production, Stripe needs a real HTTPS URL.

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Enter your Edge Function URL:
   ```
   https://<your-supabase-project-ref>.supabase.co/functions/v1/stripe-webhook
   ```
4. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**, then **Reveal** the Signing secret (`whsec_...`)
6. Use this as `STRIPE_WEBHOOK_SECRET` in production — it is different from your local one

#### 3. Resend: verify your domain and update the sender address

For production emails to deliver reliably, you must send from a domain you own.

1. Go to [Resend Dashboard → Domains](https://resend.com/domains) and add your domain (e.g. `granttrail.ca`)
2. Add the DNS records Resend gives you (SPF, DKIM, DMARC) to your domain registrar
3. Wait for verification (usually a few minutes)
4. Update `RESEND_FROM_EMAIL` to use your verified domain:
   ```
   RESEND_FROM_EMAIL="GrantTrail <noreply@granttrail.ca>"
   ```

Using Resend's shared `onboarding@resend.dev` sender (as in local development) will not work for production — it is rate-limited and not whitelabelled.

#### 4. `APP_URL`: set to your live Vercel URL

```
APP_URL="https://your-app.vercel.app"
```

This is used by Stripe to redirect users back to the app after checkout or the billing portal. If it points to `localhost`, production payments will redirect users to a broken URL.

#### 5. Set all secrets in Supabase

Run this once after your project exists (or whenever a value changes):

```bash
npx supabase secrets set --project-ref <your-project-ref> \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_PRICE_BASIC="price_..." \
  STRIPE_PRICE_PRO="price_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  APP_URL="https://your-app.vercel.app" \
  RESEND_API_KEY="re_..." \
  RESEND_FROM_EMAIL="GrantTrail <noreply@granttrail.ca>"
```

Or use the automated script from the repo root:

```bash
npm run deploy:secrets
```

The script gathers everything from `.deploy/` files, validates them, pushes to both Supabase and Vercel, then shreds the files. See [deployment.md](../how_to/deployment.md) for the full bootstrap procedure.

#### 6. Verify the function is live

After deploying, smoke-test the webhook endpoint:

```bash
curl -i -X POST https://<ref>.supabase.co/functions/v1/stripe-webhook
```

- `400` = function is running and correctly rejecting an unsigned request ✅
- `500` = a required secret is missing or the function crashed on boot ❌

A `500` almost always means a missing or blank secret. Run `npx supabase secrets list --project-ref <ref>` to confirm every key is present.

---

## 9. Post-Deployment Checklist

Work through this before announcing the deployment.

**Authentication**
- [ ] Visit the live app URL and confirm the login page loads
- [ ] Register a new account and confirm the email verification flow works
- [ ] Log in and confirm you land on the dashboard (not a 404)
- [ ] Press F5 on a deep route (e.g. `/grants`) — confirm it reloads without a 404 (SPA routing is handled by `frontend/vercel.json`)

**Payments**
- [ ] Go to the Subscription page and start a checkout
- [ ] Use the test card `4242 4242 4242 4242` to complete a test purchase (you can refund it immediately after)
- [ ] In [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks) → your endpoint → Recent deliveries, confirm the `checkout.session.completed` event shows a `200` response
- [ ] Confirm a row was written to the `subscriptions` table in your Supabase project

**Email**
- [ ] Confirm a payment confirmation email arrived in the inbox you used for the test purchase
- [ ] Check the email renders correctly (no broken images, correct amount and plan name)
- [ ] If the email did not arrive, check `system_logs` in Supabase for `payment_confirmation_email_failure`

**Admin**
- [ ] Log in as a Super Admin (see [promote_superadmin.md](../how_to/promote_superadmin.md) for first-time setup)
- [ ] Confirm the Admin Dashboard loads and shows data
- [ ] Test the grant approval workflow with a test grantee account

---

## 10. Key Things Every Developer Should Know

These are the non-obvious facts that cause the most confusion for new contributors.

### The subscription paywall is bypassed in local seed data

`supabase/seed.sql` inserts pre-seeded `user_memberships` rows so that all test users already have active subscriptions. You will never hit the paywall locally unless you test with a newly registered account. This is intentional — it lets developers work on grant features without running Stripe every session.

### There are two different user ID types — they are not interchangeable

- `auth.users.id` — a UUID managed by Supabase Auth. Use this only to look up a profile row.
- `users.id` — an integer primary key in the `users` table. Use this as the foreign key in all other tables (`grant_record.user_id`, `expenses.user_id`, etc.).

Inserting an Auth UUID into a column that expects an integer ID will cause a silent type mismatch or a foreign key violation.

### RLS silent failures

Row Level Security filters rows silently. If a user queries a row they are not allowed to see, Supabase returns `data: null, error: null` — not an exception. Always null-check returned data before accessing properties. If a query returns less data than expected, RLS is often the reason.

### Database triggers manage side effects — do not replicate them in the frontend

These are handled automatically:
- **Spending totals** — `grant_record.total_spent`, `remaining_balance`, and `budget_items.amount_spent` are recalculated by triggers on insert/update/delete of expenses and budget items
- **Status history** — `trg_grant_status_tracking` writes to `grant_status_history` on every status change
- **Notifications** — rows in `notifications` are inserted by triggers on status changes, new submissions, and comments

If you write frontend code that tries to keep these values in sync manually, you will create duplicate data.

### Never edit a committed migration file

The Supabase GitHub integration records which migrations have been applied. If you edit an already-applied migration file, the integration will never re-run it — your local state and the remote state will diverge silently. Always add a **new, timestamped migration file** for every schema change. See [make_schema_changes.md](../how_to/make_schema_changes.md).

### The Stripe webhook function bypasses JWT verification

`stripe-webhook` is the only Edge Function with `verify_jwt = false` in `config.toml`. This is correct — Stripe authenticates with a `stripe-signature` header, not a Supabase JWT. The function verifies the signature itself using `stripe.webhooks.constructEventAsync`. Do not change this setting.

### CSS uses design tokens — no raw values

All colours, spacing, and typography are declared as CSS custom properties in `frontend/src/styles/variables.css`. Use `var(--color-primary)` not `#063F1E`. Do not introduce Tailwind.

### Webhook events are idempotent by design

`stripe-webhook` checks `billing_webhook_events` for a duplicate `stripe_event_id` before processing. If Stripe retries a delivery, the function returns `{ received: true, duplicate: true }` immediately without re-processing. This means you can safely re-deliver events from the Stripe Dashboard without creating duplicate subscriptions or emails.

### The Stripe listener secret changes every session

Running `stripe listen` generates a new `whsec_...` each time. If you restart the listener, you must update `STRIPE_WEBHOOK_SECRET` in `supabase/.env` and restart the functions server. Forgetting this causes all webhook deliveries to return HTTP 400 with a signature mismatch error.

### Removed Edge Functions are not pruned automatically

The Supabase GitHub integration deploys functions declared in `config.toml` but never deletes ones you have removed. A removed function keeps running in the project until you explicitly prune it:

```bash
npm run functions:prune -- --project-ref <ref> --dry-run   # preview what would be deleted
npm run functions:prune -- --project-ref <ref>             # delete orphans
```

### File uploads use compensating transactions

If a file is uploaded to Supabase Storage but the subsequent database insert fails, the orphaned file must be deleted in the `catch` block. See `frontend/src/components/GrantAttachments.js` for the reference pattern. Not cleaning up orphaned files wastes storage and makes it impossible to re-upload the same filename later.

---

## Related Guides

- [Local Onboarding](local_onboarding.md) — first-time environment setup
- [Full Deployment Guide](../how_to/deployment.md) — complete bootstrap procedure with credential management
- [Local Stripe Testing](../how_to/local_stripe_testing.md) — deep dive on the billing function architecture
- [Making Schema Changes](../how_to/make_schema_changes.md) — how to add migrations correctly
- [Promoting a Super Admin](../how_to/promote_superadmin.md) — first-time admin setup after deploy
- [Environment Variables Reference](../reference/environment_variables.md) — every variable, where it goes, and how to get it
