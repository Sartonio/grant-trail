# Edge Function tests

Shell-based integration tests for the Supabase Edge Functions. They run against a
**local** Supabase stack only and never touch production.

## Suites

| Script | Covers | Needs Stripe |
|---|---|---|
| `system-logs-failure.test.sh` | Each billing fn logs a `critical` `system_logs` row on failure (#4) | no |
| `checkout-sessions.test.sh` | Both checkout fns, both tiers, success/cancel paths, auth + input guards (WS5 b) | yes |
| `webhook-matrix.test.sh` | Live webhook loop: created/updated/past_due/deleted → DB end-state; idempotency; lapse→reactivate; waiver × live sub (WS5 a, d) | yes + `stripe listen` |
| `portal-and-sync.test.sh` | Billing portal URL; `sync-my-subscription` upgrade/downgrade/cancel/no-sub reconciliation (WS5 c) | yes |
| `run-all.sh` | Orchestrates the three Stripe suites and owns the `stripe listen` forwarder lifecycle | yes |

`lib/stripe_test_helpers.sh` holds shared helpers (test-user/fixtures via the
GoTrue admin API, Stripe customer/subscription scaffolding, DB polling assertions).

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

## Requirements

- Docker + local Supabase stack
- Stripe CLI v1.42+ (`stripe`)
- `python3`, `curl`, `openssl`
