# Charity Directory / Fiscal-Agent — Post-Implementation Review Checklist

> **Temporary review doc.** Things to verify across the charity directory / fiscal-agent
> feature now that it's built. Grounded in the actual code: migration
> `supabase/migrations/20260624120000_charity_directory.sql`, `supabase/functions/_shared/stripe.ts`,
> `supabase/functions/create-fiscal-agent-checkout-session/`, the `FiscalAgent*`
> components, `frontend/src/lib/{billing,policy}.js`, and
> `docs/explanation/charity_directory_contract.md`. Delete once worked through.
>
> **Biggest risk:** a 3-iteration pricing churn — separate `directory_access` + `fiscal_agent`
> → fold `fiscal_agent` into `premium` → fold `directory_access` into `basic`. It has
> already left stale references (see B1). Start with **A1 + B1** (entangled).

---

## A. Product-manager perspective — decisions

> Recommended PM calls below (decision + short why). They're my stance, not gospel —
> override any before implementation. Checkboxes = "implement/verify this decision."

- [ ] **A1. Pricing = exactly 2 SKUs.**
  **Decision:** Lock the 2-SKU model — **basic** (app + directory *viewing*) and **premium**
  = "Fiscal Agents Plan" (listing *ownership*). `directory_access` / `fiscal_agent` are not
  tiers; purge the stragglers (see B1).
  **Why:** fewer SKUs = simpler pricing page, billing, and support; the model already
  converged here and leftover tiers only cause bugs and mislabeled receipts.
- [ ] **A2. Keep the two journeys; no third path.**
  **Decision:** Ship exactly two funnels — seeker (subscribe-to-view) and charity
  (pay-first-to-list). No alternate entry paths for v1.
  **Why:** they map 1:1 to the two SKUs and the two-sided marketplace; more entry points now
  dilute focus and multiply edge cases.
- [ ] **A3. Platform is the sole verifier; strict visibility gate.**
  **Decision:** super_admin verifies. Charities create/edit drafts and request publish, but a
  listing is public only when `published AND verified`. No self-publish.
  **Why:** a directory of fiscal agents handling other people's money lives or dies on trust;
  platform gatekeeping is the core value and the scam guard. Self-publish would gut it.
- [ ] **A4. Hide zero-state metrics; verified badge means platform-verified.**
  **Decision:** Don't show `rating/reviews/sponsored` until they have real data — show a
  "New" / "Recently listed" treatment instead. The "verified" badge = platform-verified only.
  **Why:** "0★ · 0 reviews" broadcasts a dead/low-quality marketplace during cold start;
  honest "new" framing plus a badge that actually means something build trust.
- [ ] **A5. Premium lapse → auto-unlist + read-only; retain data.**
  **Decision:** On premium lapse, the listing is hidden from seekers and the owner
  dashboard/inbox goes read-only; nothing is deleted. Re-subscribing re-publishes. Seeker
  basic lapse re-gates the directory (already the case).
  **Why:** visibility is the paid benefit, so it must stop on non-payment — but destroying
  data punishes churned-then-returning charities and kills win-back.
- [ ] **A6. Notify the charity on new inquiries (v1); defer seeker status pings.**
  **Decision:** v1 emails the charity on each **new** inquiry (reuse the Resend infra) and
  shows the seeker an in-app "submitted" confirmation. Defer seeker-facing accept/decline
  notifications to v2.
  **Why:** a charity that never learns it got an inquiry = broken marketplace; notifying them
  is the minimum viable loop and cheap now that email works. Seeker status updates are polish.
- [ ] **A7. One consistent plan label on money.**
  **Decision:** Charities buy and are receipted as **"Fiscal Agents Plan"** (premium); delete
  the dead "Directory Access Plan" receipt label (`stripe-webhook` `PLAN_NAMES`).
  **Why:** receipts must match what was bought — a stale/mismatched label is a trust hit and a
  support/refund magnet.
