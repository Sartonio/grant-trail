# DEBT.md — bug & limitation ledger

Any bug or limitation discovered but not fixed in a task gets an entry here, in
the **same commit** as the task. Entries are a running history: don't delete
them — flip `status` to `fixed` or `wontfix` instead.

**Format** (one entry per bug):

```
status | area | description | discovered-during: <context> (date)
```

`status` is one of `open` | `fixed` | `wontfix`.

## Entries

- open | frontend coupling | 14 component files import supabaseClient directly (allowed for auth/storage today but unenforced; boundary allowlist planned) | discovered-during: framework survey 2026-07-14
- open | validation divergence | return-path/origin validation exists only in supabase/functions/_shared/validation.ts with no frontend counterpart; frontend and edge functions can drift on what's accepted | discovered-during: framework survey 2026-07-14
- wontfix | auto-format hook not ported | ai-first-starter's `.claude/hooks/auto-format.ts` PostToolUse hook was intentionally NOT vendored: grant-trail has no prettier config or devDependency, so running it would reformat non-prettier-managed files and create large diff churn. Revisit only if grant-trail adopts prettier. | discovered-during: framework-hooks port 2026-07-14
