# GrantTrail — Prod Cutover Checklist

> **Temporary working doc.** The core paid flows (paywall, tier mapping,
> lapse/reactivate, webhook idempotency, payment-confirmation email + failure
> isolation) are already verified and were removed from this list. What remains is
> the prod cutover, split into two phases.
>
> **All code and wiring are already written.** Phase 1 stands up prod with email
> intentionally OFF; **domain verification is the only thing that gates Phase 2**,
> and turning email on after it is pure configuration — no code changes.
>
> Step-by-step detail + exact commands: **`docs/how_to/prod_setup.md`**; DNS records:
> **`EMAIL-DNS-SETUP.md`**.
>
> **Legend:** 🟠 human action · 🔴 human decision

---

## Phase 1 — Stand up prod & verify everything except email

> Email is deliberately OFF in this phase: leave `RESEND_API_KEY` and `EMAIL_FROM`
> **blank**. The send is failure-isolated, so blank = the receipt is silently
> skipped, nothing else is affected (no errors, no `system_logs` rows). Nothing
> here depends on the Resend domain.

**Provision** (`prod_setup.md` → Part B):
- [ ] 🟠 **Clear the existing prod Supabase DB** (project `danufmurtwqlmbiyfdih`) so the deploy's migrations apply onto a clean schema — see `prod_setup.md` → "Clearing the database". *(Your current DB stays as staging; nothing to create.)*
- [ ] 🟠 Have the prod project's **ref** (`danufmurtwqlmbiyfdih`) + a Supabase **access token** (Account → Access Tokens) ready for the deploy step below
- [ ] 🔴 Create **live Stripe** products + prices — Basic, Fiscal Agent (Pro), Directory → copy each live `price_…` id *(you decide which id is which; a wrong map = wrong charge)*
- [ ] 🟠 Run `npx vercel link` → confirm the prod Vercel **project id is different from staging's** *(deploy.yml always deploys `--prod`, so they must be separate projects)*
- [ ] 🟠 Run `npm run deploy:secrets` once → it scaffolds `.deploy/production.env`. Fill the **MANDATORY** block only: Supabase token + ref, `STRIPE_SECRET_KEY=sk_live_…`, the live `price_…` ids, `VERCEL_TOKEN`, `APP_URL`. **Leave `RESEND_API_KEY` and `EMAIL_FROM` blank.**
- [ ] 🟠 Run `npm run deploy:secrets` again → pushes secrets to the GitHub `production` env and creates the live Stripe webhook
- [ ] 🟠 Trigger **`deploy-prod.yml`** (Actions → Run workflow) → deploys DB + edge functions + Vercel; confirm the run is green
- [ ] 🟠 In the prod Supabase SQL editor, wire the DB rows to the live Stripe product ids (`prod_setup.md` → "Seed Stripe product IDs")

**Verify** (no email needed):
- [ ] 🟠 Open the live URL, sign up a brand-new grantee → confirm you hit the **paywall** and can't reach grant/expense features
- [ ] 🟠 In Supabase → **Edge Functions → Secrets**, confirm `RESEND_API_KEY` / `EMAIL_FROM` are **absent** (email correctly off)

---

## Phase 2 — Turn on email (MANDATORY before launch; the only step needing domain verification)

> **Required to complete the cutover.** Email is "optional" only in that Phase 1 can
> deploy without it — the launch is **not** done until receipts are live to real
> customers. This is the single remaining gate; all code + wiring is already in
> place, so it's config + one test.

- [ ] 🟠 **Verify `send.atkasolutions.org` in Resend** — add the domain in Resend, add the 4 GoDaddy DNS records (MX, SPF, DKIM, DMARC), click **Verify** *(`EMAIL-DNS-SETUP.md`)*
- [ ] 🟠 Create a Resend **API key** (Resend → API Keys → `re_…`)
- [ ] 🟠 Set the two values in the GitHub `production` env:
  - `gh secret set RESEND_API_KEY --env production` → paste `re_…`
  - `gh variable set EMAIL_FROM --env production --body 'GrantTrail <receipts@send.atkasolutions.org>'`
- [ ] 🟠 Re-run **`deploy-prod.yml`** → confirm `RESEND_API_KEY` + `EMAIL_FROM` now appear in Supabase → Edge Functions → Secrets
- [ ] 🟠 **End-to-end smoke test** (`prod_setup.md` → "Smoke test"): one real purchase on the live URL (live card, **refund after** in Stripe) → confirm **both** the paywall lifts **and** the receipt email lands in your inbox with the right plan / amount / date. *(The purchase smoke is here, not Phase 1, so a single real charge validates the paywall lift and the email together.)* If the email doesn't arrive: check `system_logs` for `payment_confirmation_email_failure` and the Resend → **Emails** dashboard.

> **Want to validate the email code path before the domain is ready?** Optional: set
> `RESEND_API_KEY` to a real key and `EMAIL_FROM=onboarding@resend.dev`, then do a
> purchase — Resend's sandbox sender delivers **only to your Resend account's own
> email**, but it proves the send works. Domain verification is still required to
> deliver to real customers.

---

## Phase 3 — Post-cutover load check

- [ ] 🟠 After the prod Supabase instance is **upgraded**, re-run the concurrent-user /
  load test (`tests/load/k6-load-test.js`) against prod and confirm it holds under
  expected concurrency.
