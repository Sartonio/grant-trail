# GrantTrail — Master Task Checklist

> **Single place for everything still open.** The current push: make the **setup &
> deploy instructions complete and gap-free** for all three environments — dev (local),
> staging, production — so the owner can supply secrets and run each deploy without
> hitting an undocumented step.
>
> **Division of labour:** the agent completes/verifies the *instructions* (docs + the
> pipeline files they describe). **The owner supplies all real secrets and runs the
> actual deploys** — agents never hold prod/staging credentials.
>
> **Key/secret policy (decided):**
> - **Resend:** real API key in **all three** (local, staging, production).
> - **Stripe:** **test** keys for **local + staging**; **live** keys for **production** only.
>
> **The three flows (consolidated):** dev → `docs/how_to/dev_setup.md` · staging →
> `docs/how_to/staging_setup.md` · prod → `docs/how_to/prod_setup.md`. Everyday ops →
> `docs/how_to/dev_practices.md`. Integrations → `local_stripe_testing.md` / `local_email_testing.md`.
>
> **Legend:** 🟢 agent end-to-end (docs/code) · 🟠 owner action (secrets/deploy) · 🔴 owner decision

---

## 0. Prerequisite — Git remote

The staging/prod pipelines deploy via **GitHub Environments** (`deploy-staging.yml` /
`deploy-prod.yml` → reusable `deploy.yml`) and `scripts/deploy_secrets.js`. The remote
was deleted 2026-06-30, so the repo is **local-only** — none of that can run until a
remote exists again.

- [ ] 🟠 Re-create a GitHub remote and push `main` (needed for CI + staging/prod deploys)
- [ ] 🟢 Once a remote exists, document the branch-protection + required-checks setup in `docs/`

---

## 1. Dev (local) from scratch

Goal: a clean machine → working local app with Stripe test billing **and** real Resend
email, by following the docs verbatim. Instructions must omit nothing.

- [x] 🟢 Consolidated dev flow into `docs/how_to/dev_setup.md` (setup steps, db:start/reset, squashed baseline, test accounts, four-terminal billing stack, gotchas); everyday ops split to `dev_practices.md`. Docs now match the squashed baseline.
- [x] 🟢 Local **Stripe test** flow documented end-to-end (`local_stripe_testing.md`, linked from dev_setup).
- [x] 🟢 **Audit gap #10:** Resend (`RESEND_API_KEY` + `EMAIL_FROM`) added to the dev dotenv block + new `local_email_testing.md`; removed the dead SMTP vars from `supabase/.env.example`.
- [ ] 🟠 Run `npm run setup` → `db:start` → `db:reset` → `dev` on a clean machine + the billing/email smoke test (purchase lifts paywall + email lands). *(Runtime verification — needs Docker + keys; docs verified to match.)*

---

## 2. Staging

Its own Supabase project + Vercel project + GitHub `staging` Environment. Stripe **test**,
Resend **real**. Instructions live in the docs; owner fills `.deploy/staging.env` and deploys.

