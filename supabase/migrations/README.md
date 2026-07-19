# supabase/migrations

Ordered SQL migrations applied by the Supabase CLI.

- Filename convention: `YYYYMMDDHHMMSS_short_name.sql` (UTC timestamp prefix
  determines apply order — never renumber an already-applied migration).
- Migrations are append-only and forward-only: fix a mistake with a NEW migration.
- Use the npx-pinned Supabase CLI for the local DB (see project memory), not an old system one.
- Baseline: `20260630130000_squashed_schema.sql` (+ `..140000_bootstrap_data.sql`) is a
  consolidated dump — read it for the current schema; add changes as NEW migrations on
  top, never edit the baseline. Squashed twice: first replacing the original 13 schema
  migrations, then again on 2026-07-19 absorbing the 19 that had accumulated since.
  Both times the baseline KEPT its `20260630130000` timestamp, so deployed projects
  (which already record that version as applied) never re-execute it. Retiring the
  collapsed versions on staging/prod is a one-time `supabase migration repair` —
  see `docs/how_to/squash_runbook.md`.
- `bootstrap_data.sql` is a migration, not seed data, on purpose: `db push` never runs
  `seed.sql`, so the rows the app needs to boot (platform_settings singleton, storage
  buckets, platform-root tenant) would never reach staging or prod from there. Demo and
  test data (`@example.com` users) belongs in `supabase/seed.sql`.
- A `pg_dump` emits GRANTs but never REVOKEs, and Supabase default-grants `anon` on new
  tables — so any re-squash must re-append the explicit `REVOKE`s at the bottom of the
  baseline, or `anon` silently regains TRUNCATE (which bypasses RLS).

Invariant: every new table holding tenant data MUST ship tenant-scoped RLS in
the same migration (enable RLS + policies). The client-side gates in
`frontend/src/lib/policy.js` only mirror these policies — RLS is the real
security boundary. See existing `*_rls_*` migrations for the patterns.
