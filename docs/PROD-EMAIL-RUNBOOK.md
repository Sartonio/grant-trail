# GrantTrail — Production Email Runbook (Human Actions)

> **Temporary working doc.** Step-by-step for the human-only tasks that gate prod
> email and the prod cutover: TEST-CHECKLIST.md lines 45–47 (🟠), blocker #2
> (Resend/GoDaddy DNS), blocker #3 (new prod), and the line 62 human smoke test.
> Everything here was verified by code/config inspection on branch
> `docs/email-resend-smtp`. Delete once folded into the permanent docs.

**Source of truth in code/config (all verified correct):**
- Email transport: `supabase/functions/_shared/email.ts`
- Secret forwarding: `.github/workflows/deploy.yml` (called by `deploy-prod.yml` / `deploy-staging.yml`)
- Secret sync tool: `scripts/deploy_secrets.js` + `deploy/{production,staging}.env.example`
- DNS task: `EMAIL-DNS-SETUP.md`
- Smoke test reference: `docs/tutorials/payment-and-deployment-guide.md`, `docs/tutorials/Grantee-Walkthrough.md`

---

## Transport: Resend HTTP API (decided)

The email transport is **Resend's HTTPS API** (`fetch` to `https://api.resend.com/emails`),
not SMTP. `email.ts` reads `RESEND_API_KEY` + `EMAIL_FROM` (with a legacy fallback
to `SMTP_FROM`). Both must be set for a receipt to send; if either is unset the
send is skipped (no-op warning).

**Why not SMTP/denomailer:** when the relay was unreachable, denomailer's socket
failure escaped the Deno event loop and **crashed the edge worker → HTTP 503**, so
Stripe retried and the `billing_webhook_events` dedup row was never written. A
failed `fetch` is a normal awaitable rejection the webhook catches cleanly, so the
payment-confirmation send is now genuinely isolated (webhook still 200; subscription
still synced; one `payment_confirmation_email_failure` row logged). This was proven
live by `supabase/functions/tests/email-resilience.test.sh`.

There is consequently **no SMTP relay decision** and **no `SMTP_*` config** anymore —
just a Resend API key and a verified sending domain.

---

## 1. GitHub `production` environment secrets/variables to set

Verified wiring: `deploy.yml` runs `supabase secrets set` and pulls each value from
the `production` environment. `scripts/deploy_secrets.js` classifies `RESEND_API_KEY`
as a **secret** and `EMAIL_FROM` as a **variable**. The split is present in both places.

**Email keys — set in the GitHub `production` environment:**

| Key | Kind | Where `deploy.yml` reads it | Value |
|---|---|---|---|
| `RESEND_API_KEY` | **Secret** | `${{ secrets.RESEND_API_KEY }}` | your Resend API key (`re_...`) |
| `EMAIL_FROM` | **Variable** | `${{ vars.EMAIL_FROM }}` | `GrantTrail <receipts@send.atkasolutions.org>` |

> Both are required for receipts to send. `EMAIL_FROM` must be on a domain verified
> in Resend (Section 3); until that domain is verified, sends to non-account
> addresses will fail (and be logged as `payment_confirmation_email_failure`, without
> blocking the payment).

**Do this (preferred, via the repo tool):**

```bash
# From repo root. Creates .deploy/production.env from deploy/production.env.example,
# then pushes the right keys as secrets vs variables to the GitHub `production` env.
npm run deploy:secrets          # first run scaffolds the file, then exit
# edit .deploy/production.env, fill RESEND_API_KEY (re_...) and EMAIL_FROM, then:
npm run deploy:secrets          # pushes; shreds the file afterward unless --keep
```

**Or do it by hand:**

```bash
printf '%s' 're_xxxxxxxxxxxxxxxxxxxx'                          | gh secret   set RESEND_API_KEY --env production
gh variable set EMAIL_FROM --env production --body 'GrantTrail <receipts@send.atkasolutions.org>'
```

**Verify they reach Supabase:**

