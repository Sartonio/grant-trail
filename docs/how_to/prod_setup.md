# Production Setup Checklist

Production config has **one source of truth**: a git-ignored file at
`.deploy/prod.env`. You fill it in once, run **one command**, and every value
lands in the GitHub `production` environment. The *Deploy to Production*
workflow is the only thing that reads it — on each run it sets the Supabase
secrets and injects the Vite build vars, then deploys. **You never add variables
by hand in the GitHub, Vercel, or Supabase dashboards.**

```
.deploy/prod.env  ──(npm run deploy:secrets)──▶  GitHub `production` env
                                                        │
                                          (Deploy to Production workflow)
                                                        ├──▶ Supabase secrets
                                                        ├──▶ Vercel build (Vite vars)
                                                        └──▶ deploy
```

The only places you still touch a dashboard are to **create** external
resources (a Supabase project, Stripe products) and mint API tokens — there's no
config left to copy-paste between platforms.

---

## 1. Create the external resources

Two things must exist before anything else; both are external accounts the
script can't create for you.

1. **Supabase project** — [supabase.com](https://supabase.com) → **New project**.
   Wait for it to provision. Note the **Project Ref** (the short id in the URL).
2. **Stripe products** — in the Stripe **live** [dashboard](https://dashboard.stripe.com/products),
   create two products, each with one recurring monthly price: **Basic Membership**
   and **Premium Membership**. (Or with the CLI: `stripe products create …` then
   `stripe prices create …`.)

---

## 2. Create the GitHub config file

```bash
npm run deploy:secrets
```

On the first run there's nothing to push yet — it scaffolds `.deploy/prod.env`
from the committed template ([`deploy/prod.env.example`](../../deploy/prod.env.example))
and exits. Open that file; every key has a comment saying exactly where its value
comes from.

---

## 3. Fill in the values

Gather these into `.deploy/prod.env`. Most are a copy from a dashboard or a
one-line CLI command — collect them in a single pass:

| Key | Where it comes from |
|-----|---------------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase → [Account → Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROD_PROJECT_REF` | Your project ref from Step 1 |
| `VITE_SUPABASE_KEY` | Supabase → Project Settings → API → **publishable** key (`sb_publishable_…`) |
| `VITE_SUPABASE_URL` | *Leave blank* — derived from the project ref automatically |
| `STRIPE_SECRET_KEY` | Stripe → [Developers → API keys](https://dashboard.stripe.com/apikeys) (`sk_live_…`) |
| `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` | `stripe prices list --limit 100` |
| `STRIPE_WEBHOOK_SECRET` | See the Stripe CLI snippet below (`whsec_…`) |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | *Optional* — `stripe billing_portal configurations list` (blank = Stripe default) |
| `APP_URL` | Your live URL (defaults to `https://grant-trail.vercel.app`) |
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | `npx vercel link`, then read `.vercel/project.json` (`orgId` / `projectId`) |
| `VITE_SENTRY_DSN` | *Optional* — your prod Sentry DSN (blank = Sentry disabled) |

**Create the Stripe webhook + capture its secret in one shot** (no dashboard):

```bash
stripe webhook_endpoints create \
  --url https://<prod-ref>.supabase.co/functions/v1/stripe-webhook \
  --enabled-events checkout.session.completed \
  --enabled-events customer.subscription.updated \
  --enabled-events customer.subscription.deleted
```

Copy the `secret` (`whsec_…`) from the response into `STRIPE_WEBHOOK_SECRET`.

---

## 4. Push it all

```bash
npm run deploy:secrets
```

This time the file is filled in, so the script:

1. Ensures the GitHub `production` environment exists (creates it if missing).
2. Validates every required value is present (optional keys may be blank).
3. Pushes each key as a **secret** (sensitive) or **variable** (public) — values
   go over stdin, never your shell history.
4. Prints the resulting environment contents so you can confirm.

Preview without changing anything with `npm run deploy:secrets -- --dry-run`.
Re-run any time you rotate a key — it's idempotent. The file stays on disk as
your editable source of truth (pass `--shred` to delete it after pushing).

> **One manual GitHub step (recommended, once):** add a **required reviewer** to
> the `production` environment (Settings → Environments → production) so prod
> deploys pause for approval. The script can't set reviewers via the API.

---

## 5. Trigger the first prod deploy

1. GitHub repo → [Actions → `Deploy to Production`](https://github.com/Programmer484/grant-trail/actions/workflows/deploy-prod.yml).
2. **Run workflow** → approve the environment prompt.
3. The workflow pushes Supabase secrets, applies migrations, deploys edge
   functions, then builds and deploys the frontend (injecting the Vite vars from
   the `production` environment — no Vercel dashboard config involved).
4. Confirm migrations applied and functions are listed in Supabase, and that the
   Vercel production deployment succeeded.

---

## 6. Seed prod database data

After the first deploy, open the [Supabase SQL editor](https://supabase.com/dashboard/project/_/sql)
for your prod project and link the database to your Stripe products (find the
Product IDs in your [Stripe dashboard](https://dashboard.stripe.com/products)):

```sql
UPDATE platform_settings
SET
  basic_membership_product_id   = 'prod_...',   -- Basic product ID
  premium_membership_product_id = 'prod_...'    -- Premium product ID
WHERE id = 1;
```

> This is the only step that can't be automated — it's data, not config.

---

## 7. Smoke test

- Sign up as a new user on the prod URL.
- Attempt a Basic checkout — confirm Stripe live mode fires and the webhook is
  received (Stripe → Developers → Webhooks → your endpoint → recent events).
- Confirm subscription status reflects correctly in the app.

---

## Re-deploying later

1. Changed **config** (rotated a key, new price id)? Edit `.deploy/prod.env` →
   `npm run deploy:secrets`.
2. Then (or for a plain code/schema deploy): Actions → `Deploy to Production` →
   **Run workflow** → approve. No dashboard steps.