- [x] 🟢 Wrote `docs/how_to/staging_setup.md` (**audit gap #8**): separate Supabase project (own ref+token); distinct `VERCEL_PROJECT_ID` warning; **test**-key webhook-create command; test price/product IDs; real Resend + verified `EMAIL_FROM`; staging-URL `APP_URL`; Vercel **preview** note; **gap #9** (`deploy:secrets:staging`, never the bare positional) called out.
- [ ] 🟠 Fill `.deploy/staging.env`, then **`npm run deploy:secrets:staging`** (gap #9: do NOT run `node scripts/deploy_secrets.js staging` — defaults to PROD)
- [ ] 🟠 Run **Deploy to Staging** (`workflow_dispatch`); verify migrations push, edge functions deploy, Vercel preview is live
- [ ] 🟢 (deferred) Guarded `db:seed:staging` npm script that hard-refuses the prod ref — **not built**; staging_setup.md documents the manual fresh-DB seed for now (seed.sql is non-idempotent → fresh-DB-only). Build the script when the staging DB actually exists (blocked on the remote anyway).
- [ ] 🟠 Seed staging once (after the staging DB is fresh) per `staging_setup.md` §3
- [ ] 🟠 Staging smoke test: log in as a seeded account (`password123`), Stripe **test** purchase lifts paywall + Resend email lands

---

## 3. Production

Prod Supabase project already exists (`danufmurtwqlmbiyfdih`). Stripe **live**, Resend
**real**. Full steps: `docs/how_to/prod_setup.md`.

> **Prod stays clean — no fake seed data.** `deploy.yml` only runs `db push` (migrations)
> + the real `bootstrap_data.sql` rows (tenant, settings, buckets). Never run `seed.sql`
> against prod; the `db:seed:staging` guard must hard-refuse the prod ref.

- [x] 🟢 Fixed all `prod_setup.md` audit blockers:
  - **#1** `STRIPE_WEBHOOK_SECRET` moved to **MANDATORY** in both `deploy/*.env.example`; prod/staging docs reworded to "paste the `whsec_…` from Part A" (script confirmed not to auto-fetch it).
  - **#2** Removed the "email optional / Turning on email" framing; Resend now mandatory in step 1.
  - **#3** Inlined the Resend domain/DNS steps into Part A step 4; killed the broken `EMAIL-DNS-SETUP.md` link (also fixed the dangling ref in `environment_variables.md`).
  - **#4** Added the squash note to "Clearing the database" (existing prod ref's `schema_migrations` must be cleared before first deploy).
  - **#5** Relabelled the `platform_settings` UPDATE as optional verify/repair.
  - **#6/#7** Removed the stale `Programmer484` Actions URL; fixed README `.deploy/prod.env` → `.deploy/production.env`.
- [ ] 🔴 Confirm production uses **live** Stripe keys (vs. test in local/staging)
- [ ] 🟠 Fill `.deploy/production.env`; create the **live** Stripe webhook + the Resend key; push via **`npm run deploy:secrets`** (defaults to production)
- [ ] 🟠 Run **Deploy to Production** (`workflow_dispatch`)
- [ ] 🟠 End-to-end smoke test: one real purchase (live card, refund after) → paywall lifts **and** receipt email lands
- [ ] 🟠 After upgrading the prod Supabase instance, re-run the load test (`tests/load/k6-load-test.js`) at expected concurrency
- [ ] 🟢 Run security overview

---

## 4. Known issues / cleanup

- [x] 🟢 Fix `supabase/tests/platform-root-config.test.sh` 5/1 failure — re-targeted the assertion at a greenleaf user with no exemption path (was the bright-horizons admin, who legitimately has premium). Now 6/6; other DB suites unaffected.
- [x] 🟢 **Audit gap #11:** verified `audit_log`/`grant_record`/`expenses` exist in the squashed baseline (table names correct); reworded `load_testing.md` "initial schema" → "schema baseline".
- [x] 🟢 **Doc consolidation:** 33→fewer; merged 3 how-tos into `dev_practices.md`, folded the payment-and-deployment guide's dev half into `dev_setup.md` and deleted it (its prod half was wrong — claimed "no prod env / staging = yfkmoeuimqpegfuhplwr"); fixed `deploy_architecture.md` staging auto-deploy contradiction; retargeted all inbound links (README, pitfalls, authentication_flow, environment_variables, pre-push hook).
- [x] 🟢 **Automation:** folded `db:types` into `db:reset` so generated types never go stale after a migration (the one footgun worth a hook/script; rest already covered by pre-push/post-merge/CI).

---

> **Charity-directory review** (can wait) — see project memory `charity-directory-followups`.
> **Billing model redesign** (future, optional) → `docs/roadmap/billing-model-redesign.md`
