# GrantTrail — Parallel Agent Launch Prompts

Five independent work lanes, each a ready-to-run `/goal` prompt. They are partitioned so their **file footprints barely overlap** — you can run all five in parallel, each opens its own PR, and merge conflicts are minimal.

Launch each by pasting `/goal <prompt>` into a fresh Claude Code session (the persistent stop-hook keeps the agent on-task until done), or ask the orchestrating agent to spawn them as background Opus 4.8 subagents (one git worktree each).

**All lanes assume the decisions in `docs/roadmap/AGENT_TASKS.md` (resolved-decisions block).** None of these require any paid tier or purchase.

## Lane ownership (who touches what)

| Lane | Owns (writes) | Must NOT touch |
|---|---|---|
| A — Guards | `frontend/src/**`, `frontend/tests/e2e/subscription.spec.js` only | `supabase/`, `.github/`, `scripts/`, other e2e specs |
| B — E2E flows | `frontend/tests/e2e/**` (NEW specs; not `subscription.spec.js`) | `frontend/src/`, `supabase/`, `.github/`, `scripts/` |
| C — DB security | `supabase/**`, `docs/roadmap/rls-audit.md` | `frontend/`, `.github/`, `scripts/` |
| D — CI/tooling | `.github/**`, `scripts/**`, `supabase/functions/tests/**` | `supabase/migrations/`, `frontend/`, app source |
| E — Role matrix | `docs/roadmap/role-matrix.md` only | all code |

> The only shared path is `frontend/tests/e2e/` (Lanes A & B): **Lane A** owns `subscription.spec.js` (it changes lapsed-admin behavior); **Lane B** adds only *new* spec files and never edits `subscription.spec.js`.

---

## Lane A — Route guards: separate authz from billing (#41) + read-only lapse (#40)

```
/goal Refactor the route guards in frontend/src/App.js so role-based authorization and subscription/billing gating become two separate, declarative concerns (GitHub issue #41), then implement the decided billing-lapse policy (#40 = read-only degrade). Step 1: extract <RequireRole> and <RequireSubscription> guard components (or a single <Guard> taking both axes) and centralize the subscription policy currently split between App.js and frontend/src/lib/billing.js (hasRequiredSubscription). Migrate EVERY route to the new guards with NO behavior change, proven by a before/after redirect-matrix test. Keep the two redirects semantically distinct: unauthenticated/wrong-role -> /login or /, authenticated-but-unpaid -> the billing nudge. Step 2: change the policy so a lapsed admin (role 'admin', not exempt/waived, no active subscription) can VIEW every admin route read-only but cannot perform any mutation (approvals, edits, invites, settings changes); blocked mutations route to the billing nudge. Add unit tests covering each role's redirect and the lapsed-admin can-read / cannot-write matrix; update frontend/tests/e2e/subscription.spec.js to match the new read-only behavior. Work ONLY within frontend/src and frontend/tests (and subscription.spec.js); do NOT touch supabase/, .github/, scripts/, or other e2e specs. Run npm run lint and npm test (in frontend) — both must pass. Work in a git worktree and open a PR titled "Guards: separate authz from billing (#41) + read-only lapse (#40)". Context: docs/roadmap/AGENT_TASKS.md, sections WS3 and WS4, plus the resolved-decisions block.
```

---

## Lane B — Comprehensive E2E UI flows across all roles (WS6)

```
/goal Extend the Playwright E2E suite in frontend/tests/e2e/ to comprehensively cover all three roles (super_admin, admin, grantee) plus negative/authz paths. Existing specs already cover: onboarding, invite-onboarding, admin-review, reporting, notifications-audit, subscription, workspace, smoke — do NOT edit subscription.spec.js (Lane A owns it); add only NEW spec files. Fill these gaps: grantee flows (create grant, budget items, expenses, attachments/receipts, status-history timeline, CSV export); admin flows (review/approve/request-changes, user management, invites, settings, audit log, exports); super-admin flows (tenant enable/disable, platform defaults, cross-tenant isolation); negative/authz flows (each role hitting routes it must not reach; assert a user in tenant A cannot see tenant B data). Reuse frontend/tests/e2e/fixtures.js for auth/seed. Keep specs deterministic (no arbitrary sleeps; use web-first assertions) and the suite runtime reasonable. Work ONLY within frontend/tests/ — do not modify frontend/src, supabase/, .github/, or scripts/. Run npm run e2e (in frontend) against the local Supabase stack; it must pass. Work in a git worktree and open a PR. Context: docs/roadmap/AGENT_TASKS.md, section WS6.
```

