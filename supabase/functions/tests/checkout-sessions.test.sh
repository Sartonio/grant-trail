#!/usr/bin/env bash
#
# WS5 (b) — Checkout-session Edge Function.
#
# Proves the single `create-checkout-session` function, for BOTH tiers, returns a
# usable Stripe Checkout Session URL and wires the success/cancel return paths
# correctly; that the session is created in `subscription` mode against the price
# selected from the feature key (basic_membership -> STRIPE_PRICE_BASIC / tier
# 'basic'; everything else -> STRIPE_PRICE_FISCAL_AGENT / tier 'premium'); and
# that a `billing_customers` row is created/reused for the authenticated user.
# Auth and input-validation guards are checked too (no token => 401-style
# Unauthorized from the platform-root auth guard, before the function's own 400;
# wrong feature key => 400).
#
# Function exercised:
#   create-checkout-session   (both tiers, chosen by featureKey)
#
# Prereqs: local Supabase up + functions served with supabase/functions/.env.
# Run via run-all.sh (which also serves functions), or standalone after serving.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/stripe_test_helpers.sh
source "${HERE}/lib/stripe_test_helpers.sh"
ensure_functions_served || exit 1

info "checkout-sessions: setup"
cleanup_test_users
ADMIN_ID=$(create_test_user "lanef-checkout-admin@example.com" "admin")
ADMIN_TOKEN=$(get_token "lanef-checkout-admin@example.com")

# session_id_from_resp lives in lib/stripe_test_helpers.sh (sourced above).
# The single price id on the session's (expanded) line items.
session_price_id() {
  python3 -c "import sys,json; s=json.load(sys.stdin); items=s.get('line_items',{}).get('data',[]); print(items[0]['price']['id'] if items else '')"
}

# ---- basic tier (featureKey=basic_membership) ----------------------------

info "create-checkout-session (basic tier, success+cancel paths)"
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/billing","featureKey":"basic_membership"}')
CS=$(echo "$RESP" | session_id_from_resp)
if [ -n "$CS" ]; then
  pass "basic checkout returns a Stripe Checkout Session url"
  SESS=$(sapi checkout sessions retrieve "$CS" --expand line_items)
  assert_eq "$(echo "$SESS" | json_field mode)" "subscription" "basic session mode=subscription"
  TIER=$(echo "$SESS" | python3 -c "import sys,json; s=json.load(sys.stdin); print(s.get('metadata',{}).get('membership_tier',''))")
  assert_eq "$TIER" "basic" "basic session metadata.membership_tier"
  assert_eq "$(echo "$SESS" | session_price_id)" "$STRIPE_PRICE_BASIC" "basic session priced at STRIPE_PRICE_BASIC"
  SUCCESS=$(echo "$SESS" | json_field success_url)
  CANCEL=$(echo "$SESS" | json_field cancel_url)
  case "$SUCCESS" in *"/billing?checkout=success") pass "basic success_url -> returnPath?checkout=success";; *) fail "basic success_url '$SUCCESS'";; esac
  case "$CANCEL"  in *"/billing?checkout=canceled") pass "basic cancel_url -> returnPath?checkout=canceled";; *) fail "basic cancel_url '$CANCEL'";; esac
else
  fail "basic checkout did not return a session url: $(echo "$RESP" | head -c 160)"
fi

assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE user_id=$ADMIN_ID;")" "1" "billing_customers row created for caller"

# ---- premium tier (featureKey=premium_membership) ------------------------

info "create-checkout-session (premium tier, success+cancel paths)"
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/upgrade","featureKey":"premium_membership"}')
CS=$(echo "$RESP" | session_id_from_resp)
if [ -n "$CS" ]; then
  pass "premium checkout returns a Stripe Checkout Session url"
  SESS=$(sapi checkout sessions retrieve "$CS" --expand line_items)
  assert_eq "$(echo "$SESS" | json_field mode)" "subscription" "premium session mode=subscription"
  TIER=$(echo "$SESS" | python3 -c "import sys,json; s=json.load(sys.stdin); print(s.get('metadata',{}).get('membership_tier',''))")
  assert_eq "$TIER" "premium" "premium session metadata.membership_tier"
  assert_eq "$(echo "$SESS" | session_price_id)" "$STRIPE_PRICE_FISCAL_AGENT" "premium session priced at STRIPE_PRICE_FISCAL_AGENT"
  SUCCESS=$(echo "$SESS" | json_field success_url)
  case "$SUCCESS" in *"/upgrade?checkout=success") pass "premium success_url -> returnPath?checkout=success";; *) fail "premium success_url '$SUCCESS'";; esac
else
  fail "premium checkout did not return a session url: $(echo "$RESP" | head -c 160)"
fi

# The second call must REUSE the billing_customers row, not create a duplicate
# (unique on user_id; a second insert would error).
assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE user_id=$ADMIN_ID;")" "1" "billing_customers reused across checkout calls"

# ---- default feature key -------------------------------------------------

# No featureKey => defaults to admin_membership (premium). Proves the default
# path still routes to the premium price, not a 400.
info "create-checkout-session (no featureKey -> admin_membership default)"
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/upgrade"}')
CS=$(echo "$RESP" | session_id_from_resp)
if [ -n "$CS" ]; then
  SESS=$(sapi checkout sessions retrieve "$CS" --expand line_items)
  assert_eq "$(echo "$SESS" | session_price_id)" "$STRIPE_PRICE_FISCAL_AGENT" "default (no featureKey) priced at STRIPE_PRICE_FISCAL_AGENT"
else
  fail "default checkout did not return a session url: $(echo "$RESP" | head -c 160)"
fi

# ---- auth + validation guards -------------------------------------------

info "guards: unauthenticated + invalid input"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}')
assert_http "$STATUS" "401" "unauthenticated checkout rejected"

# Invalid feature key => 400 ValidationError.
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"featureKey":"not_a_real_key"}')
assert_http "$STATUS" "400" "invalid featureKey rejected"

# ---- teardown ------------------------------------------------------------
cleanup_test_users

echo
echo "checkout-sessions: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
exit "$FAIL_COUNT"
