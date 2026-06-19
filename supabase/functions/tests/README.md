# Edge-function tests

Shell-based integration tests for the Supabase Edge Functions. They run against
a **local** Supabase stack only — they never touch production.

## Running locally

```bash
npm run db:start                                   # local Supabase stack
cp supabase/.env.example supabase/.env             # dummy values are fine for the fast tier
npx --prefix frontend supabase functions serve --env-file supabase/.env   # in another shell
bash supabase/functions/tests/<name>.test.sh
```

Use the npx-pinned Supabase CLI (`npx --prefix frontend supabase ...`), not the
system one. Stop the stack with `npm run db:stop` when done.

## CI tiers

`.github/workflows/ci.yml` runs these in **two** gating jobs. Tests are
discovered by name and only run if the file is present, so adding a test file is
the only step needed to wire it in — list its basename in the matching tier.

### `edge-function-tests` — FAST gate

Tests that need only the local stack + served functions + a (dummy)
`STRIPE_SECRET_KEY` so the billing modules boot. No `stripe listen` forwarder,
no test clocks. Runs on every push and PR.

Current members:
- `system-logs-failure.test.sh`
- `checkout-sessions.test.sh` *(added by the payment lane; skipped until present)*

### `stripe-edge-function-tests` — STRIPE-ENABLED gate

Tests that need the Stripe CLI, a live `stripe listen` forwarder, and test
clocks (~3–4 min). These are orchestrated by `run-all.sh`, which owns the
forwarder lifecycle and exits non-zero on any failure. The CI job invokes
`run-all.sh` **only if it is present** (a sibling payment lane provides it), so
the workflow stays valid/green before that file lands.

Expected members (provided by the payment lane):
- `run-all.sh` — orchestrator (forwarder + test clocks)
- `webhook-matrix.test.sh`
- `portal-and-sync.test.sh`

This job requires TEST-mode Stripe secrets in the GitHub repo's CI secrets;
`STRIPE_WEBHOOK_SECRET` is derived at runtime via `stripe listen --print-secret`.
See `.github/workflows/ci.yml` for the exact secret names.

## Shared CI helper

`.github/scripts/edge-fn-ci-lib.sh` holds the shared "serve functions + wait
until ready", test-discovery, and test-runner helpers both CI jobs source, so
the two tiers can't drift.
