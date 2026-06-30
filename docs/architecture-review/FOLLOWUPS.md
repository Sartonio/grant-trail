# Architecture Review — Outstanding Follow-ups

Tracked work deferred from the 2026-06-30 architecture-review + refactoring effort.
Source audits: `tests.md`, `workflows.md`, `modularity.md`, `security.md` (same folder).
The PRs that landed: #77 (CI), #78 (security audit docs), #79 (tests + modularity + type infra),
#81 (RLS escalation fix).

## Security (from `security.md` / PR #78) — highest priority
- [ ] **F4 (MED/LOW) — storage IDOR.** Storage SELECT scopes by tenant but not by grant owner →
      intra-tenant access to receipts/attachments via guessable sequential paths. Needs an
      owner-scoped storage policy. Left for human review (risky policy rewrite).
- [ ] **F5 (LOW) — `xlsx` advisory.** Known CVE with **no npm patch available**; evaluate
      swapping the export lib or pinning/sandboxing. CI `npm audit` is advisory-only (`|| true`).
- [ ] **F6 (LOW) — CSP is Report-Only.** `vercel.json` ships a CSP that is never enforced.
      Move to enforcing mode after confirming no violations in report telemetry.
- [ ] **F7 (LOW) — `notify-inquiry` unrate-limited.** JWT-gated but no rate limit; add throttling.
- [ ] **RLS perf nit.** Policies call helpers (`current_tenant_id()`, `is_admin()`, …) directly
      rather than wrapped as `(SELECT …)` for initplan caching. Indexing itself is thorough (4/5).

## Pre-existing test issue (surfaced during #81 verification)
- [ ] **Unrelated RLS adversarial failure:** `"grantee cannot plant a grant into another tenant"`
      fails because the seeded grantee has no active membership (subscription-gating denial on
      `grant_record` INSERT), independent of any escalation fix. Investigate the seed/membership
      setup so the adversarial suite is fully green on a fresh `db:reset`.

## Modularity (from `modularity.md` / PR #79) — Phases not completed
- [ ] **Phase 2 remainder:** `lib/data/{tenants,users}.js` + migrate `TenantManagement` (12 `.from`)
      and `AdminUserList` (7 `.from`). Deferred: mostly single-caller queries in 600-line god
      components — low dedup value without E2E coverage; do alongside Phase 3.
- [ ] **Phase 3:** extract load hooks (`useGrantReview`, `useExpenseReports`, `useGrantBreakdown`)
      to absorb the state triads out of the god components.
- [ ] **Reconcile `hooks/useGrantee.js` `useUser()`** — possibly stale; verify or delete before reuse.
- [ ] **Phases 4/5 (untouched by design):** `App.js` session-hook split; `_shared/stripe.ts`
      (516 lines, 4 jobs) split via re-exports.

## Type safety (PR #79)
- [ ] **Widen typecheck scope.** `checkJs` is enforced only over the load-bearing closure
      (`src/lib`, `src/hooks`, `supabaseClient`); full-src has ~187 legacy errors. Ratchet outward
      as files get annotated (TODO in `frontend/tsconfig.json`).
- [ ] **Refresh `.claude/agents/*` for the new norms.** The cloud agent's edits to reference
      `npm run verify` + the `lib/data/` layer were lost (ran on ephemeral remote disk). Now that
      `.claude/agents/` is tracked, update the three defs to cite the Definition-of-Done.

## Verification / CI
- [ ] **Run `npm run verify:full` end-to-end.** The full security tier (RLS adversarial, webhook
      matrix, edge-fn identity, e2e) was only `bash -n` validated, not run start-to-finish.
- [ ] **Wire CI to call `npm run verify`** (noted for PR #77 follow-up; the workflows PR didn't
      touch the new script).
- [x] **#77 C1 — Vercel staging/prod target.** Confirmed `VERCEL_PROJECT_ID` differs per GitHub
      Environment (owner-confirmed 2026-06-30).

## Repo hygiene
- [ ] **Prune stale agent worktrees** under `.claude/worktrees/` (left from local + cloud runs).
- [ ] **Stray PR #80 ("Add test.txt")** — unrelated to this work; close it.
