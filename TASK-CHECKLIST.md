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
- [ ] 🟢 Once a remote exists, wire CI to call `npm run verify` (the workflows PR never hooked it up)
- [ ] 🟠 Once a remote exists, close stray PR #80 ("Add test.txt") — unrelated leftover

---

## 1. Dev (local) from scratch

Goal: a clean machine → working local app with Stripe test billing **and** real Resend
email, by following the docs verbatim. Instructions must omit nothing.


- [ ] 🟠 Run `npm run setup` → `db:start` → `db:reset` → `dev` on a clean machine + the billing/email smoke test (purchase lifts paywall + email lands). *(Runtime verification — needs Docker + keys; docs verified to match.)*

---

## 2. Staging

Its own Supabase project + Vercel project + GitHub `staging` Environment. Stripe **test**,
Resend **real**. Instructions live in the docs; owner fills `.deploy/staging.env` and deploys.

- [ ] 🟠 Fill `.deploy/staging.env`, then **`npm run deploy:secrets:staging`** (gap #9: do NOT run `node scripts/deploy_secrets.js staging` — defaults to PROD)
- [ ] 🟠 Run **Deploy to Staging** (`workflow_dispatch`); verify migrations push, edge functions deploy, Vercel preview is live
- [ ] 🟢 (deferred) Guarded `db:seed:staging` npm script that hard-refuses the prod ref — **not built**; staging_setup.md documents the manual fresh-DB seed for now (seed.sql is non-idempotent → fresh-DB-only). Build the script when the staging DB actually exists (blocked on the remote anyway).
- [ ] 🟠 Seed staging once (after the staging DB is fresh) per `staging_setup.md` §3
- [ ] 🟠 Staging smoke test: log in as a seeded account (`password123`), Stripe **test** purchase lifts paywall + Resend email lands

---

## 3. Production

Prod Supabase project already exists (`danufmurtwqlmbiyfdih`). Stripe **live**, Resend
**real**. Full steps: `docs/how_to/prod_setup.md`.


- [ ] 🟠 Fill `.deploy/production.env`; create the **live** Stripe webhook + the Resend key; push via **`npm run deploy:secrets`** (defaults to production)
- [ ] 🟠 Run **Deploy to Production** (`workflow_dispatch`)
- [ ] 🟠 End-to-end smoke test: one real purchase (live card, refund after) → paywall lifts **and** receipt email lands
- [ ] 🟠 After upgrading the prod Supabase instance, re-run the load test (`tests/load/k6-load-test.js`) at expected concurrency
- [ ] 🟢 Run security overview

---

## 4. Carried over from architecture-review (folder removed 2026-06-30)

`docs/architecture-review/` (workflows.md, tests.md, modularity.md, security.md, FOLLOWUPS.md)
was deleted once resolved/stale items were closed out. These were still open:

- [ ] 🔴 **Storage IDOR (security audit F4, MED/LOW):** storage SELECT scopes by tenant but not
      by grant owner → intra-tenant access to receipts/attachments via guessable sequential
      paths. Needs an owner-scoped storage policy; deliberately left for human review (risky
      RLS rewrite) rather than agent-authored.
- [ ] 🟠 **CSP enforcing mode (security audit F6, LOW):** `vercel.json` ships
      `Content-Security-Policy-Report-Only` but there's no `report-uri`/`report-to` configured
      and the app isn't deployed (`deploymentEnabled.main: false`) — no telemetry exists to
      confirm zero violations before flipping to enforcing. Revisit once there's a live
      deployment with reporting wired up.
- [ ] 🟢 **Modularity Phases 4/5 (untouched by design):** split `App.js`'s session-hook
      responsibilities; split `supabase/functions/_shared/stripe.ts` (516 lines, 4 jobs) via
      re-exports.
- [ ] 🟢 **Widen typecheck scope:** `checkJs` is enforced only over `src/lib`, `src/hooks`,
      `supabaseClient` (TODO in `frontend/tsconfig.json`); full-src has ~187 legacy errors.
      Ratchet outward as files get annotated.