1. `gh secret list --env production` and `gh variable list --env production` — confirm `RESEND_API_KEY` (secret) and `EMAIL_FROM` (variable) appear.
2. Trigger the prod deploy (`deploy-prod.yml`, `workflow_dispatch`, gated by required reviewers).
3. In the run's **"Push secrets to Supabase"** step, confirm `supabase secrets set` ran without error (values are masked).
4. In the Supabase dashboard → your prod project → **Edge Functions → Secrets**, confirm `RESEND_API_KEY` and `EMAIL_FROM` are listed.

---

## 2. EMAIL_FROM (checklist lines 45 & 46)

Lines 45 (`SMTP_FROM` matches mailbox) and 46 (TLS/port) were **SMTP-specific and no
longer apply** — the Resend HTTP API has no relay mailbox, port, or STARTTLS to match.
They are superseded by the single `EMAIL_FROM` requirement below.

`email.ts`:
```ts
const FROM_EMAIL = Deno.env.get('EMAIL_FROM') || Deno.env.get('SMTP_FROM') || '';
```

**Do this:**
- Set `EMAIL_FROM="GrantTrail <receipts@send.atkasolutions.org>"` (or any address on
  the domain you verify in Section 3) as a **variable** in the GitHub `production` env.
- It must be on a Resend-verified domain. Sending from an unverified domain returns a
  non-2xx from Resend, which the webhook logs as `payment_confirmation_email_failure`
  (severity `error`) — the payment still succeeds, but the receipt won't deliver.
- The legacy `SMTP_FROM` fallback exists only to ease migration; prefer `EMAIL_FROM`.

---

## 3. DNS verification (GoDaddy) — blocker #2

Goal: verify `send.atkasolutions.org` in Resend so receipts deliver to ANY
customer (the shared `onboarding@resend.dev` sender only delivers to the Resend
account owner). Uses a `send.` subdomain so the apex website is untouched.

**Step 1 — Resend (you):**
1. resend.com → **Domains → Add Domain** → enter `send.atkasolutions.org` → **Create**.
2. Leave the records table open; copy each **Value** into GoDaddy below.

**Step 2 — GoDaddy DNS (domain owner):**
- GoDaddy → **My Products** → `atkasolutions.org` → **DNS** (or `dcc.godaddy.com` → domain → **DNS → DNS Records**).
- ⚠️ GoDaddy auto-appends `.atkasolutions.org` to the Name/Host. Enter only the part *before* it.

**Step 3 — Add each record** (exact values come from the Resend page; examples shown):

