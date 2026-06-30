# Making GrantTrail AI-Friendly — Plan & Execution Log

Goal: orient AI agents fast and keep them from breaking invariants (RLS isolation,
billing gating, tenant-agnostic root). Green baseline before work: **79 tests pass,
lint clean** (`npm test --prefix frontend`, `npm run lint --prefix frontend`).

## Diagnosis (what's AI-hostile today)
1. **No root agent memory.** No `CLAUDE.md` / `AGENTS.md` at repo root — agents start cold every time.
2. **Flat 69-file `frontend/src/components/`.** Admin, fiscal-agent, grant, auth, billing,
   layout, and common components are all dumped together with their `.css`/`.test.js`.
   Hard to locate, hard to know what's related.
3. **Undocumented core shapes.** `session`, `userRecord`, `membership`, `tenantConfig`
   are reverse-engineered from `App.js` every time.
4. **No reusable project subagents** for the recurring high-risk work (migrations w/ RLS, components).
5. **22 KB `App.js` monolith** mixing router + auth + notifications + membership.

## Phases (each executed by a subagent; additive phases run in parallel)

- **P1 — Restructure** `components/` into domain folders (`admin/ fiscalAgent/ grant/
  auth/ billing/ layout/ common/ landing/`), co-locating css+tests, rewiring all imports.
  Behavior-preserving. Verify test+lint green. *(blocking; runs first)*
- **P2 — Root memory:** author `CLAUDE.md` + `AGENTS.md` (stack, dir map, commands, invariants).
- **P3 — Module docs:** short `README.md` per component subdir + `lib/`, `hooks/`,
  `supabase/functions/`, `supabase/migrations/`.
- **P4 — Type contracts:** JSDoc `@typedef`s for the core shapes in `lib/types.js`.
- **P5 — Project subagents:** commit `.claude/agents/` (migration-author, rls-reviewer, component-builder).
- **P6 — `App.js` decomposition** into `useAuth`/`useNotifications`/`useMembership` hooks. *(last, riskiest)*

## Execution log
- [x] Baseline captured (79 tests, lint clean)
- [x] P1 — components/ regrouped into 8 domain folders (69 `git mv`), ~107 imports rewired
- [x] P2 — root `CLAUDE.md` (102 lines) + `AGENTS.md`
- [x] P3 — 12 module `README.md`s (8 component dirs + lib/hooks/functions/migrations)
- [x] P4 — `frontend/src/lib/types.js` (6 typedefs), wired into policy.js/guards.js (comments only)
- [x] P5 — `.claude/agents/{migration-author,rls-reviewer,component-builder}.md`
- [x] P6 — App.js 558→456 lines; extracted `useNotifications`, `usePlatformSettings`, `useMembership`
- [x] Final combined verification: 79 tests pass, lint clean

Not committed — left for review. `git add -A` then commit when ready.