- [ ] **A8. Trim `/fiscal-agents` copy to the shipped reality.**
  **Decision:** Align the marketing page to the 2-SKU model and the real verification/
  visibility rules; remove any claim not yet built (e.g., don't promise seeker status
  notifications while A6 defers them).
  **Why:** overpromising on a trust product erodes credibility and invites complaints.

---

## B. Functionality / engineering perspective

- [ ] **B1. Stale-tier cleanup (concrete leftovers found):**
  - `supabase/functions/stripe-webhook/index.ts:96` — `directory_access: 'Directory Access Plan'` in `PLAN_NAMES`.
  - `supabase/functions/_shared/stripe.ts:206` — `KNOWN_TIERS` still includes `'directory_access'`.
  - `frontend/src/lib/billing.js:15` — `MEMBERSHIP_TIERS.FISCAL_AGENT='fiscal_agent'`.
  - `STRIPE_PRICE_DIRECTORY` still in `.env.example` / deploy templates, but
    `create-directory-access-checkout-session` was **deleted** → likely dead config + dead
    path. Decide keep-for-back-compat vs remove; ensure nothing can still mint a
    `directory_access` subscription.
- [ ] **B2. RLS (security-critical) — re-audit `20260624120000`:** public teaser view exposes
  only safe columns (no email/phone/website/about) and only `published+verified`; full-row
  SELECT = owner OR basic OR super-admin; INSERT/UPDATE = premium + owner + `tenant_id` in
  `WITH CHECK`; `enforce_listing_moderation_guard` must stop an owner self-setting
  `verification='verified'` or publishing around moderation; `sponsorship_inquiries` INSERT =
  basic + listing published+verified, SELECT/UPDATE = listing owner only. Confirm
  `supabase/tests/charity-directory-rls.test.sh` passes against the current schema.
- [ ] **B3. Pay-first provisioning robustness** (`provisionFiscalAgentFromCheckout` + webhook):
  duplicate-event idempotency, partial-failure behavior (re-raise so Stripe retries vs email
  isolated), **existing account with the same billing email**, invite-token issuance, and
  `FiscalAgentCheckoutReturn.js` reading provisioning status.
- [ ] **B4. Tier mapping** in `upsertSubscriptionFromStripe`: onboarding sub lands as `premium`
  so `canOwnListing` is true; `membership_tier` CHECK constraints accept exactly the tiers
  used; product-match trigger doesn't trip on them.
- [ ] **B5. Session/policy wiring:** `get_session_context` returns the keys `policy.js` reads
  (`canViewDirectory` / `canOwnListing`) — no leftover reads of `hasDirectoryAccess` /
  `hasFiscalAgentAccess` returning `undefined`. `policy.test.js` covers the folded model.
- [ ] **B6. Frontend gating is server-enforced, not UI-only:** teaser-vs-full fetch in
  `FiscalAgentDirectory.js`; `useWriteGuard` on `FiscalAgentListingEditor` / inbox for lapse.
- [ ] **B7. Routes/auth** (`App.js`): `/fiscal-agents/list`, `/checkout/return`, `/me`,
  `/listing/edit`, `/onboard` correctly gated; public `/fiscal-agents` + `/:id` with
  in-component paywall.
- [ ] **B8. Data integrity:** `set_inquiry_tenant_id` trigger sets `tenant_id` from the listing;
  FK + status/verification CHECKs; `updated_at` upkeep.
- [ ] **B9. Tests/seed/CI:** `charity-directory-rls.test.sh` wired into CI; `seed.sql` has the
  contract's test rows (published+verified, draft, unverified, inquiries); seed stays
  local-only.

---

## Suggested order
Start with **A1 + B1** (pricing coherence + stale-tier cleanup — entangled and concrete),
then **B2** (RLS security), then the rest of B (mostly verifiable in-repo), then the
product-intent calls in A (A5/A6 need decisions).
