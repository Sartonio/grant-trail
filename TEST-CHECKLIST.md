# GrantTrail — Master Task Checklist

> **Single place for everything still open** — active work plus the charity-directory
> review (the review can wait, but it lives here too). Detail docs: prod deploy →
> `docs/how_to/prod_setup.md` · email DNS → `EMAIL-DNS-SETUP.md`.
>
> **Legend:** 🟢 agent end-to-end · 🟠 human action · 🔴 human decision

---

## 1. Prod cutover (active)

Prod Supabase project already exists (`danufmurtwqlmbiyfdih`); the current/working DB
is **staging**. Access token verified working. Full steps: `prod_setup.md`.

### Phase 1 — stand up prod (email OFF)
> Leave `RESEND_API_KEY`/`EMAIL_FROM` blank — the send no-ops cleanly; turn on in Phase 2.

- [ ] 🟠 Clear the existing prod DB (`danufmurtwqlmbiyfdih`) — `prod_setup.md` → "Clearing the database"
- [ ] 🔴 Create live Stripe products + prices — **Basic** and **Premium** ("Fiscal Agents Plan") → copy each live `price_…` id (you decide which is which)
- [ ] 🟠 `npx vercel link` → confirm the prod Vercel project ≠ staging's
- [ ] 🟠 Fill `.deploy/production.env` (Supabase token+ref, `sk_live_…`, price ids, `VERCEL_TOKEN`, `APP_URL`; leave email blank) → `npm run deploy:secrets` twice (scaffold, then push + create webhook)
- [ ] 🟠 Run **Deploy to Production** → confirm the run is green
- [ ] 🟠 Seed Stripe product ids in the prod SQL editor — `prod_setup.md` → "Seed Stripe product IDs"
- [ ] 🟠 Sign up on the live URL → confirm the paywall gates
- [ ] 🟠 Rotate the Supabase PAT that was pasted in chat once cutover is done

### Phase 2 — turn on email (MANDATORY before launch; the only step needing domain verification)
- [ ] 🟠 Verify `send.atkasolutions.org` in Resend (GoDaddy DNS: MX, SPF, DKIM, DMARC) — `EMAIL-DNS-SETUP.md`
- [ ] 🟠 Create the Resend API key; set `RESEND_API_KEY` (secret) + `EMAIL_FROM` (variable) in GitHub `production`; re-run **Deploy to Production**
- [ ] 🟠 End-to-end smoke test: one real purchase (live card, refund after) → paywall lifts **and** receipt email lands

### Phase 3 — post-cutover
- [ ] 🟠 After upgrading the prod Supabase instance, re-run the load test (`tests/load/k6-load-test.js`) at expected concurrency

---

## 2. Charity directory — do next (active)

The actionable subset of the review in §3 (build + the confirmed-open cleanup/verify).

- [ ] 🟢 **A4** — hide zero-state metrics (rating/reviews/sponsored); show a "New" treatment instead
- [ ] 🟢 **A5** — premium lapse → auto-unlist the listing + read-only dashboard/inbox (retain data; re-subscribe re-publishes)
- [ ] 🟢 **A6** — email the charity on each new inquiry (reuse Resend) + in-app "submitted" confirmation to the seeker
- [ ] 🟢 **B1 (+A7)** — purge stale tiers: `directory_access` in `stripe-webhook` PLAN_NAMES + `stripe.ts` KNOWN_TIERS; `MEMBERSHIP_TIERS.FISCAL_AGENT`; dead `STRIPE_PRICE_DIRECTORY` config; fix the receipt label to "Fiscal Agents Plan"
- [ ] 🟢 **B2** — re-audit charity RLS; confirm `supabase/tests/charity-directory-rls.test.sh` is green
- [ ] 🟠 **A8** — trim `/fiscal-agents` marketing copy to the shipped 2-SKU + verification reality

---

## 3. Charity directory — decisions & full review (do later)

