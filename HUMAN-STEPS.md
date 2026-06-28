# Human Steps Required Before Agents Can Run

## Phase 1 — Stand up prod (email OFF)

1. **Clear the prod DB** (`danufmurtwqlmbiyfdih`) — see `prod_setup.md` → "Clearing the database"
2. **Create live Stripe products + prices** — Basic and Premium ("Fiscal Agents Plan"); copy each live `price_…` id
3. **`npx vercel link`** — confirm the prod Vercel project is not the staging one
4. **Fill `.deploy/production.env`** — Supabase token + ref, `sk_live_…`, price ids, `VERCEL_TOKEN`, `APP_URL`; leave email blank
5. **`npm run deploy:secrets`** — run twice (scaffold, then push + create webhook)
6. **Run "Deploy to Production"** — confirm the GitHub Actions run is green
7. **Seed Stripe product ids** in the prod Supabase SQL editor — see `prod_setup.md` → "Seed Stripe product IDs"
8. **Sign up on the live URL** — confirm the paywall gates correctly
9. **Rotate the Supabase PAT** that was pasted in chat

## Phase 2 — Turn on email (required before launch)

10. **Verify `send.atkasolutions.org` in Resend** — add MX, SPF, DKIM, DMARC records in GoDaddy — see `EMAIL-DNS-SETUP.md`
11. **Create Resend API key** — set `RESEND_API_KEY` (secret) and `EMAIL_FROM` (variable) in GitHub `production` environment; re-run "Deploy to Production"
12. **End-to-end smoke test** — one real purchase with a live card (refund after); verify paywall lifts and receipt email arrives

## Phase 3 — Post-cutover

13. **Re-run the load test** after upgrading the prod Supabase instance: `tests/load/k6-load-test.js`

## Misc

14. **Trim `/fiscal-agents` marketing copy** to match the shipped 2-SKU + verification reality (item A8)
