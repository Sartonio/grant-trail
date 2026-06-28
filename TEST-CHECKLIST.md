# GrantTrail — Temporary Test Checklist

> **Temporary working doc.** Tracks what still has to happen before the prod
> cutover. The core paid flows (paywall, tier mapping, lapse/reactivate, webhook
> idempotency, payment-confirmation email + failure isolation) are verified and
> have been removed from this list. Delete this doc once the items below are done.
>
> **Source of truth** for expected behavior:
> - `docs/tutorials/Grantee-Walkthrough.md`
> - `docs/tutorials/Admin-Walkthrough.md`
> - `docs/tutorials/Super-Admin-Walkthrough.md`
> - `docs/tutorials/payment-and-deployment-guide.md` (payment + email flow)
> - `docs/explanation/pricing_and_subscription_design.md` (payment models & directory access)
> - `docs/PROD-EMAIL-RUNBOOK.md` (step-by-step for everything below)

**Legend:** 🟢 agent does it end-to-end · 🟠 needs a human action · 🔴 needs a human decision

---

## Remaining before prod cutover

All open items are human-only (accounts / DNS / a real purchase); see the runbook
section noted on each.

- [ ] 🟠 **Set prod email secrets** — `RESEND_API_KEY` (secret) + `EMAIL_FROM` (variable)
  in the GitHub `production` environment; `deploy.yml` forwards them to Supabase.
  `EMAIL_FROM` must be an address on the Resend-verified domain. → runbook §1.
- [ ] 🟠 **Verify `send.atkasolutions.org` in Resend** (GoDaddy DNS: MX, SPF, DKIM,
  DMARC). Needs GoDaddy access; unblocks delivery to real customers. → runbook §3 / `EMAIL-DNS-SETUP.md`.
- [ ] 🔴 **Stand up new prod** — new Supabase + Vercel + live Stripe products/prices +
  live webhook, and demote the current project to `staging`. → runbook §5.
- [ ] 🟠 **End-to-end human smoke test** — one full real test-mode purchase on the
  deployed URL: checkout → receipt email lands → paywall lifts. → runbook §4.
