# hooks

Reusable React hooks.

- `useGrantee.js` — exposes `useUser()`: loads the current auth user's record
  from Supabase, returning `{ userRecord, loading }`.

Invariant: hooks own data-fetching/effects, not access-control decisions —
those belong in `lib/policy.js`. Keep them UI-agnostic (no JSX).
