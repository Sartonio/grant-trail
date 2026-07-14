#!/usr/bin/env bash
#
# WS5 (c) — Billing portal + sync-my-subscription.
#
# create-billing-portal-session: returns a Stripe Billing Portal URL for the
#   authenticated user's customer.
# sync-my-subscription: the on-demand reconciliation path used when a webhook is
#   missed -- it reads Stripe (the source of truth) and rewrites the DB
#   projection. We prove it reflects upgrade / downgrade / cancel back into app
#   state EVEN WITH THE WEBHOOK FORWARDER OFF, so the assertions are attributable
#   to sync alone, not to a racing webhook.
#
# Prereqs: local Supabase up + functions served. This test deliberately does NOT
# need (and should not race) the webhook forwarder.

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/stripe_test_helpers.sh
source "${HERE}/lib/stripe_test_helpers.sh"
ensure_functions_served || exit 1

call_sync() {
  curl -s -X POST "$FUNCTIONS_URL/sync-my-subscription" \
    -H "Authorization: Bearer $1" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}'
}

info "portal-and-sync: setup"
cleanup_test_users
DBUID=$(create_test_user "lanef-sync@example.com" "admin")
TOKEN=$(get_token "lanef-sync@example.com")
CUS=$(new_stripe_customer "lanef-sync@example.com")
map_customer "$DBUID" "$CUS"

# =========================================================================
# Billing portal
# =========================================================================
info "create-billing-portal-session returns a portal url"
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-billing-portal-session" \
  -H "Authorization: Bearer $TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/billing"}')
URL=$(echo "$RESP" | json_field url)
case "$URL" in
  https://billing.stripe.com/*) pass "billing portal url issued" ;;
  *) fail "billing portal url not issued: $(echo "$RESP" | head -c 160)" ;;
esac

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNCTIONS_URL/create-billing-portal-session" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}')
assert_http "$STATUS" "401" "unauthenticated billing portal rejected"

# Self-heal: a stale/seeded per-user customer ID (no such customer in Stripe)
# must not hard-fail. The function clears the stale row and creates a fresh
# customer, then still issues a portal url. (Sentry GRANTTRAIL-FRONTEND-3.)
info "create-billing-portal-session self-heals a stale customer id"
map_customer "$DBUID" "cus_stale_does_not_exist_123"
RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-billing-portal-session" \
  -H "Authorization: Bearer $TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/billing"}')
URL=$(echo "$RESP" | json_field url)
case "$URL" in
  https://billing.stripe.com/*) pass "stale customer self-healed; portal url issued" ;;
  *) fail "stale customer not self-healed: $(echo "$RESP" | head -c 160)" ;;
esac
# The stale ID must be gone — a fresh customer replaced it.
NEWCUS=$(dbq "SELECT stripe_customer_id FROM billing_customers WHERE user_id=$DBUID;")
case "$NEWCUS" in
  cus_stale_does_not_exist_123) fail "stale customer row was not replaced" ;;
  cus_*) pass "fresh customer row written after self-heal ($NEWCUS)" ;;
  *) fail "no customer row after self-heal: '$NEWCUS'" ;;
esac
# Restore the valid customer for the sync assertions that follow.
map_customer "$DBUID" "$CUS"

# =========================================================================
# sync: brings a brand-new Stripe subscription into the DB (webhook-independent)
# =========================================================================
info "sync reconciles a new subscription (basic)"
SUB=$(create_subscription "$CUS" "$STRIPE_PRICE_BASIC" "basic")
OUT=$(call_sync "$TOKEN")
assert_eq "$(echo "$OUT" | json_field status)" "active" "sync reports active"
wait_for_sql "SELECT membership_tier FROM subscriptions WHERE stripe_subscription_id='$SUB';" "basic" "sync wrote subscription tier basic"
wait_for_sql "SELECT membership_tier FROM user_memberships WHERE user_id=$DBUID;" "basic" "sync wrote membership tier basic"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "sync membership active"

# =========================================================================
# sync: UPGRADE basic -> premium reflected back into app state
# =========================================================================
info "sync reflects upgrade basic -> premium"
ITEM=$(sapi subscriptions retrieve "$SUB" | python3 -c "import sys,json;print(json.load(sys.stdin)['items']['data'][0]['id'])")
sapi subscriptions update "$SUB" \
  -d "items[0][id]=$ITEM" -d "items[0][price]=$STRIPE_PRICE_FISCAL_AGENT" \
  -d "metadata[membership_tier]=premium" -d "proration_behavior=none" >/dev/null
call_sync "$TOKEN" >/dev/null
wait_for_sql "SELECT membership_tier FROM user_memberships WHERE user_id=$DBUID;" "premium" "sync upgrade -> membership premium"
assert_eq "$(dbq "SELECT has_premium_membership($DBUID)::text;")" "true" "sync upgrade -> has_premium true"

