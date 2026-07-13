# supabase/scripts

Ad-hoc, hand-run SQL utilities. **Not migrations** — nothing here runs during
`db:reset`/`db:start`, and these files are deliberately kept out of
`supabase/migrations/`.

Run them as the `postgres`/owner role (Supabase Studio SQL editor or
`psql` with the service connection).

| Script | Purpose |
|---|---|
| `wipe_staging_users.sql` | Delete all user accounts + user-generated data on a NON-prod DB, preserving tenants and charity listings. Transaction-wrapped with a DB-name safety guard; inspect the verify output before `COMMIT`. |
| `large_sample_data.sql` | LOCAL dev only: bulk dataset for pagination/UI stress testing — one grantee with 50 grants, 150 budget items, ~500 expenses. Run on top of `db:reset`. |

⚠️ These bypass RLS (owner role) and are destructive. Never point the wipe at
production — the guard only refuses DB names that don't look like staging.
