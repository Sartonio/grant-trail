# components/common

Shared, reusable presentational primitives. No data fetching.

- `StatusBadge.js` — colored icon+label for grant statuses (pending/approved/rejected/needs_changes).
- `ConfirmDialog.js` — styled drop-in replacement for `window.confirm()`.
- `ErrorFallback.js` — error-boundary fallback UI (reload + collapsible details).
- `ReadOnlyBanner.js` — banner shown to lapsed admins in read-only mode; links to the billing nudge.

Invariant: keep these dumb and dependency-light — props in, UI out. Anything
needing access-control or Supabase belongs in `lib/` or a feature folder, not here.
