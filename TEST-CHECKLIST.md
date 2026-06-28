# GrantTrail — Active Task Checklist

> **Single tracker** for what's still open before/around launch. Detailed
> specs/decisions live in the linked docs — this is the condensed list.
>
> **Detail docs:** prod deploy → `docs/how_to/prod_setup.md` · email DNS →
> `EMAIL-DNS-SETUP.md` · charity directory review + PM decisions →
> `docs/charity-review-checklist.md`.
>
> **Legend:** 🟢 agent end-to-end · 🟠 human action · 🔴 human decision

---

## 1. Prod cutover

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

## 2. Charity directory follow-ups

Open items from the post-build review (full reasoning + decisions:
`docs/charity-review-checklist.md`).

**Build (from PM decisions A4–A6):**
- [ ] 🟢 A4 — hide zero-state metrics (rating/reviews/sponsored); show a "New" treatment instead
- [ ] 🟢 A5 — premium lapse → auto-unlist the listing + read-only dashboard/inbox (retain data; re-subscribe re-publishes)
- [ ] 🟢 A6 — email the charity on each new inquiry (reuse Resend) + in-app "submitted" confirmation to the seeker

**Clean up / verify:**
- [ ] 🟢 B1 — purge stale tiers: `directory_access` in `stripe-webhook` PLAN_NAMES + `stripe.ts` KNOWN_TIERS; `MEMBERSHIP_TIERS.FISCAL_AGENT`; dead `STRIPE_PRICE_DIRECTORY` config; fix the receipt label to "Fiscal Agents Plan" (A7)
- [ ] 🟢 B2 — re-audit charity RLS; confirm `supabase/tests/charity-directory-rls.test.sh` is green
- [ ] 🟠 A8 — trim `/fiscal-agents` marketing copy to the shipped 2-SKU + verification reality
