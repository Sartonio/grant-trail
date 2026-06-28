# GrantTrail — Agent Task List

A working task list for AI agents. Human (Ryan) provides high-level oversight: makes 🔴 decisions and does 🟠 external setup; agents do everything else and report back.

**Conventions**

- 🔴 **Decision** — STOP and ask the human; do not guess.
- 🟠 **External** — needs a human action outside the repo (purchase, dashboard, DNS, key). Surface it, then continue on what isn't blocked.
- 🟢 **Autonomous** — do it end-to-end, then request review.
- 🤖 **AI Active** — currently being worked on by the AI agent.
- 👥 **Team Member** — currently being worked on by a human team member.
- Check a box only when the work is merged-ready (code + tests + verification), not when drafted.

**Source of Truth for Testing**
All testing should validate the core flows documented in the walkthroughs:

- `docs/tutorials/Grantee-Walkthrough.md`
- `docs/tutorials/Admin-Walkthrough.md`
- `docs/tutorials/Super-Admin-Walkthrough.md`

---

## 👥 Team Member Tasks (In Progress)

- [ ]  👥 Email confirmation for payment
- [x]  👥 Paywall for charities — implemented (see Charity / Fiscal Agent Directory below)

---

## 🏛️ Charity / Fiscal Agent Directory (built — continuing)

**Status: built, RLS-verified, NOT yet wired into the main site nav.** Spec: `docs/explanation/charity_directory_ux.md`; binding contract: `docs/explanation/charity_directory_contract.md`. Migration `supabase/migrations/20260624120000_charity_directory.sql`; components `frontend/src/components/FiscalAgent*`; routes in `App.js` (`/fiscal-agents`, `/fiscal-agents/:id`, `/fiscal-agents/list`, `/fiscal-agents/checkout/return`, `/fiscal-agents/me`, `/fiscal-agents/listing/edit`). RLS proof suite: `bash supabase/tests/charity-directory-rls.test.sh` (69 assertions).

**Pricing model — DECIDED (2 SKUs, fold-into-premium):**
- `directory_access` — NEW seeker SKU; gates viewing the full directory + sending inquiries. Env: `STRIPE_PRICE_DIRECTORY`. Edge fn: `create-directory-access-checkout-session`.
- A charity operates as a fiscal agent (publishes/maintains a listing, triages inquiries) under the EXISTING **premium** "Fiscal Agents Plan" (`STRIPE_PRICE_PRO`) — there is no separate `fiscal_agent` SKU. Listing ownership gates on `has_premium_membership()` / `canOwnListing` = premium. The pay-first charity onboarding (`create-fiscal-agent-checkout-session`) charges the premium price and stamps `provision_flow='fiscal_agent_onboarding'` so the webhook provisions tenant + draft listing + invite (signup link).
- Security: owners cannot self-verify (moderation columns are super_admin-only via `enforce_listing_moderation_guard`); admins cannot self-grant `directory_access` (via `enforce_directory_tier_grant_source`). Both have regression assertions.

**Next steps (continuation):**
- [ ]  🟠 Set `STRIPE_PRICE_DIRECTORY` (live + `STRIPE_PRICE_DIRECTORY_TEST` for CI) in the GitHub environments; create the Directory Access price in Stripe. Charity onboarding reuses the existing `STRIPE_PRICE_PRO`.
- [ ]  🤖 **Test charity org page pricing + features** — drive a real test-mode checkout for BOTH flows: (a) seeker Directory Access unlock, (b) pay-first "List your charity" → premium subscription → signup-link invite → onboard → publish (stays "Pending verification" until a super_admin verifies). Confirm graceful failure when `STRIPE_PRICE_DIRECTORY` is unset. Add Playwright e2e under `frontend/tests/e2e/` (none cover `/fiscal-agents` yet).
- [ ]  🤖 **Link the main website to the charity org pages** — the directory is reachable only by direct URL today. Add entry points: a header/landing CTA to `/fiscal-agents` ("Find a Fiscal Agent" for seekers), the "List your charity" acquisition CTA, and an in-app "My Listing" link for premium owners (gated on `canOwnListing`). See UX spec §1.2 (entry points).

