# supabase/migrations

Ordered SQL migrations applied by the Supabase CLI.

- Filename convention: `YYYYMMDDHHMMSS_short_name.sql` (UTC timestamp prefix
  determines apply order — never renumber an already-applied migration).
- Migrations are append-only and forward-only: fix a mistake with a NEW migration.
- Use the npx-pinned Supabase CLI for the local DB (see project memory), not an old system one.

Invariant: every new table holding tenant data MUST ship tenant-scoped RLS in
the same migration (enable RLS + policies). The client-side gates in
`frontend/src/lib/policy.js` only mirror these policies — RLS is the real
security boundary. See existing `*_rls_*` migrations for the patterns.
