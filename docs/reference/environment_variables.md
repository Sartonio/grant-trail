# Environment Variables Reference

This page documents every environment variable used in GrantTrail, where it is set, and how to obtain it.

---

## Overview

GrantTrail uses three separate env files, each serving a different runtime:

| File | Runtime | Git-ignored? |
|------|---------|-------------|
| `frontend/.env.local` | Vite dev server (local only) | ✅ Yes |
| `frontend/.env.production` | N/A — **do not create this file** | — |
| `supabase/.env` | Supabase Edge Functions (local only) | ✅ Yes |

> **Production:** There are no env files in production. The frontend variables are injected by Vercel at build time. The Edge Function secrets are stored in Supabase's secrets vault via CLI.

---

## `frontend/.env.local` — Frontend (Local Dev)

Read by the Vite dev server at startup. Values are statically embedded into the compiled JavaScript bundle via `import.meta.env.*`.

| Variable | Required | Description | Where to get it |
|----------|----------|-------------|----------------|
| `VITE_SUPABASE_URL` | ✅ | URL of the Supabase project the frontend connects to | Local: `http://127.0.0.1:54321` (auto-set by `npm run setup`). Production: Supabase Dashboard → Project Settings → API |
| `VITE_SUPABASE_KEY` | ✅ | Supabase anon/public key — safe to expose in the browser, subject to RLS | Local: pre-filled by `npm run setup`. Production: Supabase Dashboard → Project Settings → API → `anon` key |
| `VITE_SENTRY_DSN` | ❌ Optional | Sentry DSN for frontend error tracking. Omit or leave blank to disable Sentry. | [sentry.io](https://sentry.io) → Project → Settings → Client Keys |

---

## `supabase/.env` — Edge Functions (Local Dev)

Read by the Supabase CLI when serving Edge Functions locally (`supabase functions serve`). These mirror the secrets you must also set in the Supabase secrets vault for production.

| Variable | Required | Description | Where to get it |
|----------|----------|-------------|----------------|
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret API key used to create checkout sessions, portal sessions, and retrieve subscriptions | [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys) — use `sk_test_...` locally, `sk_live_...` in production |
| `STRIPE_PRICE_BASIC` | ✅ | Stripe Price ID for the Basic membership plan | [Stripe Dashboard → Product Catalog](https://dashboard.stripe.com/products) → Basic plan → Price ID (`price_...`) |
| `STRIPE_PRICE_PRO` | ✅ | Stripe Price ID for the Premium membership plan. | Same as above, for the Premium plan |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Signing secret used to verify that webhook events genuinely came from Stripe | [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks) → your endpoint → Signing secret (`whsec_...`) |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | ❌ Optional | ID of a custom Stripe Billing Portal configuration. If omitted, Stripe uses the default portal configuration. | [Stripe Dashboard → Billing → Customer Portal](https://dashboard.stripe.com/settings/billing/portal) → Configuration ID (`bpc_...`) |
| `APP_URL` | ✅ | The frontend URL, used for Stripe redirect URLs after checkout/portal | Local: `http://localhost:3000`. Production: your Vercel URL |
| `SMTP_HOST` | ❌ Optional (disables email) | SMTP server host used to send payment confirmation emails after a successful Stripe checkout. Leave blank locally to skip email sending. We send via [Resend](https://resend.com) over SMTP: `smtp.resend.com`. | Resend → SMTP settings |
| `SMTP_USER` | ❌ Optional (required to send) | SMTP username. For Resend this is the literal word `resend`. | Resend → SMTP settings |
| `SMTP_PASS` | ❌ Optional (required to send) | SMTP password. For Resend this is your API key (`re_...`). | [Resend Dashboard → API Keys](https://resend.com/api-keys) |
| `SMTP_PORT` | ❌ Optional (default `465`) | `465` = implicit TLS, `587` = STARTTLS. | — |
| `SMTP_FROM` | ❌ Optional | The `From` address for outgoing emails. Defaults to `GrantTrail <SMTP_USER>`. **Production must use a Resend-verified domain** (e.g. `GrantTrail <receipts@send.atkasolutions.org>`); `onboarding@resend.dev` only delivers to the Resend account owner. See `EMAIL-DNS-SETUP.md`. | Resend Dashboard → Domains |

> **Note:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected by the Supabase runtime into every Edge Function. You do not need to set these manually.

---

## Production: Vercel Environment Variables

Set in the Vercel Dashboard under **Project Settings → Environment Variables**, scoped to **Production**.

Vercel injects these at build time — Vite statically embeds them into the compiled bundle. No file is needed.

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your production Supabase project URL (`https://<ref>.supabase.co`) |
| `VITE_SUPABASE_KEY` | Your production Supabase anon/public key |
| `VITE_SENTRY_DSN` | (Optional) Sentry DSN for production error tracking |

---

## Production: Supabase Edge Function Secrets

Set via the Supabase CLI. These are stored encrypted in Supabase's secrets vault — never in files or commits.

```bash
npx supabase secrets set --project-ref <your-project-ref> \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_PRICE_BASIC="price_..." \
  STRIPE_PRICE_PRO="price_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  APP_URL="https://your-app.vercel.app"
```

Optionally also set:
```bash
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID="bpc_..." \
  SMTP_HOST="smtp.resend.com" \
  SMTP_USER="resend" \
  SMTP_PASS="re_..." \
  SMTP_PORT="465" \
  SMTP_FROM="GrantTrail <receipts@send.atkasolutions.org>"
```

You can also view and manage these in the Supabase Dashboard under **Project Settings → Edge Functions → Secrets**.

---

## E2E Tests

The Playwright and k6 test suites read env vars directly from the shell environment (not from `.env` files). Set these before running tests:

| Variable | Used by | Description |
|----------|---------|-------------|
| `VITE_SUPABASE_URL` | Playwright (`playwright.config.js`) | Supabase URL for the test target |
| `VITE_SUPABASE_KEY` | Playwright | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Playwright E2E fixtures | Service role key for test setup/teardown (bypasses RLS) |
| `SUPABASE_URL` | k6 load tests | Supabase URL |
| `SUPABASE_ANON_KEY` | k6 load tests | Supabase anon key |

### CI: Stripe-enabled edge-function tests

The `build-and-test` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs the Stripe edge-function tests against **TEST-mode** keys sourced from GitHub Actions secrets (never prod keys). They are mapped onto the runtime var names the functions expect:

| CI secret | Mapped to | Description |
|-----------|-----------|-------------|
| `STRIPE_SECRET_KEY_TEST` | `STRIPE_SECRET_KEY` (and `STRIPE_API_KEY`) | Test-mode Stripe secret key |
| `STRIPE_PRICE_BASIC_TEST` | `STRIPE_PRICE_BASIC` | Test-mode Basic price ID |
| `STRIPE_PRICE_PRO_TEST` | `STRIPE_PRICE_PRO` | Test-mode Premium price ID |

`STRIPE_WEBHOOK_SECRET` is derived at runtime from `stripe listen --print-secret` (the forwarder's signing secret), and `APP_URL` is set to `http://localhost:3000`.

---

## Quick Reference

| Variable | Local file | Vercel | Supabase secrets |
|----------|-----------|--------|-----------------|
| `VITE_SUPABASE_URL` | `frontend/.env.local` | ✅ | — |
| `VITE_SUPABASE_KEY` | `frontend/.env.local` | ✅ | — |
| `VITE_SENTRY_DSN` | `frontend/.env.local` | ✅ optional | — |
| `STRIPE_SECRET_KEY` | `supabase/.env` | — | ✅ |
| `STRIPE_PRICE_BASIC` | `supabase/.env` | — | ✅ |
| `STRIPE_PRICE_PRO` | `supabase/.env` | — | ✅ |
| `STRIPE_WEBHOOK_SECRET` | `supabase/.env` | — | ✅ |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | `supabase/.env` optional | — | ✅ optional |
| `APP_URL` | `supabase/.env` | — | ✅ |
| `SMTP_HOST` | `supabase/.env` optional | — | ✅ optional |
| `SMTP_USER` | `supabase/.env` optional | — | ✅ optional |
| `SMTP_PASS` | `supabase/.env` optional | — | ✅ optional |
| `SMTP_PORT` | `supabase/.env` optional | — | ✅ optional |
| `SMTP_FROM` | `supabase/.env` optional | — | ✅ optional |
