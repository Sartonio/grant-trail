#!/usr/bin/env bash
#
# Email resilience — payment-confirmation email send is fully isolated from the
# subscription sync. Two cases, each driving ONE hand-signed
# checkout.session.completed event at a (re)served stripe-webhook:
#
#   CASE 1 — disabled-without-creds (RESEND_API_KEY/EMAIL_FROM UNSET):
#     webhook 200, subscription + membership written, NO new
#     payment_confirmation_email_failure row, and the served function logs the
#     "skipping email send" warning.
#
#   CASE 2 — failure-isolation (RESEND_API_URL points at an unreachable endpoint,
#     so the send fetch is refused): webhook STILL returns 200 (Stripe never
#     retries), the subscription is STILL written, and exactly one
#     payment_confirmation_email_failure row (severity 'error') lands in
#     system_logs tagged with the event id we sent.
#
# Why hand-signed events (not `stripe trigger` / `stripe listen`):
#   * `stripe trigger checkout.session.completed` makes a synthetic session with
#     mode=payment and no subscription, so it never enters the email branch.
#   * We create a REAL Stripe test customer + subscription (so
#     upsertSubscriptionFromStripe's `subscriptions.retrieve` works), map the
#     customer to a DB user, then POST a checkout.session.completed whose
#     data.object carries mode=subscription + the real sub/customer + the user's
#     email. The body is signed with the same STRIPE_WEBHOOK_SECRET the served
#     function verifies against, so `constructEventAsync` accepts it directly —
#     no forwarder, no test clocks.
#
# This suite OWNS the `functions serve` lifecycle (it re-serves twice with
# different email env). It kills any running serve first and starts its own, so it
# works standalone and at the tail of run-all.sh alike. Nothing touches prod:
# TEST-mode Stripe keys + local Supabase only.
#
# Required env (sourced from supabase/functions/.env, or exported in CI):
#   STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC   (real TEST-mode values)
#   STRIPE_WEBHOOK_SECRET  (optional — defaults to a local test value; the served
#                           function and the signer always use the SAME value)
#   APP_URL                (optional — defaults to http://localhost:3000)
#
# Run:  bash supabase/functions/tests/email-resilience.test.sh

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../../.." && pwd)"
# shellcheck source=lib/stripe_test_helpers.sh
source "${HERE}/lib/stripe_test_helpers.sh"

# Source supabase/functions/.env locally; in CI the secrets arrive as env vars.
ENV_FILE="${ENV_FILE:-${HERE}/../.env}"
if [ -f "$ENV_FILE" ]; then
  set -a; # shellcheck disable=SC1090
  source "$ENV_FILE"; set +a
fi

: "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY must be set (supabase/functions/.env or CI secret)}"
: "${STRIPE_PRICE_BASIC:?STRIPE_PRICE_BASIC must be set (supabase/functions/.env or CI secret)}"

# The webhook secret only needs to be IDENTICAL between the served function and
# the signer below — the value itself is arbitrary for a hand-signed event.
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_email_resilience_local_test}"
APP_URL="${APP_URL:-http://localhost:3000}"
export STRIPE_WEBHOOK_SECRET APP_URL

# Prefer the project-pinned CLI (frontend/node_modules/supabase); fall back to a
# system `supabase` (the setup-cli binary used in the Stripe CI job).
if [ -d "${ROOT}/frontend/node_modules/supabase" ]; then
  SUPABASE_CMD=(npx --prefix "${ROOT}/frontend" supabase)
elif command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD=(supabase)
else
  SUPABASE_CMD=(npx --prefix "${ROOT}/frontend" supabase)
fi

TEST_EMAIL="lanef-emailres@example.com"
# Edge-runtime container, used to confirm a re-serve's env actually took effect
# before we fire an event (see serve_with_env). PROJECT_ID comes from the helpers.
EDGE_CONTAINER="supabase_edge_runtime_${PROJECT_ID:-grant-trail}"
docker inspect "$EDGE_CONTAINER" >/dev/null 2>&1 && EDGE_OK=1 || EDGE_OK=0
SERVE_PID=""
SERVE_LOG=""
ENV1="$(mktemp -t emailres-env1.XXXXXX)"
ENV2="$(mktemp -t emailres-env2.XXXXXX)"
LOG1="$(mktemp -t emailres-log1.XXXXXX.log)"
LOG2="$(mktemp -t emailres-log2.XXXXXX.log)"
CUS=""
SUB=""

# ---- serve lifecycle ------------------------------------------------------