| # | Type | Name/Host (enter this) | Value | Priority | TTL |
|---|------|------------------------|-------|----------|-----|
| 1 | MX   | `send` | Resend's MX target, e.g. `feedback-smtp.us-east-1.amazonses.com` | 10 | 1 hr |
| 2 | TXT  | `send` | Resend's SPF, e.g. `v=spf1 include:amazonses.com ~all` | — | 1 hr |
| 3 | TXT  | `resend._domainkey.send` | Resend's long DKIM key | — | 1 hr |
| 4 | TXT  | `_dmarc.send` | `v=DMARC1; p=none;` (or Resend's suggested value) | — | 1 hr |

**Step 4 — Verify (Resend):**
1. Save in GoDaddy; wait ~15–60 min for propagation.
2. Resend → **Domains → Verify**. All records should turn green.
3. Then set `EMAIL_FROM="GrantTrail <receipts@send.atkasolutions.org>"` in the GitHub
   `production` environment (Section 1) and redeploy.

---

## 4. End-to-end human smoke test (checklist line 62, blocker #4)

A single real test-mode purchase, end to end. Run against the deployed prod (or
staging) URL with Stripe in the matching mode.

1. **Sign up** as a brand-new grantee on the live URL (`APP_URL`). Use an inbox you
   control as the account email.
2. Navigate so the paywall triggers — click **Subscription** in the nav bar
   (Grantee-Walkthrough §14). Confirm you are gated (cannot reach grant/expense features).
3. Click **Purchase Basic** (or **Purchase Premium**) → you are redirected to Stripe Checkout.
4. Complete payment. In **test mode** use card `4242 4242 4242 4242`, any future
   expiry, any CVC, any postal code. (In live mode, use a real card / refund after.)
5. You're redirected back to the **Subscription** page → click **Refresh Access Status**.
6. **Confirm the paywall lifts:** the plan card shows your active plan and you can
   now open the dashboard and use grant/expense features.
7. **Confirm the receipt email** arrived in that inbox within a minute. Open it and
   check: correct plan name, amount, currency, payment date, renewal date, and the
   subscription reference render correctly (no broken layout). Subject:
   `Your GrantTrail receipt — <plan>`.
8. **If the email did NOT arrive:** the payment still succeeds by design (failure is
   isolated). Check Supabase `system_logs` for `event_name = 'payment_confirmation_email_failure'`,
   and check the Resend dashboard → **Emails** for delivery status/bounce.

Reference: `docs/tutorials/payment-and-deployment-guide.md` §"Post-deploy smoke test"
and `docs/tutorials/Grantee-Walkthrough.md` §14 (Purchasing a Plan).

---

## 5. New prod provisioning checklist (blocker #3)

High-level ordered steps to stand up a fresh prod and demote the current project to
staging. The mechanics are scripted — see `docs/how_to/prod_setup.md` and the
reusable `deploy.yml`.

1. **Demote current → staging.** Put the current project's config into the GitHub
   `staging` environment: `node scripts/deploy_secrets.js --env staging`
   (auto-deploys on every push to `main` via `deploy-staging.yml`).
2. **New Supabase project.** supabase.com → **New project** (prod). Note the project
   ref; mint a Supabase access token (Account → Access Tokens).
3. **Live Stripe products/prices.** In the Stripe **live** dashboard create the
   Basic and Premium (Pro) products + the Directory price. Copy the live price IDs —
   you assign which id is Basic vs Pro (the script will not guess; a wrong map = wrong charge).
4. **Vercel link.** `npx vercel link` once so `scripts/deploy_secrets.js` can read
   `.vercel/project.json` (org/project IDs).
5. **Fill `production` config.** `npm run deploy:secrets` scaffolds
   `.deploy/production.env` from `deploy/production.env.example`. Fill the MANDATORY
   block (Supabase token + ref, `STRIPE_SECRET_KEY=sk_live_...`, the live price IDs,
   `VERCEL_TOKEN`, `APP_URL`) and the email block (Section 1). Leave AUTOFILLED blank.
6. **Sync to GitHub + create the live webhook.** Re-run `npm run deploy:secrets`.
   It auto-fetches the Supabase URL + publishable key and Vercel IDs, **creates the
   live Stripe webhook endpoint** at `https://<ref>.supabase.co/functions/v1/stripe-webhook`
   (events: `checkout.session.completed`, `customer.subscription.updated/deleted`)
   and captures its signing secret, then pushes everything to the `production` env and
   shreds the local file. (`--dry-run` to preview, `--recreate-webhook` to rotate.)
7. **Deploy.** Trigger `deploy-prod.yml` (`workflow_dispatch`; gated by the
   `production` environment's required-reviewer rule). `deploy.yml` pushes Supabase
   secrets, links the project, runs `supabase db push`, deploys all edge functions,
   then builds and deploys the Vercel prod artifact.
8. **Post-deploy DB wiring.** In the prod Supabase SQL editor, link the DB rows to
   the live Stripe product IDs (see `prod_setup.md` §post-deploy).
9. **DNS + email.** Complete Sections 2–3 of this runbook for the prod sender domain.
10. **Smoke test.** Run Section 4 against the prod URL in live mode (refund the test charge).

> ⚠️ **Flag for the human:** `deploy.yml` hardcodes `--environment=production` and
> `--prod` for the Vercel pull/build/deploy steps (lines 84, 90, 103) regardless of
> the `environment` input. That means the `staging` caller would still deploy to the
> Vercel *production* target unless the Vercel project for staging is separate
> (distinct `VERCEL_PROJECT_ID` in the `staging` env). Confirm staging and prod use
> **different Vercel projects** before relying on `deploy-staging.yml`.
