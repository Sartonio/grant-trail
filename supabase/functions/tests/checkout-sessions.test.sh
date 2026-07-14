#!/usr/bin/env bash
#
# WS5 (b) — Checkout-session Edge Function.
#
# Proves the single `create-checkout-session` function, for BOTH tiers, returns a
# usable Stripe Checkout Session URL and wires the success/cancel return paths
# correctly; that the session is created in `subscription` mode against the price
# selected from the feature key (basic_membership -> STRIPE_PRICE_BASIC / tier
# 'basic'; everything else -> STRIPE_PRICE_FISCAL_AGENT / tier 'premium'); and
# that a `billing_customers` row is created/reused per owner — per-USER for the
# basic tier, per-TENANT (user_id NULL) for the tenant-owned premium tier.
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

# Premium checkout is TENANT-owned: it must not touch the per-user row created
# by the basic call, and it creates exactly one tenant-owned row for the org.
assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE user_id=$ADMIN_ID;")" "1" "per-user billing_customers row untouched by premium checkout"
assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$ADMIN_ID);")" "1" "tenant-owned billing_customers row created once for premium"

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

# ---- tenant-owned premium: customer reuse + dedup across two admins ------
#
# Premium ("Fiscal Agents Plan") is TENANT-owned: the checkout fn routes premium
# to getOrCreateStripeCustomerForTenant, which creates ONE billing_customers row
# keyed on tenant_id (user_id NULL). A second admin of the SAME tenant must reuse
# that Stripe customer (no second row — partial unique index) and, once the org
# has a live sub, hit the alreadyActive redirect.

info "tenant-owned premium: two admins of one tenant"
# Admin #1 mints a fresh managed tenant; admin #2 joins the SAME tenant.
ADMIN1_ID=$(create_test_user "lanef-tenant-admin1@example.com" "admin")
ADMIN1_TOKEN=$(get_token "lanef-tenant-admin1@example.com")
TENANT_ID=$(tenant_id_for "$ADMIN1_ID")
ADMIN2_ID=$(create_test_user_in_tenant "lanef-tenant-admin2@example.com" "$TENANT_ID" "admin")
ADMIN2_TOKEN=$(get_token "lanef-tenant-admin2@example.com")

# Admin #1 premium checkout -> a tenant-owned billing_customers row (user_id NULL).
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN1_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/upgrade","featureKey":"premium_membership"}')
CS=$(echo "$RESP" | session_id_from_resp)
if [ -n "$CS" ]; then
  pass "admin#1 premium checkout returns a session url"
  SESS=$(sapi checkout sessions retrieve "$CS")
  TENANT_META=$(echo "$SESS" | python3 -c "import sys,json; s=json.load(sys.stdin); print(s.get('metadata',{}).get('tenant_id',''))")
  assert_eq "$TENANT_META" "$TENANT_ID" "premium session metadata.tenant_id stamped"
else
  fail "admin#1 premium checkout did not return a session url: $(echo "$RESP" | head -c 160)"
fi
assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE tenant_id=$TENANT_ID;")" "1" "tenant-owned billing_customers row created"
assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE tenant_id=$TENANT_ID AND user_id IS NULL;")" "1" "tenant-owned row has NULL user_id (one-owner CHECK)"
TENANT_CUS=$(dbq "SELECT stripe_customer_id FROM billing_customers WHERE tenant_id=$TENANT_ID;")

# Admin #2 premium checkout -> reuses the SAME Stripe customer, no second row.
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN2_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/upgrade","featureKey":"premium_membership"}')
CS=$(echo "$RESP" | session_id_from_resp)
if [ -n "$CS" ]; then
  SESS=$(sapi checkout sessions retrieve "$CS")
  assert_eq "$(echo "$SESS" | json_field customer)" "$TENANT_CUS" "admin#2 reuses the tenant Stripe customer"
else
  fail "admin#2 premium checkout did not return a session url: $(echo "$RESP" | head -c 160)"
fi
assert_eq "$(dbq "SELECT count(*) FROM billing_customers WHERE tenant_id=$TENANT_ID;")" "1" "no second tenant billing_customers row (partial unique index)"

# Give the tenant a LIVE subscription, then admin #2's checkout must dedup to the
# alreadyActive redirect (the idempotency check runs against the tenant customer).
info "tenant-owned premium: alreadyActive dedup across admins"
# the function-minted tenant customer has no card, so the sub would otherwise stay
# incomplete (never charged) and never go live to trip the dedup
attach_default_card "$TENANT_CUS"
TSUB=$(create_tenant_subscription "$TENANT_CUS" "$STRIPE_PRICE_FISCAL_AGENT" "$TENANT_ID" "$ADMIN1_ID")
# poll Stripe until the sub is active so the idempotency check sees it
for _ in $(seq 1 20); do
  [ "$(sapi subscriptions retrieve "$TSUB" | json_field status)" == "active" ] && break
  sleep 1
done
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN2_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/upgrade","featureKey":"premium_membership"}')
assert_eq "$(echo "$RESP" | python3 -c 'import sys,json; print(str(json.load(sys.stdin).get("alreadyActive","")).lower())')" "true" "admin#2 gets alreadyActive redirect (dedup across admins)"
cancel_subscription "$TSUB"

# DB-entitlement dedup: an org whose tenant_memberships row is active (e.g. a
# grandfathered/legacy premium living on a per-user Stripe customer the tenant
# customer can't see) must hit alreadyActive WITHOUT any live sub on the tenant
# Stripe customer. Force the entitlement state directly, then reset it.
info "tenant-owned premium: DB-entitlement dedup (legacy/mirrored premium)"
dbq "INSERT INTO tenant_memberships (tenant_id, membership_tier, is_active, ends_at, source)
     VALUES ($TENANT_ID, 'premium', true, now() + interval '30 days', 'manual')
     ON CONFLICT (tenant_id) DO UPDATE SET is_active=true, ends_at=now() + interval '30 days';" >/dev/null
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN2_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/upgrade","featureKey":"premium_membership"}')
assert_eq "$(echo "$RESP" | python3 -c 'import sys,json; print(str(json.load(sys.stdin).get("alreadyActive","")).lower())')" "true" "entitled org (DB membership, no tenant-customer sub) gets alreadyActive"
dbq "UPDATE tenant_memberships SET is_active=false WHERE tenant_id=$TENANT_ID;" >/dev/null

# Lapsed org plan must NOT dedup: checkout proceeds so the org can resubscribe.
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-checkout-session" \
  -H "Authorization: Bearer $ADMIN2_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/upgrade","featureKey":"premium_membership"}')
CS=$(echo "$RESP" | session_id_from_resp)
if [ -n "$CS" ]; then
  pass "lapsed org plan can open a fresh premium checkout (resubscribe)"
else
  fail "lapsed org plan could not reopen checkout: $(echo "$RESP" | head -c 160)"
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
