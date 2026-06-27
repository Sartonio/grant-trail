# Production Setup Checklist

Production config has **one source of truth**: a git-ignored file at
`.deploy/production.env`. You fill it in once, run **one command**, and every value
lands in the GitHub `production` environment. The *Deploy to Production*
workflow is the only thing that reads it — on each run it sets the Supabase
secrets and injects the Vite build vars, then deploys. **You never add variables
by hand in the GitHub, Vercel, or Supabase dashboards.**

```
.deploy/production.env  ──(npm run deploy:secrets)──▶  GitHub `production` env
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

On the first run there's nothing to push yet — it scaffolds `.deploy/production.env`
from the committed template ([`deploy/production.env.example`](../../deploy/production.env.example))
and exits. Open that file; every key has a comment saying exactly where its value
comes from.

---

## 3. Fill in the values

Fill the **MANDATORY** block by hand; everything in the **AUTOFILLED** block is
fetched on the next run (leave it blank). The **OPTIONAL** block can stay blank.

First run `npx vercel link` once so the script can read your Vercel IDs.

**MANDATORY — fill these in `.deploy/production.env`:**

| Key | Where it comes from |
|-----|---------------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase → [Account → Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF` | Your project ref from Step 1 |
| `STRIPE_SECRET_KEY` | Stripe → [Developers → API keys](https://dashboard.stripe.com/apikeys) (`sk_live_…`) |
| `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO` | `stripe prices list --limit 100` — **you** pick which id is which tier (the script won't guess; wrong mapping = wrong charge) |
| `VERCEL_TOKEN` | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Your hosting cPanel → **Email Accounts** → the mailbox's outgoing-SMTP details (host + full email address + password) |
| `APP_URL` | Your live URL (defaults to `https://grant-trail.vercel.app`) |

**OPTIONAL — fill only if needed:**

| Key | When |
|-----|------|
| `SMTP_PORT` | Defaults to `465` (implicit TLS); set `587` for STARTTLS |
| `SMTP_FROM` | Defaults to `GrantTrail <SMTP_USER>`; set only if the relay allows a different `From` |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | Blank uses the Stripe default |
| `VITE_SENTRY_DSN` | Blank disables Sentry |

**AUTOFILLED — leave these blank, filled on run:**

| Key | How |
|-----|-----|
| `VITE_SUPABASE_URL` | Derived from the project ref |
| `VITE_SUPABASE_KEY` | Fetched via the Supabase CLI (your access token) |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | Read from `.vercel/project.json` (after `vercel link`) |
| `STRIPE_WEBHOOK_SECRET` | The prod webhook endpoint is **created** via the Stripe CLI and its secret captured |

---

## 4. Push it all

```bash
npm run deploy:secrets
```

This time the file has the six values, so the script:

1. **Auto-fetches** the blanks (Supabase URL + key, Vercel IDs, and creates the
   Stripe webhook to capture its secret), writing them back into the file.
2. Ensures the GitHub `production` environment exists (creates it if missing).
3. Validates every required value is present (optional keys may be blank).
4. Pushes each key as a **secret** (sensitive) or **variable** (public) — values
   go over stdin, never your shell history.
5. Prints the resulting environment contents, then **deletes `.deploy/production.env`**
   so no live secrets sit on disk.

Preview without changing anything (no webhook is created) with
`npm run deploy:secrets -- --dry-run`. Re-run any time you rotate a key — it's
idempotent. Pass `--keep` to retain the file, or `--recreate-webhook` to rotate
the Stripe endpoint's signing secret.

> **Live customers:** because the file is shredded by default, the only standing
> copy of your prod secrets is GitHub's encrypted `production` environment. When
> you outgrow that, move the source of truth to a secrets manager
> (Doppler / Infisical / 1Password) and have the script pull from it.

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

1. Changed **config** (rotated a key, new price id)? Edit `.deploy/production.env` →
   `npm run deploy:secrets`.
2. Then (or for a plain code/schema deploy): Actions → `Deploy to Production` →
   **Run workflow** → approve. No dashboard steps.
