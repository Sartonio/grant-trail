# Framework source

These guardrail files (`.claude/hooks/scope-guard.ts`, `scripts/scope.ts`,
`scripts/edit-log.ts`, and the PreToolUse hook wiring in
`.claude/settings.json`) were **vendored from
[`ai-first-starter`](https://github.com/Sartonio/ai-first-starter) at commit
`753e841`** on **2026-07-14**.

## Policy: vendored fork

- These are **local copies**, not a live dependency.
- **Local patches are allowed** — the files have already been adapted to
  grant-trail (npm instead of pnpm, `frontend/src/` + `supabase/functions/`
  nudge paths, optional module-map, grant-trail catch-all globs).
- There is **no automatic sync** back to or from the upstream source. Pulling a
  newer upstream version is a manual, deliberate action: re-copy and re-apply
  the grant-trail adaptations by hand.