> Post-build review of the charity / fiscal-agent feature. The active items in §2 are
> pulled from here. **Biggest risk:** a 3-iteration pricing churn (separate
> `directory_access` + `fiscal_agent` → fold `fiscal_agent` into `premium` → fold
> `directory_access` into `basic`), which already left stale references (B1).
> Grounded in: migration `supabase/migrations/20260624120000_charity_directory.sql`,
> `_shared/stripe.ts`, `create-fiscal-agent-checkout-session/`, `FiscalAgent*` components,
> `frontend/src/lib/{billing,policy}.js`, `docs/explanation/charity_directory_contract.md`.

### PM decisions (A1–A8) — recommended calls; override before implementing

- **A1. Pricing = exactly 2 SKUs.** **Decision:** Lock **basic** (app + directory *viewing*) +
  **premium** ("Fiscal Agents Plan", listing *ownership*); `directory_access`/`fiscal_agent`
  are not tiers. **Why:** simpler pricing/billing/support; leftovers only cause bugs (→ B1).
- **A2. Two journeys; no third path.** **Decision:** ship only seeker (subscribe-to-view) and
  charity (pay-first-to-list). **Why:** they map 1:1 to the two SKUs; more entry points multiply edge cases.
- **A3. Platform is sole verifier; strict gate.** **Decision:** super_admin verifies; charities
  edit drafts + request publish; public only when `published AND verified`. **Why:** trust is the
  whole value of a money-handling directory; self-publish would gut it.
- **A4. Hide zero-state metrics.** **Decision:** don't show rating/reviews/sponsored until real
  (show "New"); verified badge = platform-verified only. **Why:** "0★ · 0 reviews" signals a dead marketplace. *(active → §2)*
- **A5. Premium lapse → auto-unlist + read-only; retain data.** **Decision:** hide listing + make
  dashboard/inbox read-only on lapse; re-subscribe re-publishes; nothing deleted. **Why:** visibility
  is the paid benefit, but don't destroy win-back. *(active → §2)*
- **A6. Notify charity on new inquiries (v1).** **Decision:** email the charity on each new inquiry +
  in-app "submitted" to the seeker; defer seeker accept/decline pings to v2. **Why:** a charity not
  knowing it got an inquiry = broken loop; cheap now that email works. *(active → §2)*
- **A7. One consistent plan label.** **Decision:** charities buy/are receipted as "Fiscal Agents Plan";
  delete the dead "Directory Access Plan" label. **Why:** receipts must match what was bought. *(active → §2/B1)*
- **A8. Trim `/fiscal-agents` copy.** **Decision:** align marketing to the 2-SKU + verification reality;
  no unbuilt claims (e.g. seeker status pings). **Why:** overpromising on a trust product erodes credibility. *(active → §2)*

### Functionality audit (B1–B9) — verify; not all known-broken

- **B1. Stale-tier cleanup (confirmed-open).** `stripe-webhook/index.ts:96` `directory_access` in
  PLAN_NAMES; `_shared/stripe.ts:206` `KNOWN_TIERS` includes `directory_access`; `billing.js:15`
  `MEMBERSHIP_TIERS.FISCAL_AGENT`; `STRIPE_PRICE_DIRECTORY` dead config (checkout fn deleted). Decide
  remove vs back-compat; ensure nothing can still mint a `directory_access` sub. *(active → §2)*
- **B2. RLS audit (security-critical).** Teaser view exposes only safe cols + only published+verified;
  full SELECT = owner/basic/super-admin; INSERT/UPDATE = premium + owner + tenant in WITH CHECK;
  `enforce_listing_moderation_guard` blocks owner self-verify/publish; `sponsorship_inquiries` INSERT =
  basic + listing published+verified, SELECT/UPDATE = listing owner only. Confirm
  `charity-directory-rls.test.sh` green. *(active → §2)*
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

### Suggested order
§2 first (A4–A6 build, B1 cleanup, B2 RLS), then the rest of the B audit (B3–B9, mostly verifiable
in-repo), then re-confirm the A decisions still hold.
