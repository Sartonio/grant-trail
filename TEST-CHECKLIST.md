# GrantTrail — Temporary Test Checklist

> **Temporary working doc.** Tracks manual + automated verification of the core
> paid flows ahead of the prod cutover. Delete once these are folded into the
> permanent test suite / CI.
>
> **Source of truth** for expected behavior:
> - `docs/tutorials/Grantee-Walkthrough.md`
> - `docs/tutorials/Admin-Walkthrough.md`
> - `docs/tutorials/Super-Admin-Walkthrough.md`
> - `docs/tutorials/payment-and-deployment-guide.md` (payment + email flow)
> - `docs/explanation/pricing_and_subscription_design.md` (payment models & directory access)

**Legend:** 🟢 agent does it end-to-end · 🟠 needs a human action · 🔴 needs a human decision

---

## ⏸️ WHERE WE LEFT OFF (2026-06-27)

**Email:** Switched from secureserver SMTP → **Resend over SMTP** (secureserver had no
SPF/DKIM/MX, Gmail dropped everything). Local checkout → receipt verified end-to-end via
Resend (`sub_1Tn1ye…`, "Fiscal Agents Plan", $100 CAD landed in Gmail). Docs/templates
updated on branch `docs/email-resend-smtp` (pushed). Local `supabase/.env` uses Resend with
`onboarding@resend.dev` (only delivers to the Resend account owner).

**Deploy audit done.** Fixed `deploy.yml` to deploy the 2 charity-directory functions.
Removed stale `RESEND_*` from staging GitHub env. Still ❌: `SMTP_*` unset in **both**
envs; `STRIPE_PRICE_DIRECTORY` unset in both (no such Stripe price exists yet — it's a real
separate seeker SKU, not the same as Pro/fiscal-agent).

**🔴 BLOCKERS / next actions:**
1. **Verify `send.atkasolutions.org` in Resend** (GoDaddy DNS — see `EMAIL-DNS-SETUP.md`).
   No GoDaddy access yet. Prod email blocked until then. Then set prod/staging `SMTP_FROM`.
2. **Entitlement clobber bug (likely launch-blocker for directory SKU):** `user_memberships`
   is one-row-per-user, upserted last-event-wins, and all access RPCs read that single row.
   So a user can't hold two SKUs at once (basic + directory_access), AND cancelling one of a
   user's multiple subs revokes everything. Fix: rekey `user_memberships` on
   `(user_id, membership_tier)`. Decision needed: is "one user, two SKUs" supported?
3. **Local DB is behind repo** — `20260624120000_charity_directory` migration NOT applied to
   the running stack. Run `supabase db reset` before testing the directory paywall / Agent 3.
   (Also: user 11's premium sub was cancelled during the lapse test; reset moots it.)
4. **Create the Directory Access price** in Stripe (test for staging, live for prod) → set
   `STRIPE_PRICE_DIRECTORY` in each env.
5. **Set up new prod** (new Supabase + Vercel + live Stripe + webhook) and make current
   project proper staging — overview captured in chat; not started.

**Agents:** Agent 1 (paywall, below) = DONE. Agent 2 (idempotency) + Agent 3 (email
failure-isolation / disabled-without-creds) = NOT YET RUN — both need `db reset` first;
Agent 3 mutates SMTP env + restarts functions, so run it last and restore Resend config.

---

## Payment Confirmation Email (Resend)

- [x] 🟢 **Email sends on successful checkout** — ✅ LOCAL via Resend (`evt_1Tn1yg…` → receipt in Gmail). Prod still blocked on domain verify.
- [x] 🟢 **Receipt contents correct** — ✅ plan/amount/currency/date/renewal/sub-id all matched `sub_1Tn1ye…`.
- [x] 🟢 **Recipient + first name resolve** — ✅ went to `customer_details.email`; "Hi Ry" from `billing_customers → users.firstname`.
- [ ] 🟢 **Failure isolation** — with email forced to fail, the webhook still returns 200, the subscription is still written, and a `payment_confirmation_email_failure` row lands in `system_logs` (Stripe does not retry).
- [ ] 🟢 **Disabled-without-creds** — with `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` unset, checkout succeeds and the send is skipped (warning logged, no error).
- [ ] 🟠 **`SMTP_FROM` matches the authenticated mailbox** — most SMTP relays (incl. cPanel/secureserver) reject a `From` that isn't the logged-in account. Leave blank to default to `GrantTrail <SMTP_USER>`, or set it to an address the mailbox is allowed to send as.
- [ ] 🟠 **TLS/port match** — `SMTP_PORT=465` uses implicit TLS; `587` negotiates STARTTLS. Confirm the port and the relay agree, or the connection will hang/fail.
- [ ] 🟠 **Prod secrets present** — `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` (secrets) + `SMTP_PORT`/`SMTP_FROM` (variables) set in the GitHub `production` environment and forwarded by `deploy.yml` to Supabase.

## Paywall

- [x] 🟢 **Unsubscribed user is gated** — ✅ (Agent 1: `policy.js`/`guards.js`; live RPCs false for throwaway user).
- [x] 🟢 **Subscribed user has access** — ✅ (Agent 1: maria basic → `has_basic_membership` true).
- [x] 🟢 **Tier mapping correct** — ✅ (Agent 1: matches walkthroughs; basic/premium confirmed live).
- [x] 🟢 **Lapse re-gates** — ✅ (Agent 1: real `subscription.deleted` flipped `is_active`) — ⚠️ exposed multi-sub clobber bug (see "where we left off" #2).
- [~] 🟢 **Server-side enforcement (not just UI)** — ✅ grant data (unsubscribed `POST` → 403/42501); ⚠️ directory RLS **code-verified only** — local DB behind, needs `db reset` to test live.
- [x] 🟢 **Local seed bypass is local-only** — ✅ (Agent 1: `db push` never runs seeds).

## Cross-cutting

- [ ] 🟢 **Webhook idempotency** — replaying the same Stripe event is deduped via `billing_webhook_events` (no double email, no double membership write).
- [ ] 🟢 Link Fiscal agent page to buttons from the existing platform. Use professional web design principles
- [ ] 🟠 **Human smoke test** — one full real test-mode purchase end-to-end: checkout → receipt email → paywall lifts.