---

## Lane C — DB security: RLS adversarial audit (WS7.1) + tenant-agnosticism (#29)

```
/goal Two related database-layer tasks for GrantTrail; both operate on the local Supabase stack only (use the npx-pinned Supabase CLI per project memory, not the system one). TASK 1 — RLS adversarial audit (WS7.1): for every RLS-protected table in supabase/migrations, write adversarial tests proving a user in tenant A cannot read or write tenant B's rows, and that a 'grantee' cannot escalate to 'admin'/'super_admin' privileges. Write the proof tests under supabase/ (SQL/pgTAP or a test harness consistent with the repo) and a findings report at docs/roadmap/rls-audit.md. If you find a genuine isolation gap, fix it in a NEW forward migration. TASK 2 — tenant-agnosticism (#29, already DECIDED: do it now): remove the hard-coded 'tfac' platform-root tenant slug from SECURITY DEFINER logic in supabase/migrations and replace it with a config/flag-driven lookup (e.g. a platform_root_slug() function or a platform_settings row). Add a NEW forward migration — do NOT edit historical migration files. Explain the chosen config shape in the PR description. Work ONLY within supabase/ and docs/roadmap/; do not touch frontend/, .github/, or scripts/. Bring up the local DB (npm run db:start / db:reset) and run your tests; they must pass. Work in a git worktree and open a PR. Context: docs/roadmap/AGENT_TASKS.md, section WS7 and the Phase-3 tenant-agnosticism item, plus the resolved-decisions block.
```

---

## Lane D — CI/deploy tooling hardening (WS1: 1.3, 1.5, 1.6)

```
/goal Harden GrantTrail's CI/deploy tooling — no paid tiers required. THREE pieces. (1.6) Edge-function tests in CI: today only supabase/functions/tests/system-logs-failure.test.sh exists and runs; add .sh tests covering the other edge functions (create-checkout-session, create-basic-membership-checkout-session, create-billing-portal-session, sync-my-subscription, stripe-webhook) and wire them to gate in .github/workflows/ci.yml. (1.3) Edge-function pruning: finish scripts/prune_functions.js (npm run functions:prune) so functions removed from the repo get deleted on deploy, and document/wire it into the deploy flow. (1.5) CI migration-safety: the migration-replay job in .github/workflows/ci.yml already applies base-branch migrations then the PR's new migrations on a fresh DB using seed.sql as a synthetic fixture — verify it is correct and gating, and extend it if gaps exist; never use a prod dump. Work ONLY within .github/, scripts/, and supabase/functions/tests/ — do NOT modify supabase/migrations, frontend/, or application source. Validate locally where feasible (run the .sh tests against a local Supabase; lint the workflow). Work in a git worktree and open a PR. Context: docs/roadmap/AGENT_TASKS.md, Phase 3 / WS1 items 1.3, 1.5, 1.6.
```

---

## Lane E — Role/permission matrix (WS2, docs-only)

```
/goal Derive a complete role/permission matrix for GrantTrail and write it to docs/roadmap/role-matrix.md. For each of the three roles (super_admin, admin, grantee), map every frontend route (from frontend/src/App.js) and every RLS-protected table (from supabase/migrations) to that role's capability (none / read / write), citing file:line for each claim. Document the billing-exemption axis (isExempt / waiver in frontend/src/lib/billing.js) explicitly as ORTHOGONAL to role. Add a "Discrepancies to confirm" section flagging any place a role appears able to do something it probably should not, or vice versa, for human review. This is a READ-ONLY documentation task: create only docs/roadmap/role-matrix.md and modify no code. Work in a git worktree and open a PR. Context: docs/roadmap/AGENT_TASKS.md, section WS2.
```

---

## Notes for the orchestrator

- **Recommended order if not fully parallel:** Lane A first (its guard cleanup is foundational and changes route behavior the e2e suite asserts), then B/C/D/E in parallel. E and B are the safest to run anytime.
- **Each lane opens its own PR** so you review and merge independently. Conflicts are limited to `frontend/tests/e2e/` (A vs B, mitigated by the ownership rule above).
- **Excluded — needs free-but-human external setup (not a purchase, but a human step):** Full payment testing (WS5) needs a Stripe **test-mode** account + test products + `stripe listen` webhook forwarding before an agent can exercise the live webhook loop. Stand that up, then it becomes a sixth lane.
- **Excluded — needs purchases:** PITR/backups, branch protection, prod repo/project, 1,000-user scale test (Supabase paid tier), and the Phase-4 features still pending specs (pay-first flow, fiscal-agent listing).
