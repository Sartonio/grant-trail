#!/usr/bin/env bash
#
# Shared helpers for the Stripe payment-flow integration tests (WS5 / Lane F).
#
# These tests drive GrantTrail's billing Edge Functions against Stripe TEST mode.
# Stripe is the source of truth; the DB tables `subscriptions` / `user_memberships`
# are a webhook-synced projection. We prove the real webhook loop by:
#   * creating real Stripe customers/subscriptions via the Stripe API,
#   * mapping each customer to a DB user row in `billing_customers`,
#   * letting `stripe listen --forward-to` deliver the authentic, signed events
#     to the local stripe-webhook function, and
#   * polling the DB until it reaches (and holds) the expected end-state.
#
# Nothing here touches production: TEST-mode keys only, local Supabase only.
#
# Required env (sourced from supabase/functions/.env by the runner):
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
#   STRIPE_PRICE_BASIC, STRIPE_PRICE_FISCAL_AGENT_ACCESS, APP_URL

set -uo pipefail

# ---- configuration -------------------------------------------------------

API_URL="${API_URL:-http://127.0.0.1:54321}"
FUNCTIONS_URL="${API_URL}/functions/v1"
PROJECT_ID="grant-trail"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

# Local Supabase ships fixed demo keys (see `npx supabase status`).
ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"
JWT_SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"

# How long to wait for an async webhook to land (seconds).
WAIT_TIMEOUT="${WAIT_TIMEOUT:-40}"

# ---- counters ------------------------------------------------------------

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS  $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL  $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo "----  $*"; }

# ---- stripe API wrappers -------------------------------------------------

# Strip ANSI colour codes so output is JSON-parseable.
_strip_ansi() { sed $'s/\x1b\\[[0-9;]*m//g'; }

# Run a stripe CLI command with the test key; emit clean stdout.
sapi() { stripe "$@" --api-key "$STRIPE_SECRET_KEY" 2>/dev/null | _strip_ansi; }

# Extract a top-level JSON string field from stdin.
json_field() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',''))"; }

# ---- database helpers ----------------------------------------------------

# Run a SQL query, return tuples-only (-tA) trimmed output.
dbq() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tA -c "$1"; }

# Run SQL with no expectation of a result row (DDL/DML).
dbx() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q -c "$1" >/dev/null; }

# ---- fixture management --------------------------------------------------
#
# We create a dedicated test user (auth.users + public.users) so the tests are
# isolated from seed data and repeatable. The DB user id is echoed.

TEST_PASSWORD="password123"

# create_test_user <email> <role>  -> echoes the public.users.id (integer)
#
# The auth user is created via the GoTrue admin API (a raw auth.users INSERT
# omits columns GoTrue needs and breaks token issuance), then linked to a
# public.users row.
#
# Tenant choice matters for billing: admins must live in a *managed* tenant that
# is NOT exempt, so subscription gating actually applies. `bright-horizons` is a
# managed, require_subscription=true, non-tfac tenant => its admins are billable
# (is_membership_exempt = false). Grantees go in a self-service tenant.
create_test_user() {
  local email="$1" role="${2:-admin}" slug
  if [ "$role" == "admin" ] || [ "$role" == "super_admin" ]; then
    slug="bright-horizons"
  else
    slug="lopez-consulting"
  fi
  local uuid
  uuid=$(curl -s -X POST "${API_URL}/auth/v1/admin/users" \
    -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${TEST_PASSWORD}\",\"email_confirm\":true}" \
    | json_field id)
  dbx "INSERT INTO users (user_id, tenant_id, firstname, lastname, organization_name, email, phone_number, role)
       VALUES ('${uuid}', (SELECT id FROM tenants WHERE slug='${slug}'), 'Lane', 'F', 'Lane F Test Org', '${email}', '555-000-0000', '${role}');"
  dbq "SELECT id FROM users WHERE email = '${email}';"
}