---

## 🟢 Autonomous Tasks (Agents)

**Testing & Quality**

- [ ]  🤖 Gap analysis vs. the WS2 role matrix; list uncovered flows *(AI Active)*
- [x]  🟢 **Email send test** — done. `email-resilience.test.sh` proves failure-isolation (Resend unreachable → webhook still 200, sub synced, one `payment_confirmation_email_failure` row, no worker crash) and the disabled-without-creds no-op path. Email sends via the Resend HTTP API.

---

## 🟠 External Setup (Human)

- [ ]  🟠 Buy paid tiers: Supabase Pro (PITR/daily backups), Vercel, GitHub Pro **or** make repo public (branch protection)
- [ ]  🟠 Create the production line: separate prod GitHub repo + its own Supabase project, wired via the Supabase GitHub integration
- [ ]  🟠 Human smoke test: click through one full purchase in real test-mode, confirm receipt/UX
- [ ]  🟠 Secrets: none in repo/CI logs; restricted Stripe keys; service-role key never reaches client (cf. `grant_service_role_insert_system_logs` migration)
- [ ]  🟠 Verify PITR is on; document restore runbook; do one **test restore** to a scratch project (#17 — #1 risk)
- [ ]  🟠 Branch protection: require CI + Supabase status check before merge to `main` (#8)
- [ ]  🟠 **Upgrade Supabase & test 1,000+ users** — scale validation; k6 script in `tests/load/k6-load-test.js` (needs paid tier)
- [ ]  🟠 **Finalize email keys** — verify the Resend sending domain (`EMAIL-DNS-SETUP.md`), then set `RESEND_API_KEY` (secret) + `EMAIL_FROM` (variable) in the GitHub `production` environment (`npm run deploy:secrets`, forwarded to Supabase by `deploy.yml`). Email is deploy-optional, so prod can stand up first; see `docs/how_to/prod_setup.md` → "Turning on email".

**Prod/staging cutover (Ryan)** — sequential:

- [ ]  🟠 Migrate to the correct Supabase project and set it as the **real prod** — move schema/data to the intended prod project, repoint `SUPABASE_PROJECT_REF` + Vite vars, redeploy.
- [ ]  🟠 Repurpose the **current prod project as staging** — rewire it into the `staging` GitHub environment (`npm run deploy:secrets:staging`).
- [ ]  🟠 Push the **CI vars** — `npm run deploy:secrets:ci` to set the three `*_TEST` Stripe secrets in the `ci` environment.

---

## 🔴 Decisions & Design (Human + Agent Sync)

- [ ]  🔴 Human confirms the matrix matches intent; reconcile any surprises (a role doing something it shouldn't, or vice versa)
- [ ]  🔴 Edge cases (confirm expected behavior): waiver/exemption × live subscription, lapse→reactivate, webhook idempotency
- [x]  🔴 **Pay-First Fiscal-Agent Flow** — IMPLEMENTED. Anonymous checkout charges the premium "Fiscal Agents Plan" (`STRIPE_PRICE_PRO`); webhook (signature-verified, idempotent) provisions tenant + invited admin + draft listing + invite token (signup link) on `checkout.session.completed` with `provision_flow='fiscal_agent_onboarding'`. Paid-but-unprovisioned state is handled (listing `draft`/`pending`, admin `is_active=false` until the invite is claimed). See the Charity Directory section above.
- [x]  🔴 **Fiscal Agent Listing — Subscription-Based Charity Profiles** — IMPLEMENTED as `fiscal_agent_listings` + `sponsorship_inquiries` with full RLS + teaser view. Ownership ties to the premium plan (NOT a separate SKU — decided). See the Charity Directory section above for the data model + remaining wiring.

---