# write_env <out> <on|off>  — base Stripe env, plus Resend credentials pointed at
# an unreachable endpoint when email is "on" (RESEND_API_URL → 127.0.0.1:2, never
# listening → the fetch rejects with connection refused). Because the transport is
# fetch (not an SMTP socket), that rejection is catchable and must NOT crash the
# worker — the whole point of the isolation case.
write_env() {
  local out="$1" email="$2"
  {
    echo "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}"
    echo "STRIPE_PRICE_BASIC=${STRIPE_PRICE_BASIC}"
    echo "STRIPE_PRICE_PRO=${STRIPE_PRICE_PRO:-}"
    echo "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}"
    echo "APP_URL=${APP_URL}"
    if [ "$email" = "on" ]; then
      echo "RESEND_API_KEY=re_test_unreachable"
      echo "EMAIL_FROM=GrantTrail <receipts@send.atkasolutions.org>"
      echo "RESEND_API_URL=http://127.0.0.1:2/emails"
    fi
  } > "$out"
}

stop_serve() {
  pkill -f "functions serve" 2>/dev/null || true
  SERVE_PID=""
  sleep 2
}

# serve_with_env <env-file> <log-file> <email-mode> — (re)serve the functions,
# capturing all function logs to <log-file>, and block until stripe-webhook answers
# AND the edge-runtime container actually reflects this case's email env. The env
# check matters: the container keeps serving the PREVIOUS env/worker for a window
# after a re-serve, so an HTTP-200/400 readiness probe alone can race and fire the
# event against stale creds. We gate on the env marker for this case:
#   off -> RESEND_API_KEY must be empty   (disabled-without-creds)
#   on  -> RESEND_API_URL must point at our unreachable endpoint (isolation)
serve_with_env() {
  local envfile="$1" logfile="$2" email="${3:-off}"
  stop_serve
  ( cd "$ROOT" && "${SUPABASE_CMD[@]}" functions serve --env-file "$envfile" --no-verify-jwt ) \
    > "$logfile" 2>&1 &
  SERVE_PID=$!
  SERVE_LOG="$logfile"
  local code envok
  for _ in $(seq 1 60); do
    # A booted webhook returns 400 for a body with no signature; connection
    # refused / not-yet-ready yields 000 or 5xx.
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${FUNCTIONS_URL}/stripe-webhook" \
      -H "Content-Type: application/json" --data-raw '{}' || true)
    envok=1
    if [ "$EDGE_OK" = "1" ]; then
      if [ "$email" = "on" ]; then
        [ "$(docker exec "$EDGE_CONTAINER" printenv RESEND_API_URL 2>/dev/null)" = "http://127.0.0.1:2/emails" ] || envok=0
      else
        [ -z "$(docker exec "$EDGE_CONTAINER" printenv RESEND_API_KEY 2>/dev/null)" ] || envok=0
      fi
    fi
    if [ "$code" = "400" ] && [ "$envok" = "1" ]; then
      sleep 1   # let the worker pick up the freshly-applied env before we fire
      return 0
    fi
    sleep 2
  done
  echo "FATAL: stripe-webhook did not become ready (or env never applied); serve log:" >&2
  cat "$logfile" >&2
  return 1
}

# ---- event crafting + signing --------------------------------------------

# build_payload <evt> <cs> <sub> <cus> <email> <ts> -> compact JSON on stdout
build_payload() {
  python3 - "$1" "$2" "$3" "$4" "$5" "$6" <<'PY'
import json, sys
evt, cs, sub, cus, email, ts = sys.argv[1:7]
event = {
    "id": evt,
    "object": "event",
    "type": "checkout.session.completed",
    "api_version": "2025-02-24.acacia",
    "created": int(ts),
    "livemode": False,
    "pending_webhooks": 1,
    "request": {"id": None, "idempotency_key": None},
    "data": {"object": {
        "id": cs,
        "object": "checkout.session",
        "mode": "subscription",
        "status": "complete",
        "payment_status": "paid",
        "subscription": sub,
        "customer": cus,
        "customer_email": email,
        "customer_details": {"email": email, "name": "Lane F"},
        "amount_total": 5000,
        "amount_subtotal": 5000,
        "currency": "cad",
        "metadata": {},
        "livemode": False,
    }},
}
print(json.dumps(event, separators=(",", ":")))
PY
}

# post_event <payload> <ts> -> echoes the HTTP status. Signs "<ts>.<payload>"
# with the full STRIPE_WEBHOOK_SECRET (exactly what constructEventAsync keys on).
post_event() {
  local payload="$1" ts="$2" sig
  sig=$(python3 -c \
    "import hmac,hashlib,sys;print(hmac.new(sys.argv[1].encode(),sys.argv[2].encode(),hashlib.sha256).hexdigest())" \
    "$STRIPE_WEBHOOK_SECRET" "${ts}.${payload}")
  curl -s -o /dev/null -w "%{http_code}" -X POST "${FUNCTIONS_URL}/stripe-webhook" \
    -H "Stripe-Signature: t=${ts},v1=${sig}" \
    -H "Content-Type: application/json" \
    --data-raw "$payload"
}

