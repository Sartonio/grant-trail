# GrantTrail — Agent Task List

A working task list for AI agents. Human (Ryan) provides high-level oversight: makes 🔴 decisions and does 🟠 external setup; agents do everything else and report back.

**Conventions**
- 🔴 **Decision** — STOP and ask the human; do not guess.
- 🟠 **External** — needs a human action outside the repo (purchase, dashboard, DNS, key). Surface it, then continue on what isn't blocked.
- 🟢 **Autonomous** — do it end-to-end, then request review.
- Check a box only when the work is merged-ready (code + tests + verification), not when drafted.
- Companion doc with rationale, concepts, and time estimates: `grant-trail-production-breakdown.md` (kept in Ryan's home dir).

---

## Phase 0 — Unblock (do first; mostly human)

- [ ] 🟠 Buy paid tiers: Supabase Pro (PITR/daily backups), Vercel, GitHub Pro **or** make repo public (branch protection)
- [ ] 🟠 Stripe test-mode: test keys + products/prices for basic & premium tiers + `stripe listen` webhook forwarding
- [ ] 🟠 Create the production line: separate prod GitHub repo + its own Supabase project, wired via the Supabase GitHub integration

---

## Phase 1 — Foundation (clean guards + clear roles before testing/features)

### WS3 — Subscription-vs-authz refactor (#41) 🟢 *do before WS4*
- [ ] Design guard API: role axis vs. billing axis, with **distinct** redirects (wrong-role → `/login` or `/`; unpaid → billing nudge)
- [ ] Implement `<RequireRole>` / `<RequireSubscription>` (or single `<Guard>`) wrappers
- [ ] Migrate every route in `frontend/src/App.js` to the new guards
- [ ] Centralize subscription policy (today split across `App.js` and `frontend/src/lib/billing.js:hasRequiredSubscription`)
- [ ] Tests: snapshot the redirect matrix before/after to prove no behavior change

### WS2 — Role distinctions
- [ ] 🟢 Produce role/permission matrix: every route + every RLS-protected table × {`super_admin`, `admin`, `grantee`}. Derive from code.
- [ ] 🔴 Human confirms the matrix matches intent; reconcile any surprises (a role doing something it shouldn't, or vice versa)
- [ ] 🟢 Document that billing-exemption (`isExempt`/waiver) is **orthogonal** to role (feeds WS3/WS4)

### WS4 — Billing-lapse lockout policy (#40)
- [ ] 🔴 Human decides: (a) full lockout / status-quo, (b) read-only degrade, (c) carve-out keeping audit log + export reachable
- [ ] 🟢 Implement chosen policy (trivial on top of WS3 guards). Skip if (a).

---

## Phase 2 — Safety net (parallelizable; one agent per role/area)

### WS5 — Full payment testing
Stripe edge functions: `create-checkout-session`, `create-basic-membership-checkout-session`, `create-billing-portal-session`, `sync-my-subscription`, `stripe-webhook`. Existing E2E: `frontend/tests/e2e/subscription.spec.js`.
- [ ] 🟢 Webhook test matrix: checkout completed, subscription created/updated/canceled, past_due, payment_failed → assert DB `subscriptions` / `user_memberships` end state
- [ ] 🟢 Checkout flows: both tiers, both checkout functions, success + cancel paths
- [ ] 🟢 Billing portal + `sync-my-subscription`: upgrade/downgrade/cancel reflected back into app state
- [ ] 🔴 Edge cases (confirm expected behavior): waiver/exemption × live subscription, lapse→reactivate, webhook idempotency
- [ ] 🟠 Human smoke test: click through one full purchase in real test-mode, confirm receipt/UX
- [ ] Note: Stripe is source of truth; DB is a webhook-synced projection — idempotency is critical. Use `stripe:test-cards` skill.

### WS6 — Comprehensive UI flow testing (extend Playwright)
Existing specs: onboarding, invite-onboarding, admin-review, reporting, notifications-audit, subscription, workspace, smoke.
- [ ] 🟢 Gap analysis vs. the WS2 role matrix; list uncovered flows
- [ ] 🟢 Grantee flows: create grant, budget items, expenses, attachments/receipts, status history, CSV export
- [ ] 🟢 Admin flows: review/approve/request-changes, user mgmt, invites, settings, audit log, exports
- [ ] 🟢 Super-admin flows: tenant enable/disable, platform defaults, cross-tenant isolation
- [ ] 🟢 Negative/authz flows: each role hitting routes it shouldn't; tenant-isolation assertions
- [ ] 🟢 Flake hardening; keep E2E job runtime sane

### WS7 — Security step-by-step
Real boundary is Postgres RLS, **not** UI guards. Prove it.
- [ ] 🟢 RLS audit: per table, enumerate policies; write **adversarial tests** proving tenant A can't read/write tenant B and a grantee can't escalate
- [ ] 🟢 Edge-function authz: each function verifies caller JWT/role; webhook verifies Stripe signature; no function trusts client-supplied identity
- [ ] 🟠 Secrets: none in repo/CI logs; restricted Stripe keys; service-role key never reaches client (cf. `grant_service_role_insert_system_logs` migration)
- [ ] 🟢 Storage: receipt/attachment buckets enforce tenant scoping on read URLs
- [ ] 🟢 Run `/security-review` on the branch; triage findings
- [ ] 🔴 Data-protection policy: PII inventory, retention, export/delete posture (overlaps WS8 "Security & Data Protection")

---

## Phase 3 — Deploy line (#39 #29 #27 #8)

Model already decided (Option A: Supabase GitHub integration owns migrations + edge functions; merge to `main` = deploy to staging). Remaining hardening:
- [ ] 🟠 Verify PITR is on; document restore runbook; do one **test restore** to a scratch project (#17 — #1 risk)
- [ ] 🟢 Finish edge-function pruning (`npm run functions:prune`); wire into deploy so removed functions get deleted (#29)
- [ ] 🟠 Branch protection: require CI + Supabase status check before merge to `main` (#8)
- [ ] 🟢 CI migration safety w/o prod access: base-branch migrations on a fresh DB, then PR migrations on top; synthetic fixtures only, never a prod dump (#39; partly done via migration-replay job)
- [ ] 🟢 Wire edge-function `.sh` tests into CI (only `system-logs-failure.test.sh` runs today); broaden + gate (#39)
- [ ] 🔴 `config.toml` tenant-agnosticism: remove hard-coded `'tfac'` slug from SECURITY DEFINER logic; make flag/config-driven (#29) — needs naming/config-shape decision
- [ ] 🟢 Define + document the staging→prod promotion flow; prod auth/secrets/domain bootstrap (#39)

---

## Phase 4 — Feature roadmap (each needs its own mini-spec first)

Depends on Phases 1/2/3 being solid (don't paywall on a shaky billing path).
- [ ] 🟠 **Payment Confirmation & Receipt Emails** — transactional email on successful payment (needs email provider)
- [ ] 🔴 **Paywall for Registered Charities List** — gate a data view behind subscription (decide which tier)
- [ ] 🔴 **Security & Data Protection** — hardening + policy surface (overlaps WS7 data-protection)
- [ ] 🔴 **Fiscal Agent Listing — Subscription-Based Charity Profiles** — new listing/profile entity + subscription tie-in (decide data model)
- [ ] 🔴 **Pay-Before-Signup Flow** — invert current model (pay → then create account). Touches Stripe checkout w/ no user yet → reconcile on account creation, auth flow, and RLS (paid-but-unprovisioned state). Dedicated design pass required.
- [ ] 🟠 **Upgrade Supabase & test 1,000+ users** — scale validation; k6 script in `tests/load/k6-load-test.js` (needs paid tier)

---

## Decisions owed by the human (blocking queue)
1. 🔴 #40 — lapsed-admin policy: full lockout vs. read-only vs. carve-out
2. 🔴 #29 — `config.toml` tenant-agnosticism: how the platform-root tenant is named/flagged
3. 🔴 Phase 4 — charities-paywall tier; fiscal-agent data model; pay-before-signup UX; data-protection/retention policy
