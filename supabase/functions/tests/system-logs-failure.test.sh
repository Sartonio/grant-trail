#!/usr/bin/env bash
#
# Self-test for issue #4: each billing Edge Function must persist a row to
# public.system_logs (severity = 'critical') when it fails.
#
# Strategy: hitting a function with the anon key (instead of a real user token)
# makes requireAuthenticatedProfile() throw "Unauthorized", which lands in the
# catch block -- the exact failure-logging path we added. We then assert one
# system_logs row exists per function with the expected distinct event_name.
#
# Prerequisites (local only -- never touches production):
#   1. npm run db:start            # local Supabase stack
#   2. cp supabase/.env.example supabase/.env   # dummy values are fine
#   3. npx supabase functions serve --env-file supabase/.env   # in another shell
#
# Run:  bash supabase/functions/tests/system-logs-failure.test.sh

set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:54321}"
PROJECT_ID="grant-trail"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

# Local Supabase ships a fixed demo anon key (see `npx supabase status`).
ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"

# function name : expected event_name
declare -A CASES=(
  [create-checkout-session]=create_checkout_session_failure
  [create-billing-portal-session]=create_billing_portal_session_failure
  [create-basic-membership-checkout-session]=create_basic_membership_checkout_session_failure
  [sync-my-subscription]=sync_my_subscription_failure
)

fail=0
for fn in "${!CASES[@]}"; do
  event_name="${CASES[$fn]}"

  # Drop any prior rows for this event so the assertion is deterministic.
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q \
    -c "DELETE FROM system_logs WHERE event_name = '${event_name}';" >/dev/null

  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}/functions/v1/${fn}" \
    -H "Authorization: Bearer ${ANON_KEY}" -H "apikey: ${ANON_KEY}" \
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
