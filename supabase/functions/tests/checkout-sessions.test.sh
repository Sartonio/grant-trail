#!/usr/bin/env bash
#
# WS5 (b) — Checkout-session Edge Functions.
#
# Proves both checkout functions, for both tiers, return a usable Stripe Checkout
# Session URL and wire the success/cancel return paths correctly; that the
# session is created in `subscription` mode against the correct price; and that a
# `billing_customers` row is created/reused for the authenticated user. Auth and
# input-validation guards are checked too (no token => 401-style Unauthorized;
# wrong feature key => 400).
#
# Functions exercised:
#   create-basic-membership-checkout-session  (basic tier)
#   create-checkout-session                   (fiscal-agent / premium tier)
#
# Prereqs: local Supabase up + functions served with supabase/functions/.env.
# Run via run-all.sh (which also serves functions), or standalone after serving.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/stripe_test_helpers.sh
source "${HERE}/lib/stripe_test_helpers.sh"

info "checkout-sessions: setup"
cleanup_test_users
ADMIN_ID=$(create_test_user "lanef-checkout-admin@example.com" "admin")
ADMIN_TOKEN=$(get_token "lanef-checkout-admin@example.com")

# Pull the session id out of a checkout URL (…/c/pay/cs_test_xxx#...) and inspect
# it via the Stripe API so we assert real session attributes, not just a 200.
session_id_from_resp() {
  python3 -c "import sys,json,re; u=json.load(sys.stdin).get('url','') or ''; m=re.search(r'(cs_test_[A-Za-z0-9]+)',u); print(m.group(1) if m else '')"
}

# ---- basic tier ----------------------------------------------------------

info "create-basic-membership-checkout-session (basic, success+cancel paths)"
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-basic-membership-checkout-session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/billing"}')
CS=$(echo "$RESP" | session_id_from_resp)
if [ -n "$CS" ]; then
  pass "basic checkout returns a Stripe Checkout Session url"
  SESS=$(sapi checkout sessions retrieve "$CS")
  assert_eq "$(echo "$SESS" | json_field mode)" "subscription" "basic session mode=subscription"
  PRICE=$(echo "$SESS" | python3 -c "import sys,json; s=json.load(sys.stdin); print(s.get('metadata',{}).get('membership_tier',''))")
  assert_eq "$PRICE" "basic" "basic session metadata.membership_tier"
  SUCCESS=$(echo "$SESS" | json_field success_url)
  CANCEL=$(echo "$SESS" | json_field cancel_url)
  case "$SUCCESS" in *"/billing?checkout=success") pass "basic success_url -> returnPath?checkout=success";; *) fail "basic success_url '$SUCCESS'";; esac
  case "$CANCEL"  in *"/billing?checkout=canceled") pass "basic cancel_url -> returnPath?checkout=canceled";; *) fail "basic cancel_url '$CANCEL'";; esac
else
  fail "basic checkout did not return a session url: $(echo "$RESP" | head -c 160)"
fi

assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE user_id=$ADMIN_ID;")" "1" "billing_customers row created for caller"

# ---- fiscal-agent / premium tier ----------------------------------------

info "create-checkout-session (fiscal-agent / premium, success+cancel paths)"
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/upgrade","featureKey":"premium_membership"}')
CS=$(echo "$RESP" | session_id_from_resp)
if [ -n "$CS" ]; then
  pass "fiscal checkout returns a Stripe Checkout Session url"
  SESS=$(sapi checkout sessions retrieve "$CS")
  assert_eq "$(echo "$SESS" | json_field mode)" "subscription" "fiscal session mode=subscription"
  TIER=$(echo "$SESS" | python3 -c "import sys,json; s=json.load(sys.stdin); print(s.get('metadata',{}).get('membership_tier',''))")
  assert_eq "$TIER" "premium" "fiscal session metadata.membership_tier"
  SUCCESS=$(echo "$SESS" | json_field success_url)
  case "$SUCCESS" in *"/upgrade?checkout=success") pass "fiscal success_url -> returnPath?checkout=success";; *) fail "fiscal success_url '$SUCCESS'";; esac
else
  fail "fiscal checkout did not return a session url: $(echo "$RESP" | head -c 160)"
fi

# The second call must REUSE the billing_customers row, not create a duplicate
# (unique on user_id; a second insert would error).
assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE user_id=$ADMIN_ID;")" "1" "billing_customers reused across checkout calls"

# ---- auth + validation guards -------------------------------------------

info "guards: unauthenticated + invalid input"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}')
assert_http "$STATUS" "400" "unauthenticated checkout rejected"

# Invalid feature key for the fiscal function => 400 ValidationError.
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"featureKey":"not_a_real_key"}')
assert_http "$STATUS" "400" "invalid featureKey rejected"

# The basic function only accepts basic_membership; a premium key must 400.
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNCTIONS_URL/create-basic-membership-checkout-session" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"featureKey":"premium_membership"}')
assert_http "$STATUS" "400" "basic function rejects premium featureKey"

# ---- teardown ------------------------------------------------------------
cleanup_test_users

echo
echo "checkout-sessions: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
exit "$FAIL_COUNT"