# get_token <email> -> echoes a real GoTrue access token for the user
get_token() {
  curl -s -X POST "${API_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"${TEST_PASSWORD}\"}" | json_field access_token
}

# Remove all Lane-F test fixtures (DB rows + GoTrue users).
cleanup_test_users() {
  local ids
  ids=$(dbq "SELECT user_id FROM users WHERE email LIKE 'lanef-%@example.com';")
  dbx "DELETE FROM users WHERE email LIKE 'lanef-%@example.com';"
  local u
  for u in $ids; do
    curl -s -o /dev/null -X DELETE "${API_URL}/auth/v1/admin/users/${u}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}"
  done
}

# Map a Stripe customer id to a DB user id in billing_customers.
map_customer() {
  local user_id="$1" customer_id="$2"
  dbx "INSERT INTO billing_customers (user_id, stripe_customer_id) VALUES (${user_id}, '${customer_id}')
       ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id;"
}

# auth uuid for a public.users.id
auth_uuid_for() { dbq "SELECT user_id FROM users WHERE id = ${1};"; }

# ---- stripe customer + subscription scaffolding --------------------------

# new_stripe_customer <email> -> echoes cus_xxx with a default test card attached
new_stripe_customer() {
  local email="$1" cus pm
  cus=$(sapi customers create --email "$email" | json_field id)
  pm=$(sapi payment_methods create --type card -d "card[token]=tok_visa" | json_field id)
  sapi payment_methods attach "$pm" -d customer="$cus" >/dev/null
  sapi customers update "$cus" -d "invoice_settings[default_payment_method]=$pm" >/dev/null
  echo "$cus"
}

# Attach a card that fails on renewal (so we can drive past_due / payment_failed).
attach_failing_card() {
  local cus="$1" pm
  # tok_chargeCustomerFail: charges decline at invoice time.
  pm=$(sapi payment_methods create --type card -d "card[token]=tok_chargeCustomerFail" | json_field id)
  sapi payment_methods attach "$pm" -d customer="$cus" >/dev/null
  sapi customers update "$cus" -d "invoice_settings[default_payment_method]=$pm" >/dev/null
}

# create_subscription <cus> <price> <tier> -> echoes sub_xxx
create_subscription() {
  local cus="$1" price="$2" tier="$3"
  sapi subscriptions create -d customer="$cus" -d "items[0][price]=$price" \
    -d "metadata[membership_tier]=$tier" -d "metadata[user_id]=0" \
    | json_field id
}

# cancel_subscription <sub> -- immediate cancellation (fires
# customer.subscription.deleted). The CLI's `subscriptions cancel` subcommand
# emits no JSON here, so we DELETE the resource directly.
cancel_subscription() {
  stripe delete "/v1/subscriptions/$1" --api-key "$STRIPE_SECRET_KEY" --confirm >/dev/null 2>&1
}

# ---- assertions ----------------------------------------------------------

# wait_for_sql <sql> <expected> <label>
# Polls <sql> until its trimmed result equals <expected>, or times out.
wait_for_sql() {
  local sql="$1" expected="$2" label="$3"
  local deadline=$((SECONDS + WAIT_TIMEOUT)) actual
  while [ $SECONDS -lt $deadline ]; do
    actual=$(dbq "$sql")
    if [ "$actual" == "$expected" ]; then
      pass "$label (=$expected)"
      return 0
    fi
    sleep 1
  done
  fail "$label  expected='$expected' got='$(dbq "$sql")'"
  return 1
}

# assert_eq <actual> <expected> <label>
assert_eq() {
  if [ "$1" == "$2" ]; then pass "$3 (=$2)"; else fail "$3 expected='$2' got='$1'"; fi
}

# assert_http <status> <expected> <label>
assert_http() {
  if [ "$1" == "$2" ]; then pass "$3 (HTTP $2)"; else fail "$3 expected HTTP $2 got $1"; fi
}
