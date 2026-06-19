# Edge Function tests

Shell-based integration tests for the Supabase Edge Functions. They run against a
**local** Supabase stack only and never touch production.

## Suites

| Script | Covers | Needs Stripe |
|---|---|---|
| `system-logs-failure.test.sh` | Each billing fn logs a `critical` `system_logs` row on failure (#4) | no |
| `checkout-sessions.test.sh` | Both checkout fns, both tiers, success/cancel paths, auth + input guards (WS5 b) | yes |
| `webhook-matrix.test.sh` | Live webhook loop: created/updated/past_due/deleted -> DB end-state; idempotency; lapse->reactivate; waiver x live sub (WS5 a, d) | yes + `stripe listen` |
| `portal-and-sync.test.sh` | Billing portal URL; `sync-my-subscription` upgrade/downgrade/cancel/no-sub reconciliation (WS5 c) | yes |
| `run-all.sh` | Orchestrates the three Stripe suites and owns the `stripe listen` forwarder lifecycle | yes |

`lib/stripe_test_helpers.sh` holds shared helpers (test-user/fixtures via the
GoTrue admin API, Stripe customer/subscription scaffolding, DB polling assertions).

## Running locally (fast tier)

```bash
npm run db:start                                   # local Supabase stack
cp supabase/.env.example supabase/.env             # dummy values are fine for the fast tier
npx --prefix frontend supabase functions serve --env-file supabase/.env   # in another shell
bash supabase/functions/tests/<name>.test.sh
```

Use the npx-pinned Supabase CLI (`npx --prefix frontend supabase ...`), not the
system one. Stop the stack with `npm run db:stop` when done.

## Running the Stripe payment-flow suite

These tests drive **real Stripe TEST mode** (no real charges) and prove the
webhook-synced DB projection (`subscriptions`, `user_memberships`) against
Stripe as the source of truth.

```sh
# 1. Local stack (npx-pinned CLI, per project memory)
npx --prefix frontend supabase start
npx --prefix frontend supabase db reset

# 2. supabase/functions/.env (gitignored) with TEST-mode secrets:
#      STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC, STRIPE_PRICE_FISCAL_AGENT_ACCESS,
#      APP_URL, STRIPE_WEBHOOK_SECRET
#    STRIPE_WEBHOOK_SECRET must match the `stripe listen` signing secret:
#      stripe listen --api-key <key> --print-secret

# 3. Serve functions
npx --prefix frontend supabase functions serve --env-file supabase/functions/.env

# 4. Run everything (starts/stops the webhook forwarder for you)
bash supabase/functions/tests/run-all.sh
```

Individual suites can be run directly once functions are served;
`webhook-matrix.test.sh` additionally requires a running
`stripe listen --forward-to <stripe-webhook URL>` (it refuses to run without one).

## How the webhook loop is exercised

Stripe `stripe trigger` creates customers we don't control, so instead each test
creates a **real Stripe customer**, maps it to a DB user in `billing_customers`,
then creates/updates/cancels **real subscriptions**. `stripe listen --forward-to`
delivers the authentic, signed events to the local `stripe-webhook` function, and
the tests poll the DB until it reaches the expected end-state. `past_due` is
produced deterministically with a Stripe **test clock**; idempotency is proven by
`stripe events resend` on a previously-delivered event.

## CI tiers

`.github/workflows/ci.yml` runs these in **two** gating jobs. Tests are
discovered by name and only run if the file is present, so adding a test file is
the only step needed to wire it in -- list its basename in the matching tier.

### `edge-function-tests` -- FAST gate

Tests that need only the local stack + served functions + a (dummy)
`STRIPE_SECRET_KEY` so the billing modules boot. No `stripe listen` forwarder,
no test clocks. Runs on every push and PR.

Current members:
- `system-logs-failure.test.sh`
- `checkout-sessions.test.sh`

### `stripe-edge-function-tests` -- STRIPE-ENABLED gate

Tests that need the Stripe CLI, a live `stripe listen` forwarder, and test
clocks (~3-4 min). Orchestrated by `run-all.sh`, which owns the forwarder
lifecycle and exits non-zero on any failure. The CI job invokes `run-all.sh`
**only if it is present**, so the workflow stays valid/green if it is ever absent.

Members:
- `run-all.sh` -- orchestrator (forwarder + test clocks)
- `webhook-matrix.test.sh`
- `portal-and-sync.test.sh`

This job requires TEST-mode Stripe secrets in the GitHub repo's CI secrets;
`STRIPE_WEBHOOK_SECRET` is derived at runtime via `stripe listen --print-secret`.
See `.github/workflows/ci.yml` for the exact secret names.

## Shared CI helper

`.github/scripts/edge-fn-ci-lib.sh` holds the shared "serve functions + wait
until ready", test-discovery, and test-runner helpers both CI jobs source, so
the two tiers can't drift.

## Requirements

- Docker + local Supabase stack
- Stripe CLI v1.42+ (`stripe`)
- `python3`, `curl`, `openssl`
