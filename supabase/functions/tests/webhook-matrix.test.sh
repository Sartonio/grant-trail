#!/usr/bin/env bash
#
# WS5 (a) + (d) — Webhook matrix, idempotency, lapse->reactivate, waiver.
#
# Stripe is the source of truth; `subscriptions` / `user_memberships` are a
# webhook-synced projection. This test drives REAL Stripe events through the
# authentic loop -- a `stripe listen --forward-to` forwarder delivers signed
# events to the stripe-webhook function -- and asserts the resulting DB
# end-state for each event in the lifecycle.
#
# REQUIRES a running `stripe listen --forward-to <stripe-webhook>` forwarder.
# run-all.sh starts one; standalone, start it yourself first.
#
# End-state matrix proven (membership.is_active is true for active/trialing/
# past_due, false otherwise -- see upsertSubscriptionFromStripe):
#
#   Stripe event                         subscriptions.status   user_memberships.is_active
#   ----------------------------------   --------------------   --------------------------
#   checkout.session.completed (basic)   active                 true   (tier=basic)
#   customer.subscription.created        active                 true
#   customer.subscription.updated(→prem) active                 true   (tier=premium)
#   invoice.payment_failed / past_due    past_due               true   (read-only grace)
#   customer.subscription.deleted        canceled               false

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/stripe_test_helpers.sh
source "${HERE}/lib/stripe_test_helpers.sh"

# Find the Stripe event id of a given type for a given subscription id.
event_id_for() {
  local etype="$1" subid="$2"
  sapi events list --limit 50 | python3 -c "
import sys,json
etype,subid=('$etype','$subid')
for e in json.load(sys.stdin)['data']:
    obj=e['data']['object']
    oid=obj.get('id') or obj.get('subscription')
    if e['type']==etype and (oid==subid or obj.get('subscription')==subid):
        print(e['id']); break"
}

require_forwarder() {
  if ! pgrep -af "stripe listen" >/dev/null 2>&1; then
    echo "FATAL: no 'stripe listen --forward-to' forwarder running. Start one or use run-all.sh." >&2
    exit 2
  fi
}
require_forwarder

info "webhook-matrix: setup test user + mapped Stripe customer"
cleanup_test_users
DBUID=$(create_test_user "lanef-webhook@example.com" "admin")
CUS=$(new_stripe_customer "lanef-webhook@example.com")
map_customer "$DBUID" "$CUS"
info "user=$DBUID stripe_customer=$CUS"

# =========================================================================
# 1. customer.subscription.created  (basic) -> active / member active / basic
#    The .created event also exercises the checkout.session.completed code path
#    (both call upsertSubscriptionFromStripe with the same subscription object).
# =========================================================================
info "[created] basic subscription"
SUB=$(create_subscription "$CUS" "$STRIPE_PRICE_BASIC" "basic")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$SUB';" "active" "[created] subscriptions.status"
wait_for_sql "SELECT membership_tier FROM subscriptions WHERE stripe_subscription_id='$SUB';" "basic" "[created] subscriptions.tier"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "[created] membership active"
wait_for_sql "SELECT membership_tier FROM user_memberships WHERE user_id=$DBUID;" "basic" "[created] membership tier basic"

# =========================================================================
# 2. IDEMPOTENCY -- resend the SAME created event; DB must be byte-identical.
#    (Dedup key: billing_webhook_events.stripe_event_id.)
# =========================================================================
info "[idempotency] resend customer.subscription.created"
EVID=$(event_id_for "customer.subscription.created" "$SUB")
if [ -z "$EVID" ]; then
  fail "[idempotency] could not locate created event id"
else
  BEFORE=$(dbq "SELECT id,status,updated_at FROM subscriptions WHERE stripe_subscription_id='$SUB';")
  MBEFORE=$(dbq "SELECT id,is_active,updated_at FROM user_memberships WHERE user_id=$DBUID;")
  sapi events resend "$EVID" >/dev/null
  sleep 5
  assert_eq "$(dbq "SELECT count(*) FROM billing_webhook_events WHERE stripe_event_id='$EVID';")" "1" "[idempotency] one webhook_events row for event"
  assert_eq "$(dbq "SELECT count(*) FROM subscriptions WHERE stripe_subscription_id='$SUB';")" "1" "[idempotency] one subscriptions row"
  assert_eq "$(dbq "SELECT id,status,updated_at FROM subscriptions WHERE stripe_subscription_id='$SUB';")" "$BEFORE" "[idempotency] subscriptions row unchanged"
  assert_eq "$(dbq "SELECT id,is_active,updated_at FROM user_memberships WHERE user_id=$DBUID;")" "$MBEFORE" "[idempotency] membership row unchanged"
fi

# =========================================================================
# 3. customer.subscription.updated (upgrade basic -> premium/fiscal-agent)
# =========================================================================
info "[updated] upgrade basic -> premium (fiscal-agent)"
ITEM=$(sapi subscriptions retrieve "$SUB" | python3 -c "import sys,json;print(json.load(sys.stdin)['items']['data'][0]['id'])")
sapi subscriptions update "$SUB" \
  -d "items[0][id]=$ITEM" -d "items[0][price]=$STRIPE_PRICE_FISCAL_AGENT_ACCESS" \
  -d "metadata[membership_tier]=premium" -d "proration_behavior=none" >/dev/null
wait_for_sql "SELECT membership_tier FROM subscriptions WHERE stripe_subscription_id='$SUB';" "premium" "[updated] subscriptions.tier premium"
wait_for_sql "SELECT membership_tier FROM user_memberships WHERE user_id=$DBUID;" "premium" "[updated] membership tier premium"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "[updated] membership still active"

