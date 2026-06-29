# GrantTrail — Master Task Checklist

> **Single place for everything still open** — active work plus the charity-directory
> review (the review can wait, but it lives here too). Detail docs: prod deploy →
> `docs/how_to/prod_setup.md` · email DNS → `EMAIL-DNS-SETUP.md`.
>
> **Legend:** 🟢 agent end-to-end · 🟠 human action · 🔴 human decision · 🔵 third-party access handoff (blocked on a teammate)

---

## 1. Prod cutover (active)

Prod Supabase project already exists (`danufmurtwqlmbiyfdih`); the current/working DB
is **staging**. Full steps: `prod_setup.md`.

### Phase 0 — access handoffs (blocked on a teammate)
> Everything below is gated on a teammate granting access — nothing in Phase 1+ can
> proceed until these three land. Track who owns each handoff.

- [ ] 🔵 Get **owner/admin access to the prod Supabase** project (`danufmurtwqlmbiyfdih`, the "big" one) — currently held by the teammate
- [ ] 🔵 Get **Vercel access** — teammate creates the prod Vercel project under their account and shares/transfers it to you (member invite or project transfer)
- [ ] 🔵 Get **full GoDaddy DNS access** for `atkasolutions.org` — required for the Resend domain verification in Phase 2

### Phase 1 — turn on email (MANDATORY before launch; the only step needing domain verification)
- [ ] 🟠 Verify `send.atkasolutions.org` in Resend (GoDaddy DNS: MX, SPF, DKIM, DMARC) — `EMAIL-DNS-SETUP.md`
- [ ] 🟠 Create the Resend API key; set `RESEND_API_KEY` (secret) + `EMAIL_FROM` (variable) in GitHub `production`; re-run **Deploy to Production**
- [ ] 🟠 End-to-end smoke test: one real purchase (live card, refund after) → paywall lifts **and** receipt email lands

### Phase 2 — post-cutover
- [ ] 🟠 After upgrading the prod Supabase instance, re-run the load test (`tests/load/k6-load-test.js`) at expected concurrency

---

## 2. Charity directory — remaining (active)

- [ ] 🟠 Confirm the **B1 follow-up**: `MEMBERSHIP_TIERS.FISCAL_AGENT` was deliberately retained as a client-side-only checkout label that resolves to `premium`/`STRIPE_PRICE_FISCAL_AGENT` server-side (documented in `billing.js`). Confirm this matches intent.
- [ ] 🟢 Work the **B3–B9** functionality audit (§3) — mostly verifiable in-repo.

---

## 3. Charity directory — functionality audit (do later)

> Verify the charity / fiscal-agent feature still holds; not all known-broken.
> Grounded in: migration `supabase/migrations/20260624120000_charity_directory.sql`,
> `_shared/stripe.ts`, `create-fiscal-agent-checkout-session/`, `FiscalAgent*` components,
> `frontend/src/lib/{billing,policy}.js`, `docs/explanation/charity_directory_contract.md`.

- **B3. Pay-first provisioning robustness** (`provisionFiscalAgentFromCheckout` + webhook): duplicate-event
  idempotency, partial-failure behavior (re-raise vs email isolated), existing account w/ same billing
  email, invite-token issuance, `FiscalAgentCheckoutReturn.js` status read.
- **B4. Tier mapping** in `upsertSubscriptionFromStripe`: onboarding sub lands as `premium` so
  `canOwnListing` is true; `membership_tier` CHECK accepts the tiers used; product-match trigger doesn't trip.
- **B5. Session/policy wiring:** `get_session_context` returns the keys `policy.js` reads
  (`canViewDirectory`/`canOwnListing`); no leftover reads returning `undefined`; `policy.test.js` covers the folded model.
- **B6. Frontend gating is server-enforced:** teaser-vs-full fetch in `FiscalAgentDirectory.js`;
  `useWriteGuard` on `FiscalAgentListingEditor`/inbox for lapse.
- **B7. Routes/auth** (`App.js`): `/fiscal-agents/list`, `/checkout/return`, `/me`, `/listing/edit`,
  `/onboard` correctly gated; public `/fiscal-agents` + `/:id` with in-component paywall.
- **B8. Data integrity:** `set_inquiry_tenant_id` trigger sets `tenant_id` from the listing; FK +
  status/verification CHECKs; `updated_at` upkeep.
- **B9. Tests/seed/CI:** `charity-directory-rls.test.sh` wired into CI; `seed.sql` has the contract's
  test rows (published+verified, draft, unverified, inquiries); seed stays local-only.
