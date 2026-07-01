#!/usr/bin/env bash
#
# WS5 / Lane F — payment-flow test runner.
#
# Orchestrates the Stripe payment-flow integration tests against TEST mode:
#   1. checkout-sessions.test.sh   (b)  -- both checkout fns, both tiers
#   2. webhook-matrix.test.sh      (a,d)-- live webhook loop, idempotency,
#                                          lapse->reactivate, waiver
#   3. portal-and-sync.test.sh     (c)  -- billing portal + sync reconciliation
#
# This runner owns the `stripe listen --forward-to` forwarder lifecycle:
# it starts one for the webhook-matrix test (which needs the live loop) and
# stops it for the sync test (so sync is provably the sole DB writer).
#
# PREREQUISITES (local only -- never touches production):
#   1. Local Supabase up:        npx --prefix frontend supabase start
#                                npx --prefix frontend supabase db reset
#   2. supabase/functions/.env present with TEST-mode Stripe secrets:
#        STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC,
#        STRIPE_PRICE_FISCAL_AGENT, APP_URL, STRIPE_WEBHOOK_SECRET
#      (STRIPE_WEBHOOK_SECRET must match the `stripe listen` signing secret;
#       get it with: stripe listen --api-key <key> --print-secret)
#   3. Functions served: AUTOMATIC. Each test calls ensure_functions_served
#        (lib/stripe_test_helpers.sh) to start `supabase functions serve` if none
#        is already up, and stop it on exit. To serve by hand instead (e.g. for
#        faster iteration), start it first and the tests will reuse it:
#          npx --prefix frontend supabase functions serve \
#            --env-file supabase/functions/.env
#   4. Stripe CLI v1.42+ logged-in or STRIPE_SECRET_KEY exported.
#
# Run:  bash supabase/functions/tests/run-all.sh

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HERE}/../.env"

if [ -f "$ENV_FILE" ]; then
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
fi

: "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY must be set (supabase/functions/.env)}"

LISTEN_LOG="$(mktemp -t lanef-listen.XXXXXX.log)"
LISTEN_PID=""

start_forwarder() {
  stop_forwarder
  stripe listen --api-key "$STRIPE_SECRET_KEY" \
    --forward-to "${API_URL:-http://127.0.0.1:54321}/functions/v1/stripe-webhook" \
    > "$LISTEN_LOG" 2>&1 &
  LISTEN_PID=$!
  # wait until "Ready!"
  for _ in $(seq 1 20); do
    grep -q "Ready!" "$LISTEN_LOG" 2>/dev/null && return 0
    sleep 1
  done
  echo "WARN: forwarder did not report Ready!; log:" >&2
  cat "$LISTEN_LOG" >&2
}

stop_forwarder() {
  pkill -f "stripe listen --api-key" 2>/dev/null || true
  LISTEN_PID=""
  sleep 1
}

cleanup() { stop_forwarder; rm -f "$LISTEN_LOG"; }
trap cleanup EXIT

TOTAL_FAIL=0
run() {
  echo
  echo "========================================================"
  echo "RUN  $1"
  echo "========================================================"
  bash "${HERE}/$1"
  local rc=$?
  TOTAL_FAIL=$((TOTAL_FAIL + rc))
}

# (b) checkout sessions -- no webhook needed
run checkout-sessions.test.sh

# authz / identity guards -- needs the Stripe key, no webhook
run authz-identity.test.sh

# (a,d) webhook matrix -- needs the live forwarder
start_forwarder
run webhook-matrix.test.sh
stop_forwarder

# (c) portal + sync -- forwarder OFF so sync is the sole DB writer
run portal-and-sync.test.sh

# email resilience -- runs LAST because it OWNS the `functions serve` lifecycle
# (it re-serves twice with different email (Resend) env, killing the shared serve). No
# forwarder needed (it POSTs hand-signed events directly). Skipped if absent.
if [ -f "${HERE}/email-resilience.test.sh" ]; then
  run email-resilience.test.sh
fi

echo
echo "========================================================"
if [ "$TOTAL_FAIL" -eq 0 ]; then
  echo "ALL PAYMENT-FLOW TESTS PASSED"
else
  echo "PAYMENT-FLOW TESTS FAILED (${TOTAL_FAIL} failing assertions)"
fi
echo "========================================================"
exit "$TOTAL_FAIL"