# =========================================================================
# 4. WAIVER / EXEMPTION x live subscription.
#    is_membership_exempt() short-circuits has_*_membership() regardless of the
#    subscription projection. Flipping the tenant to require_subscription=false
#    must grant access EVEN as the live subscription rows persist unchanged --
#    proving exemption is orthogonal to the Stripe-synced state.
# =========================================================================
info "[waiver] exemption overrides live subscription"
assert_eq "$(dbq "SELECT is_membership_exempt($DBUID)::text;")" "false" "[waiver] not exempt before"
dbx "UPDATE tenant_settings SET require_subscription=false WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$DBUID);"
assert_eq "$(dbq "SELECT is_membership_exempt($DBUID)::text;")" "true" "[waiver] exempt after require_subscription=false"
assert_eq "$(dbq "SELECT has_premium_membership($DBUID)::text;")" "true" "[waiver] has_premium via exemption"
# subscription projection itself is untouched by the waiver
assert_eq "$(dbq "SELECT status FROM subscriptions WHERE stripe_subscription_id='$SUB';")" "active" "[waiver] live subscription row still active"
# restore
dbx "UPDATE tenant_settings SET require_subscription=true WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$DBUID);"
assert_eq "$(dbq "SELECT is_membership_exempt($DBUID)::text;")" "false" "[waiver] exemption removed cleanly"

# =========================================================================
# 5. past_due (invoice.payment_failed) -- renewal fails via a test clock.
#    Status becomes past_due; membership stays active (grace / read-only window).
# =========================================================================
info "[past_due] renewal payment fails -> past_due, membership still active"
# Drive past_due deterministically with a test clock: create a clock-backed
# customer, start an active subscription, swap in a card that declines, then
# advance the clock past the period end so the renewal invoice fails.
PDCLOCK=$(sapi test_helpers test_clocks create -d frozen_time=$(date +%s) | json_field id)
PDCUS=$(sapi customers create --email "lanef-pastdue@example.com" -d test_clock="$PDCLOCK" | json_field id)
map_customer "$DBUID" "$PDCUS"   # remap the SAME db user to the clock customer
PDPM=$(sapi payment_methods create --type card -d "card[token]=tok_visa" | json_field id)
sapi payment_methods attach "$PDPM" -d customer="$PDCUS" >/dev/null
sapi customers update "$PDCUS" -d "invoice_settings[default_payment_method]=$PDPM" >/dev/null
PDSUB=$(create_subscription "$PDCUS" "$STRIPE_PRICE_BASIC" "basic")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$PDSUB';" "active" "[past_due] seed subscription active"
PDEND=$(sapi subscriptions retrieve "$PDSUB" | python3 -c "import sys,json;print(json.load(sys.stdin)['items']['data'][0]['current_period_end'])")
PDFAIL=$(sapi payment_methods create --type card -d "card[token]=tok_chargeCustomerFail" | json_field id)
sapi payment_methods attach "$PDFAIL" -d customer="$PDCUS" >/dev/null
sapi customers update "$PDCUS" -d "invoice_settings[default_payment_method]=$PDFAIL" >/dev/null
sapi test_helpers test_clocks advance "$PDCLOCK" -d frozen_time=$((PDEND+3600)) >/dev/null
# wait for the clock to finish processing (advance is async)
for _ in $(seq 1 30); do
  [ "$(sapi test_helpers test_clocks retrieve "$PDCLOCK" | json_field status)" == "ready" ] && break
  sleep 2
done
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$PDSUB';" "past_due" "[past_due] subscriptions.status past_due"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "[past_due] membership still active during grace"

# =========================================================================
# 6. customer.subscription.deleted -> canceled / membership inactive (lapse)
#    Done on a fresh non-clock customer so cancellation fires
#    customer.subscription.deleted immediately (a cancel on a test-clock
#    customer is processed asynchronously by the clock).
# =========================================================================
info "[deleted] cancel subscription -> canceled, membership inactive (lapse)"
DELCUS=$(new_stripe_customer "lanef-delete@example.com")
map_customer "$DBUID" "$DELCUS"
DELSUB=$(create_subscription "$DELCUS" "$STRIPE_PRICE_BASIC" "basic")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$DELSUB';" "active" "[deleted] seed subscription active"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "[deleted] membership active before cancel"
cancel_subscription "$DELSUB"
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$DELSUB';" "canceled" "[deleted] subscriptions.status canceled"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "false" "[lapse] membership inactive after cancel"
assert_eq "$(dbq "SELECT has_basic_membership($DBUID)::text;")" "false" "[lapse] has_basic_membership false after lapse"

# =========================================================================
# 7. lapse -> REACTIVATE: a fresh active subscription restores membership.
# =========================================================================
info "[reactivate] new subscription after lapse restores access"
RECUS=$(new_stripe_customer "lanef-reactivate@example.com")
map_customer "$DBUID" "$RECUS"
RESUB=$(create_subscription "$RECUS" "$STRIPE_PRICE_FISCAL_AGENT_ACCESS" "premium")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$RESUB';" "active" "[reactivate] new subscription active"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "[reactivate] membership active again"
wait_for_sql "SELECT membership_tier FROM user_memberships WHERE user_id=$DBUID;" "premium" "[reactivate] membership tier premium"
assert_eq "$(dbq "SELECT has_premium_membership($DBUID)::text;")" "true" "[reactivate] has_premium_membership true"

# ---- teardown ------------------------------------------------------------
info "webhook-matrix: teardown (cancel Stripe subs, delete clocks + users)"
for s in "$SUB" "$RESUB"; do cancel_subscription "$s"; done
# $PDSUB is cancelled implicitly when its test clock is deleted.
sapi test_helpers test_clocks delete "$PDCLOCK" >/dev/null 2>&1
cleanup_test_users

echo
echo "webhook-matrix: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
exit "$FAIL_COUNT"
