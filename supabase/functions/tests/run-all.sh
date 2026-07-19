#!/usr/bin/env bash
#
# WS5 / Lane F — payment-flow test runner.
#
# Orchestrates the Stripe payment-flow integration tests against TEST mode:
#   1. checkout-sessions.test.sh   (b)  -- checkout fn, both tiers, dedup
#   2. authz-identity.test.sh           -- JWT-derived identity, no body IDOR
#   3. webhook-matrix.test.sh      (a,d)-- live webhook loop, idempotency,
#                                          lapse->reactivate, waiver, tenant-owned
#   4. portal-and-sync.test.sh     (c)  -- billing portal + sync reconciliation
#   5. email-resilience.test.sh         -- isolated dunning email (if present)
#
# This runner owns the `stripe listen --forward-to` forwarder lifecycle — but
# only when LANEF_WEBHOOK_TRANSPORT=live: it starts one for the webhook-matrix
# test (which then needs the live loop) and stops it for the sync test (so sync
# is provably the sole DB writer). Under the DEFAULT synthetic transport no
# forwarder runs at all: webhook-matrix signs + POSTs the event envelopes
# itself (deliver_event in lib/stripe_test_helpers.sh), and no other suite
# uses the forwarder (portal-and-sync explicitly requires it OFF;
# checkout-sessions / authz-identity / email-resilience never needed it).
#
# PREREQUISITES (local only -- never touches production):
#   1. Local Supabase up:        npx --prefix frontend supabase start
#                                npx --prefix frontend supabase db reset
#   2. supabase/functions/.env present with TEST-mode Stripe secrets:
#        STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC,
#        STRIPE_PRICE_FISCAL_AGENT, APP_URL, STRIPE_WEBHOOK_SECRET
#      (Synthetic transport signs with the same STRIPE_WEBHOOK_SECRET the
#       served functions boot with, so any value works as long as it's set.
#       For LANEF_WEBHOOK_TRANSPORT=live it must ALSO match the `stripe listen`
#       signing secret; get it with: stripe listen --api-key <key> --print-secret)
#   3. Functions served: AUTOMATIC. This runner calls ensure_functions_served
#        (lib/stripe_test_helpers.sh) ONCE, boots + warms `supabase functions
#        serve` for the whole run, and exports LANEF_SERVE_EXTERNAL=1 so each
#        child suite reuses that server (quick probe, no per-file cold boot).
#        The server is stopped exactly once by this runner's EXIT trap. To
#        serve by hand instead (e.g. for faster iteration), start it first and
#        the tests will reuse it:
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
# The forwarder's pid is ALSO recorded on disk (per stack, so per worktree)
# because a SIGKILLed run gets no EXIT trap: the next run's stop_forwarder
# reads the file and reaps only THAT leaked process. This replaces the old
# `pkill -f "stripe listen --api-key"` sweep, which also killed forwarders it
# never started — e.g. the dev-session forwarder from scripts/dev.sh (same
# argv shape) or another worktree's test forwarder.
listen_pidfile() { echo "/tmp/lanef-listen-${PROJECT_ID:-grant-trail}.pid"; }

start_forwarder() {
  stop_forwarder
  stripe listen --api-key "$STRIPE_SECRET_KEY" \
    --forward-to "${API_URL:-http://127.0.0.1:54321}/functions/v1/stripe-webhook" \
    > "$LISTEN_LOG" 2>&1 &
  LISTEN_PID=$!
  echo "$LISTEN_PID" > "$(listen_pidfile)"
  # wait until "Ready!"
  for _ in $(seq 1 20); do
    grep -q "Ready!" "$LISTEN_LOG" 2>/dev/null && return 0
    sleep 1
  done
  echo "WARN: forwarder did not report Ready!; log:" >&2
  cat "$LISTEN_LOG" >&2
}

stop_forwarder() {
  # Our own child dies synchronously via kill+wait (no fixed sleep needed).
  if [ -n "$LISTEN_PID" ]; then
    kill "$LISTEN_PID" 2>/dev/null || true
    wait "$LISTEN_PID" 2>/dev/null || true
  fi
  # Reap a forwarder leaked by an interrupted earlier run OF THIS STACK (its
  # pid was recorded in the pidfile) — two live forwarders would double-deliver
  # every event. Verify the pid is still a `stripe listen` before killing (pids
  # get recycled); poll briefly until it is gone. Forwarders we did not start
  # (dev.sh's, other worktrees') are deliberately left alone.
  local pidfile stray i
  pidfile="$(listen_pidfile)"
  stray="$(cat "$pidfile" 2>/dev/null || true)"
  if [ -n "$stray" ] && [ "$stray" != "$LISTEN_PID" ] \
      && ps -o args= -p "$stray" 2>/dev/null | grep -q "stripe listen"; then
    kill "$stray" 2>/dev/null || true
    for i in 1 2 3 4 5; do
      kill -0 "$stray" 2>/dev/null || break
      sleep 0.2
    done
  fi
  rm -f "$pidfile"
  LISTEN_PID=""
}

# Source the shared helpers so THIS shell can own the functions-serve lifecycle
# (boot + warm once for the whole run) and tear it down from the trap below.
# shellcheck source=lib/stripe_test_helpers.sh
source "${HERE}/lib/stripe_test_helpers.sh"

cleanup() { stop_forwarder; _stop_functions_served; rm -f "$LISTEN_LOG"; }
trap cleanup EXIT

# Serve + warm the edge functions ONCE for the whole run. Child suites see
# LANEF_SERVE_EXTERNAL=1 and reuse this server via a quick readiness probe in
# ensure_functions_served, instead of each file cold-booting (and EXIT-killing)
# its own serve (~60-110s per file).
ensure_functions_served; SERVE_RC=$?
# ensure_functions_served installs its own EXIT trap when it boots a server;
# re-assert the combined cleanup so the forwarder + listen log are swept too
# (on the fatal path as well).
trap cleanup EXIT
[ "$SERVE_RC" -eq 0 ] || exit 1
export LANEF_SERVE_EXTERNAL=1

# Webhook transport (lib/stripe_test_helpers.sh): the forwarder is only needed
# when webhook-matrix runs the live loop. The default synthetic transport signs
# + POSTs event envelopes directly — no `stripe listen` at all.
TRANSPORT="$(webhook_transport)" || exit 1
echo "webhook transport: ${TRANSPORT}"

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

# (a,d) webhook matrix -- needs the live forwarder ONLY on the live transport;
# synthetic delivers its own signed events.
if [ "$TRANSPORT" = "live" ]; then
  start_forwarder
fi
run webhook-matrix.test.sh
# Forwarder OFF for everything after the matrix (portal/sync must be the sole
# DB writer). On the synthetic transport this is purely a stray sweep — it
# kills nothing we started. The sweep only reaps a pid recorded in this
# stack's pidfile (a leak from an interrupted earlier run); externally started
# forwarders — dev.sh's, CI's, other worktrees' — are NOT touched, so on the
# live transport make sure no dev forwarder is running against this stack.
stop_forwarder

# (c) portal + sync -- forwarder OFF so sync is the sole DB writer
run portal-and-sync.test.sh

# email resilience -- runs LAST because it OWNS the `functions serve` lifecycle
# (it drops LANEF_SERVE_EXTERNAL and re-serves twice with different email (Resend)
# env, killing the shared serve started above; its own trap stops its last serve
# on exit). THIS runner's trap then sweeps too -- _stop_functions_served
# tolerates an already-dead server, so there is no double-kill. No forwarder
# needed (it POSTs hand-signed events directly). Skipped if absent.
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
