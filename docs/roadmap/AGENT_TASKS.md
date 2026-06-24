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
- [ ]  👥 Paywall for charities

---

## 🟢 Autonomous Tasks (Agents)

**Testing & Quality**

- [ ]  🤖 Gap analysis vs. the WS2 role matrix; list uncovered flows *(AI Active)*

---

## 🟠 External Setup (Human)

- [ ]  🟠 Buy paid tiers: Supabase Pro (PITR/daily backups), Vercel, GitHub Pro **or** make repo public (branch protection)
- [ ]  🟠 Create the production line: separate prod GitHub repo + its own Supabase project, wired via the Supabase GitHub integration
- [ ]  🟠 Human smoke test: click through one full purchase in real test-mode, confirm receipt/UX
- [ ]  🟠 Secrets: none in repo/CI logs; restricted Stripe keys; service-role key never reaches client (cf. `grant_service_role_insert_system_logs` migration)
- [ ]  🟠 Verify PITR is on; document restore runbook; do one **test restore** to a scratch project (#17 — #1 risk)
- [ ]  🟠 Branch protection: require CI + Supabase status check before merge to `main` (#8)
- [ ]  🟠 **Upgrade Supabase & test 1,000+ users** — scale validation; k6 script in `tests/load/k6-load-test.js` (needs paid tier)

---

## 🔴 Decisions & Design (Human + Agent Sync)

- [ ]  🔴 Human confirms the matrix matches intent; reconcile any surprises (a role doing something it shouldn't, or vice versa)
- [ ]  🔴 Edge cases (confirm expected behavior): waiver/exemption × live subscription, lapse→reactivate, webhook idempotency
- [ ]  🔴 **Pay-First Fiscal-Agent Flow** — DECIDED: fully pay-first (anonymous checkout). Needs a dedicated design pass first. Shape:
    1. Org runs Stripe checkout with **no account existing** (Fiscal Agent subscription)
    2. On successful payment → email an **admin-signup link**; account creation **reconciles** the Stripe customer/subscription to the new admin user
    3. Handle the **paid-but-unprovisioned** state (subscription exists, no user yet) safely in RLS
    4. Provisioned admin then issues invite links to their downstream agents/non-profits (existing invite system)
- [ ]  🔴 **Fiscal Agent Listing — Subscription-Based Charity Profiles** — new listing/profile entity for charities acting as fiscal agents; ties to the pay-first subscription. Needs a data-model spec (relates to the pay-first flow above).

---
