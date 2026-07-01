#!/usr/bin/env bash
#
# Self-test for issue #4: each billing Edge Function must persist a row to
# public.system_logs (severity = 'critical') when it fails unexpectedly.
#
# Strategy: an *unauthenticated* call now short-circuits to HTTP 401 via
# AuthError -- BEFORE the failure-logging path -- so it can't exercise this
# feature. Instead we sign in as a seeded user (real access token) and let the
# call fail downstream at the first Stripe API call: CI serves the functions
# with a dummy STRIPE_SECRET_KEY, so Stripe rejects it with a generic error
# that lands in the catch block, writes the critical system_logs row, and maps
# to HTTP 400. We assert one such row exists per function.
#
# Prerequisites (local only -- never touches production):
#   1. npm run db:start            # local Supabase stack (+ seed users)
#   2. cp supabase/.env.example supabase/.env   # dummy Stripe values are fine
#   3. npx supabase functions serve --env-file supabase/.env   # in another shell
#
# Run:  bash supabase/functions/tests/system-logs-failure.test.sh

set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:54321}"
PROJECT_ID="grant-trail"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

# Local Supabase ships a fixed demo anon key (see `npx supabase status`).
ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"

# A seeded grantee (see supabase/seed.sql). Real access token -> passes auth so
# the request reaches the Stripe call that fails under the dummy key.
TEST_EMAIL="${TEST_EMAIL:-maria.smith@example.com}"
TEST_PASSWORD="${TEST_PASSWORD:-password123}"

ACCESS_TOKEN=$(curl -s -X POST "${API_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}" \
  | grep -o '"access_token":"[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "FAIL  could not obtain access token for ${TEST_EMAIL} (is the stack seeded?)"
  exit 1
fi

# function name : expected event_name
declare -A CASES=(
  [create-checkout-session]=create_checkout_session_failure
  [create-billing-portal-session]=create_billing_portal_session_failure
  [sync-my-subscription]=sync_my_subscription_failure
)

fail=0
for fn in "${!CASES[@]}"; do
  event_name="${CASES[$fn]}"

  # Drop any prior rows for this event so the assertion is deterministic.
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q \
    -c "DELETE FROM system_logs WHERE event_name = '${event_name}';" >/dev/null

  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}/functions/v1/${fn}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "apikey: ${ANON_KEY}" \
    -H "Content-Type: application/json" -d '{}')

  count=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tA \
    -c "SELECT count(*) FROM system_logs WHERE event_name = '${event_name}' AND severity = 'critical';")

  if [[ "$status" == "400" && "$count" -ge 1 ]]; then
    echo "PASS  ${fn} -> HTTP ${status}, ${count} '${event_name}' row(s)"
  else
    echo "FAIL  ${fn} -> HTTP ${status}, ${count} '${event_name}' row(s)"
    fail=1
  fi
done

exit "$fail"
