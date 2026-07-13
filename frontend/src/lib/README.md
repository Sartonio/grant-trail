# lib

Central, framework-light helpers. Access-control decisions live here — this is
the canonical place, and these gates mirror the database RLS.

- `policy.js` — THE source of truth for authz + billing policy: roles, `getRole`,
  `hasRequiredSubscription`, `needsSubscription`, `canMutate` / `isReadOnlyAdmin`
  (lapsed-admin read-only), and directory entitlements (`canViewDirectory`,
  `canOwnListing`). Pure functions over a `session`.
- `guards.js` — declarative route guards (`Guard`, `resolveGuard`) composing
  the role + billing axes.
- `useWriteGuard.js` — hook returning a guard fn; blocked writes route to the billing nudge.
- `billing.js` — Stripe checkout/portal/sync via edge functions; session bootstrap
  (`fetchSessionContext`) and membership status. No hard-coded price/product IDs.
- `invites.js` — token-scoped invite RPCs (`getInviteByToken`, `consumeInvite`).
- `inquiries.js` — best-effort `notify-inquiry` edge-function call (non-fatal).
- `format.js` — shared display formatters (currency, dates).
- `storage.js` — Supabase Storage helpers (tenant-scoped paths, signed URLs).
- `data/` — the per-entity data-access layer (`grants.js`, `expenses.js`, etc.);
  components import from here, never `supabase.from(...)` directly (ESLint-enforced).
- `database.types.ts` — generated table types (`npm run db:types`); annotate `data/` and
  `lib/` code against them to keep `npm run typecheck` green.

Invariant: client-side gates are UX only and MUST mirror DB RLS — RLS is the real
security boundary. Add/change access logic HERE (and in the matching migration),
not scattered in components.
