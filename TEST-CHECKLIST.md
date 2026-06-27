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

## ⏸️ WHERE WE LEFT OFF (2026-06-27 - EOD)

**Pricing Unification & Frontend:** Unified `directory_access` SKU into the `basic` tier.
- Cleaned up obsolete RLS policies and Edge Functions.
- Refactored all `has_directory_access()` references to `has_basic_membership()`.
- RLS tests refactored and 100% passing.
- Fiscal Agent Directory marketing UI (`/fiscal-agents`) revamped with premium design (glassmorphism/animations) and linked correctly to the main CTA.

**Backend Robustness:** 
- Stripe Webhook Idempotency (Agent 2 test) is fully verified (duplicate events are dropped gracefully via `billing_webhook_events`).
- Local DB reset successful.

**🔴 Remaining BLOCKERS / next actions for next session:**
1. **Agent 3 (Email Resilience Tests):** Test failure-isolation and disabled-without-creds cases for the Edge Function.
2. **Verify `send.atkasolutions.org` in Resend** (GoDaddy DNS). Needs GoDaddy access to unblock prod email.
3. **Set up new prod** (new Supabase + Vercel + live Stripe + webhook) and cut over current project to staging.
4. **Human smoke test** (End-to-End purchase flow).

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
- [x] 🟢 **Server-side enforcement (not just UI)** — ✅ grant data (unsubscribed `POST` → 403/42501); ✅ directory RLS fully live-tested (63 tests passing).
- [x] 🟢 **Local seed bypass is local-only** — ✅ (Agent 1: `db push` never runs seeds).

## Cross-cutting

- [x] 🟢 **Webhook idempotency** — replaying the same Stripe event is deduped via `billing_webhook_events` (no double email, no double membership write).
- [x] 🟢 Link Fiscal agent page to buttons from the existing platform. Use professional web design principles
- [ ] 🟠 **Human smoke test** — one full real test-mode purchase end-to-end: checkout → receipt email → paywall lifts.
