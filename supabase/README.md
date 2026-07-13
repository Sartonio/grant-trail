# supabase/

Everything the Supabase CLI and backend own. The layout of `migrations/`,
`functions/`, `seed.sql`, and `config.toml` is dictated by the CLI — don't move
them. Task-oriented guides live in `docs/how_to/` (Diátaxis); this file is just
the map.

| Path | What it is | Details |
|---|---|---|
| `config.toml` | Local-stack CLI config (auth, ports, seed wiring) | — |
| `migrations/` | Ordered, append-only schema migrations | [migrations/README.md](migrations/README.md) |
| `functions/` | Deno Edge Functions (Stripe billing, notifications) | [functions/README.md](functions/README.md) |
| `tests/` | RLS adversarial / trigger / platform-config SQL suites (`npm run verify:rls`) | — |
| `scripts/` | Ad-hoc, hand-run SQL utilities — never auto-applied | [scripts/README.md](scripts/README.md) |
| `seed.sql` | Local dev seed (test accounts + sample data), applied by `npm run db:reset` | — |
| `.env.example` | Template for function secrets used by the local stack | — |

## Where the guides went

- Local dev stack + test accounts: [docs/how_to/dev_setup.md](../docs/how_to/dev_setup.md)
- Local Stripe (serve functions, forward webhooks): [docs/how_to/local_stripe_testing.md](../docs/how_to/local_stripe_testing.md)
- Local auth email testing: [docs/how_to/local_email_testing.md](../docs/how_to/local_email_testing.md)
- Staging project + test webhook: [docs/how_to/staging_setup.md](../docs/how_to/staging_setup.md)
- Production deploy (secrets, migrations, functions — one pipeline, never by hand): [docs/how_to/prod_setup.md](../docs/how_to/prod_setup.md)
- Every environment variable, including the optional Stripe portal configuration: [docs/reference/environment_variables.md](../docs/reference/environment_variables.md)
