# Edge Function tests

Shell-based integration tests for the Supabase Edge Functions. They run against a
**local** Supabase stack only and never touch production.

## Suites

| Script | Covers | Needs Stripe |
|---|---|---|
| `system-logs-failure.test.sh` | Each billing fn logs a `critical` `system_logs` row on failure (#4) | no |
| `checkout-sessions.test.sh` | Checkout fn across tiers, success/cancel paths, auth + input guards; tenant-owned premium customer reuse + alreadyActive dedup across two admins of one tenant (WS5 b) | yes |
| `authz-identity.test.sh` | Identity is taken from the JWT, never the request body: caller A cannot bind a checkout/customer to caller B's id/email; unauthenticated/invalid-JWT rejected | yes |
| `webhook-matrix.test.sh` | Webhook loop: created/updated/past_due/deleted -> DB end-state; idempotency; lapse->reactivate; waiver x live sub; tenant-owned premium lifecycle (tenant_memberships + accepts_sponsorships + listing) + legacy user-owned mirror (WS5 a, d) | yes (+ `stripe listen` only when `LANEF_WEBHOOK_TRANSPORT=live`) |
| `portal-and-sync.test.sh` | Billing portal URL (incl. non-payer admin opening the tenant/org portal); `sync-my-subscription` upgrade/downgrade/cancel/no-sub reconciliation + tenant-owned org-sub reconciliation (WS5 c) | yes |
| `email-resilience.test.sh` | Payment-confirmation email is isolated: disabled-without-creds (send skipped, warning logged) and failure-isolation (unreachable Resend endpoint → webhook still 200, sub still synced, one `payment_confirmation_email_failure` row) | yes (no forwarder; self-serves) |
| `run-all.sh` | Orchestrates the five Stripe suites; owns the `stripe listen` forwarder lifecycle when `LANEF_WEBHOOK_TRANSPORT=live` (default synthetic transport needs no forwarder) | yes |

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
#      STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC, STRIPE_PRICE_FISCAL_AGENT,
#      APP_URL, STRIPE_WEBHOOK_SECRET
#    Default (synthetic transport): STRIPE_WEBHOOK_SECRET may be ANY value —
#    the tests sign their own events with the same secret the served functions
#    boot with. Only for LANEF_WEBHOOK_TRANSPORT=live must it match the
#    `stripe listen` signing secret:
#      stripe listen --api-key <key> --print-secret

# 3. Serve functions
npx --prefix frontend supabase functions serve --env-file supabase/functions/.env

# 4. Run everything (no forwarder needed on the default synthetic transport;
#    with LANEF_WEBHOOK_TRANSPORT=live it starts/stops the forwarder for you)
bash supabase/functions/tests/run-all.sh
```

Individual suites can be run directly once functions are served — including
`webhook-matrix.test.sh`, which on the default synthetic transport needs no
forwarder at all. Only under `LANEF_WEBHOOK_TRANSPORT=live` does it require a
running `stripe listen --forward-to <stripe-webhook URL>` (it refuses to run
without one in that mode).

## Env toggles

| Var | Default | Effect |
|---|---|---|
| `LANEF_SERVE_EXTERNAL` | unset | Set to `1` by `run-all.sh` after it boots + warms the functions server ONCE for the whole run. Under the flag, `ensure_functions_served` in each child suite does a single readiness probe and reuses that server — no boot, no per-function warm-up, and no kill-on-exit trap (the runner's trap stops the server exactly once at the end). Leave unset for standalone runs (`bash <name>.test.sh`): each suite then self-serves exactly as before. If the probe misses (the shared server died mid-run), the suite falls back to self-serving. `email-resilience.test.sh` unsets the flag internally — it owns its own serve lifecycle by design. |
| `LANEF_INCLUDE_SLOW` | unset | Set to `1` to run the two Stripe **test-clock** `past_due` scenarios in `webhook-matrix.test.sh` (user-owned renewal failure + dunning, and tenant-owned past_due). Each waits ~60s+ on Stripe-side clock advancement. When unset, each prints a visible `SKIP` line (never counted as a pass). These scenarios are also **live-only** (Stripe generates the renewal-failure events), so they additionally require `LANEF_WEBHOOK_TRANSPORT=live` — under the synthetic transport they SKIP even with the flag set. CI sets `LANEF_INCLUDE_SLOW=1` (and the live transport), so they remain gating there. |
| `LANEF_WEBHOOK_TRANSPORT` | unset (= `synthetic`) | How Stripe events reach the local `stripe-webhook` function in `webhook-matrix.test.sh`. **`synthetic`** (default): the test still creates/mutates REAL Stripe TEST-mode objects, then wraps the fetched object JSON in an event envelope, signs it with the served functions' `STRIPE_WEBHOOK_SECRET` (`v1 = HMAC-SHA256("<t>.<payload>")`, `deliver_event` in `lib/stripe_test_helpers.sh`), and POSTs it directly — no `stripe listen` forwarder, no waiting on Stripe delivery, so the whole matrix runs in seconds. **`live`**: the original full-fidelity loop — real Stripe emits the events and a `stripe listen --forward-to` forwarder (started by `run-all.sh`) delivers them. The assertion set is identical under both transports. CI sets `LANEF_WEBHOOK_TRANSPORT=live`. |

## How the webhook loop is exercised

Stripe `stripe trigger` creates customers we don't control, so instead each test
creates a **real Stripe customer**, maps it to a DB user in `billing_customers`,
then creates/updates/cancels **real subscriptions**, and the tests poll the DB
until it reaches the expected end-state. Event delivery depends on
`LANEF_WEBHOOK_TRANSPORT` (see Env toggles): by default (**synthetic**) the test
fetches the real object JSON, wraps it in a signed event envelope, and POSTs it
straight at the served function; under **live** a `stripe listen --forward-to`
forwarder delivers the events Stripe itself emits. `past_due` is produced
deterministically with a Stripe **test clock** (live-only); idempotency is
proven by `stripe events resend` on a previously-delivered event (live) or by
POSTing the byte-identical signed envelope twice (synthetic).

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
- `email-resilience.test.sh` -- runs last under `run-all.sh`; needs the Stripe
  key (real sub create + webhook retrieve) but NO forwarder or test clocks. It
  owns the `functions serve` lifecycle itself, re-serving with different email (Resend) env
  per case, so it is invoked after the forwarder-based suites.

This job requires TEST-mode Stripe secrets in the GitHub repo's CI secrets;
`STRIPE_WEBHOOK_SECRET` is derived at runtime via `stripe listen --print-secret`.
See `.github/workflows/ci.yml` for the exact secret names. The job sets
`LANEF_INCLUDE_SLOW=1` AND `LANEF_WEBHOOK_TRANSPORT=live`, so CI keeps the
full-fidelity live loop (forwarder + test clocks) and the two test-clock
`past_due` scenarios stay gating there, even though the default local run uses
the synthetic transport and skips them (see Env toggles).

## One serve/readiness path — and the isolation rule

There is exactly ONE piece of code that serves the edge functions and decides
"ready": `ensure_functions_served` in `lib/stripe_test_helpers.sh`. Every
suite calls it; CI does not pre-serve anything (there is no CI-side serve
helper — that duplicate leg caused a probe-drift outage and was removed).
It also warms every function worker before returning, so tests never need
cold-start retry loops of their own.

`run-all.sh` itself calls `ensure_functions_served` once up front and exports
`LANEF_SERVE_EXTERNAL=1` (see Env toggles), so a full run boots + warms the
server a single time instead of once per suite; the runner's EXIT trap stops
it exactly once at the end. That single call also owns the Resend mock below —
child suites inherit `RESEND_MOCK_CAPTURE` through the environment.

### Email: constructed env + local Resend mock

`ensure_functions_served` NEVER passes the developer's real email creds to the
served functions. It CONSTRUCTS the served env from an explicit allowlist
(`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`,
`STRIPE_PRICE_FISCAL_AGENT`, `APP_URL`) — sourced from `supabase/functions/.env`
or exported vars — so a live `RESEND_API_KEY` / `EMAIL_FROM` in a dev `.env` can
never leak into a test run and send real dunning mail to `lanef-*@example.com`.

Email is then wired to a tiny **local Resend mock** (`lib/resend_mock.py`): the
helper starts it, points `RESEND_API_URL` at it (with a fake key + from), and the
edge-runtime container reaches it via `host.docker.internal`. The mock returns
`200 {"id":"mock"}` and appends each request body (one JSON line) to a capture
file whose path is exported as `RESEND_MOCK_CAPTURE`. Tests assert on it with
`wait_for_email <to-substr> <subject-substr> <label>` (tolerant of ordering /
multiple sends). If the mock can't start, the helper falls back to serving with
NO email creds (send is a no-op) rather than failing the suite. `webhook-matrix`
uses this to prove the past_due dunning email is actually attempted.

`email-resilience.test.sh` is unaffected: it serves with its OWN env files via
its own `serve_with_env` and never calls `ensure_functions_served`.

The rule that keeps suites from colliding, for anything added later:

> **A suite owns ALL data it touches (create it, tear it down) and may assume
> NOTHING about serve state beyond what `ensure_functions_served` guarantees.**
> Suites that share the stack run serially (run-all.sh); only tests with zero
> shared state may ever run in parallel. `email-resilience` deliberately owns
> the serve lifecycle (it re-serves with different env) and therefore runs
> last.

## Requirements

- Docker + local Supabase stack
- Stripe CLI v1.42+ (`stripe`)
- `python3`, `curl`, `openssl`