# =========================================================================
# sync: DOWNGRADE premium -> basic reflected back into app state
# =========================================================================
info "sync reflects downgrade premium -> basic"
ITEM=$(sapi subscriptions retrieve "$SUB" | python3 -c "import sys,json;print(json.load(sys.stdin)['items']['data'][0]['id'])")
sapi subscriptions update "$SUB" \
  -d "items[0][id]=$ITEM" -d "items[0][price]=$STRIPE_PRICE_BASIC" \
  -d "metadata[membership_tier]=basic" -d "proration_behavior=none" >/dev/null
call_sync "$TOKEN" >/dev/null
wait_for_sql "SELECT membership_tier FROM user_memberships WHERE user_id=$DBUID;" "basic" "sync downgrade -> membership basic"
assert_eq "$(dbq "SELECT has_premium_membership($DBUID)::text;")" "false" "sync downgrade -> has_premium false"
assert_eq "$(dbq "SELECT has_basic_membership($DBUID)::text;")" "true" "sync downgrade -> has_basic still true"

# =========================================================================
# sync: CANCEL reflected back into app state (membership cleared)
# =========================================================================
info "sync reflects cancellation"
cancel_subscription "$SUB"
OUT=$(call_sync "$TOKEN")
# After cancellation the only subscription is 'canceled'; sync still upserts it
# (status canceled) and marks the membership inactive.
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "false" "sync cancel -> membership inactive"
assert_eq "$(dbq "SELECT has_basic_membership($DBUID)::text;")" "false" "sync cancel -> has_basic false"

# =========================================================================
# sync: NO subscriptions at all -> membership cleared, synced:false
# =========================================================================
info "sync with no subscriptions clears membership"
NOCUS=$(sapi customers create --email "lanef-nosub@example.com" | json_field id)
map_customer "$DBUID" "$NOCUS"
OUT=$(call_sync "$TOKEN")
assert_eq "$(echo "$OUT" | json_field reason)" "no_subscriptions_found" "sync reports no_subscriptions_found"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "false" "sync no-subs -> membership inactive"

# =========================================================================
# TENANT-OWNED: a NON-PAYER admin opens the portal for the tenant customer.
#   The tenant has a tenant-owned billing customer (mapped directly here); a
#   second admin who never paid must still get a portal URL for the ORG plan.
# =========================================================================
info "tenant-owned: non-payer admin opens the org billing portal"
PAYER_ID=$(create_test_user "lanef-org-payer@example.com" "admin")
TENANT_ID=$(tenant_id_for "$PAYER_ID")
NONPAYER_ID=$(create_test_user_in_tenant "lanef-org-nonpayer@example.com" "$TENANT_ID" "admin")
NONPAYER_TOKEN=$(get_token "lanef-org-nonpayer@example.com")
TCUS=$(new_stripe_customer "lanef-org@example.com")
map_tenant_customer "$TENANT_ID" "$TCUS"

RESP=$(curl -s -X POST "$FUNCTIONS_URL/create-billing-portal-session" \
  -H "Authorization: Bearer $NONPAYER_TOKEN" -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"returnPath":"/billing"}')
URL=$(echo "$RESP" | json_field url)
case "$URL" in
  https://billing.stripe.com/*) pass "non-payer admin issued a portal url for the tenant customer" ;;
  *) fail "non-payer admin portal url not issued: $(echo "$RESP" | head -c 160)" ;;
esac

# =========================================================================
# TENANT-OWNED: sync-my-subscription reconciles the tenant-owned subscription.
#   Any admin's sync must refresh the ORG plan: tenant_memberships + the
#   tenant's accepts_sponsorships flag.
# =========================================================================
info "tenant-owned: sync reconciles the org subscription"
TSUB=$(create_tenant_subscription "$TCUS" "$STRIPE_PRICE_FISCAL_AGENT" "$TENANT_ID" "$PAYER_ID")
OUT=$(call_sync "$NONPAYER_TOKEN")
# tenant_synced is reported when the tenant leg had something to reconcile.
assert_eq "$(echo "$OUT" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("tenant_synced") or {}).get("status",""))')" "active" "sync reports tenant sub active"
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$TSUB';" "active" "sync wrote tenant-owned subscription"
wait_for_sql "SELECT tenant_id::text FROM subscriptions WHERE stripe_subscription_id='$TSUB';" "$TENANT_ID" "tenant-owned subscription keyed by tenant_id"
wait_for_sql "SELECT is_active::text FROM tenant_memberships WHERE tenant_id=$TENANT_ID;" "true" "sync wrote tenant_memberships active"
wait_for_sql "SELECT membership_tier FROM tenant_memberships WHERE tenant_id=$TENANT_ID;" "premium" "tenant membership tier premium"
wait_for_sql "SELECT accepts_sponsorships::text FROM tenants WHERE id=$TENANT_ID;" "true" "tenant accepts_sponsorships set by sync"

# ---- teardown ------------------------------------------------------------
info "portal-and-sync: teardown"
cancel_subscription "$SUB"
cancel_subscription "$TSUB"
cleanup_test_users

echo
echo "portal-and-sync: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
exit "$FAIL_COUNT"
