# lib

Central, framework-light helpers. Access-control decisions live here — this is
the canonical place, and these gates mirror the database RLS.

- `policy.js` — THE source of truth for authz + billing policy: roles, `getRole`,
  `hasRequiredSubscription`, `needsSubscription`, `canMutate` / `isReadOnlyAdmin`
  (lapsed-admin read-only), and directory entitlements (`canViewDirectory`,
  `canOwnListing`). Pure functions over a `session`.
- `guards.js` — declarative route guards (`Guard`, `RequireRole`,
  `RequireSubscription`, `resolveGuard`) composing the role + billing axes.
- `useWriteGuard.js` — hook returning a guard fn; blocked writes route to the billing nudge.
- `billing.js` — Stripe checkout/portal/sync via edge functions; session bootstrap
  (`fetchSessionContext`) and membership status. No hard-coded price/product IDs.
- `invites.js` — token-scoped invite RPCs (`getInviteByToken`, `consumeInvite`).
- `inquiries.js` — best-effort `notify-inquiry` edge-function call (non-fatal).

Invariant: client-side gates are UX only and MUST mirror DB RLS — RLS is the real
security boundary. Add/change access logic HERE (and in the matching migration),
not scattered in components.
