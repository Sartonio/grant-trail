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
- open | edge lint suppressed | `no-import-prefix` deno lint rule disabled in supabase/functions/deno.json — the edge functions import deps via inline `npm:` specifiers (Supabase Edge runtime pattern) with no import map, which the rule forbids. Revisit if the functions adopt a deno.json import map. | discovered-during: deno-static-gate build 2026-07-14
- open | nullable stripe customer id | getOrCreateStripeCustomer (supabase/functions/_shared/stripe-client.ts) can return `string | null` because billing_customers.stripe_customer_id is nullable; create-billing-portal-session/index.ts (lines ~53, ~78) casts customerId `as string` to pass Stripe. If a row ever holds a null id, Stripe rejects it at runtime (current behavior preserved, not fixed). Consider filtering null ids at the query or throwing a typed error before the Stripe call. | discovered-during: deno-static-gate build 2026-07-14
- open | CI lacks edge-static gate | .github/workflows/ci.yml runs the frontend fast tier + Supabase stack steps directly (not scripts/verify-full.sh), and has no Deno setup, so the new vf_edge_static tier does NOT run in CI. Add a `denoland/setup-deno` step + `npm run verify:edge:static` to ci.yml to make the gate ride along. | discovered-during: deno-static-gate build 2026-07-14
- wontfix | auto-format hook not ported | ai-first-starter's `.claude/hooks/auto-format.ts` PostToolUse hook was intentionally NOT vendored: grant-trail has no prettier config or devDependency, so running it would reformat non-prettier-managed files and create large diff churn. Revisit only if grant-trail adopts prettier. | discovered-during: framework-hooks port 2026-07-14
- open | route-param id types | useGrantBreakdown/useGrantReview receive grant ids as route-param strings but the lib/data layer types them as numbers (PostgREST coerces at runtime, so behavior is correct). The strict-checkJs gate papers over this with documented `/** @type {number} */` casts (hooks/useGrantBreakdown.js, hooks/useGrantReview.js) rather than converting, to stay behavior-preserving. Proper fix: Number() the params at the component boundary and drop the casts. | discovered-during: strict-checkJs gate build 2026-07-14
- open | style drift | W3 (strict-lib) files under frontend/src/lib+hooks were reformatted to prettier defaults (double quotes, 80-col wrap) by a cross-repo auto-format hook, since fixed upstream; those files now differ in quote style from the rest of the repo. Re-align if/when grant-trail adopts a formatter. | discovered-during: strict-lib checkpoint 2026-07-14