# grep_log <log> <pattern> — wait briefly for a log line to surface.
grep_log() {
  local log="$1" pat="$2"
  for _ in $(seq 1 10); do
    grep -q "$pat" "$log" && return 0
    sleep 1
  done
  return 1
}

drive_checkout() {
  local evt="$1" ts cs payload
  ts="$(date +%s)"
  cs="cs_test_emailres_$(date +%s)_$RANDOM"
  payload="$(build_payload "$evt" "$cs" "$SUB" "$CUS" "$TEST_EMAIL" "$ts")"
  post_event "$payload" "$ts"
}

# ---- teardown -------------------------------------------------------------

cleanup() {
  info "email-resilience: teardown (stop serve, cancel Stripe sub, delete users)"
  stop_serve
  [ -n "$SUB" ] && cancel_subscription "$SUB"
  cleanup_test_users
  rm -f "$ENV1" "$ENV2" "$LOG1" "$LOG2"
}
trap cleanup EXIT

# ===========================================================================
# Fixture: one DB user + a REAL Stripe customer + a REAL basic subscription.
# (No forwarder runs, so the subscription is only projected to the DB when our
# hand-signed checkout.session.completed is processed below.)
# ===========================================================================
info "email-resilience: setup test user + mapped Stripe customer + subscription"
cleanup_test_users
DBUID=$(create_test_user "$TEST_EMAIL" "admin")
CUS=$(new_stripe_customer "$TEST_EMAIL")
map_customer "$DBUID" "$CUS"
SUB=$(create_subscription "$CUS" "$STRIPE_PRICE_BASIC" "basic")
info "user=$DBUID stripe_customer=$CUS subscription=$SUB"

write_env "$ENV1" off
write_env "$ENV2" on

# ===========================================================================
# CASE 1 — disabled-without-creds: Resend creds unset -> send is skipped (warning), no
# failure row, subscription + membership still synced, webhook 200.
# ===========================================================================
info "[disabled] serve with Resend creds unset"
serve_with_env "$ENV1" "$LOG1" off || { fail "[disabled] functions serve never became ready"; exit "$FAIL_COUNT"; }

EVT1="evt_test_emailres_disabled_$(date +%s)_$RANDOM"
dbx "DELETE FROM system_logs WHERE event_name='payment_confirmation_email_failure' AND metadata->>'stripe_event_id'='${EVT1}';"
dbx "DELETE FROM billing_webhook_events WHERE stripe_event_id='${EVT1}';"

CODE1=$(drive_checkout "$EVT1")
assert_http "$CODE1" "200" "[disabled] webhook returns 200"
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$SUB';" "active" "[disabled] subscriptions.status active"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "[disabled] user_membership active"
assert_eq "$(dbq "SELECT count(*) FROM system_logs WHERE event_name='payment_confirmation_email_failure' AND metadata->>'stripe_event_id'='${EVT1}';")" \
  "0" "[disabled] no payment_confirmation_email_failure row"
if grep_log "$LOG1" "skipping email send"; then
  pass "[disabled] served function logged 'skipping email send'"
else
  fail "[disabled] 'skipping email send' warning not found in serve log ($LOG1)"
fi

# ===========================================================================
# CASE 2 — failure-isolation: Resend points at an unreachable endpoint -> the send
# throws, but the error is caught; webhook still 200, subscription still synced,
# exactly one payment_confirmation_email_failure (severity 'error') row written.
# ===========================================================================
info "[isolation] re-serve with an unreachable Resend endpoint (127.0.0.1:2)"
serve_with_env "$ENV2" "$LOG2" on || { fail "[isolation] functions serve never became ready"; exit "$FAIL_COUNT"; }

EVT2="evt_test_emailres_isolation_$(date +%s)_$RANDOM"
dbx "DELETE FROM system_logs WHERE event_name='payment_confirmation_email_failure' AND metadata->>'stripe_event_id'='${EVT2}';"
dbx "DELETE FROM billing_webhook_events WHERE stripe_event_id='${EVT2}';"

CODE2=$(drive_checkout "$EVT2")
assert_http "$CODE2" "200" "[isolation] webhook still returns 200 (no Stripe retry)"
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$SUB';" "active" "[isolation] subscriptions.status still active"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "[isolation] user_membership still active"
wait_for_sql "SELECT count(*) FROM system_logs WHERE event_name='payment_confirmation_email_failure' AND severity='error' AND metadata->>'stripe_event_id'='${EVT2}';" \
  "1" "[isolation] exactly one payment_confirmation_email_failure (severity error) row tagged with the event id"

echo
echo "email-resilience: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
exit "$FAIL_COUNT"
