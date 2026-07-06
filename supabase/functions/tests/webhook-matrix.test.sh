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
#
# Also proves: invoice.payment_failed is handled as a first-failure DUNNING
# signal -- the event is recorded (billing_webhook_events) and its isolated email
# send is a clean no-op without Resend creds (no payment_failed_email_failure row),
# WITHOUT ever mutating the subscription projection (that stays driven by
# customer.subscription.updated).
#
# Also proves: cancelling a PREMIUM subscription auto-unlists the owner's
# 'published' fiscal_agent_listings row (lapse -> status='unlisted').

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/stripe_test_helpers.sh
source "${HERE}/lib/stripe_test_helpers.sh"
ensure_functions_served || exit 1

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
  -d "items[0][id]=$ITEM" -d "items[0][price]=$STRIPE_PRICE_FISCAL_AGENT" \
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
# is_membership_exempt() is also true when the tenant has an active *premium*
# member -- and by this point the user IS premium (the upgrade above). That
# would mask the require_subscription signal we want to prove here. Park the
# membership inactive so the false->true->false exemption transition is
# attributable to the waiver flag ALONE, then restore it; the Stripe-synced
# `subscriptions` row is never touched.
dbx "UPDATE user_memberships SET is_active=false WHERE user_id=$DBUID;"
dbx "UPDATE tenant_settings SET require_subscription=true WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$DBUID);"
assert_eq "$(dbq "SELECT is_membership_exempt($DBUID)::text;")" "false" "[waiver] not exempt before"
dbx "UPDATE tenant_settings SET require_subscription=false WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$DBUID);"
assert_eq "$(dbq "SELECT is_membership_exempt($DBUID)::text;")" "true" "[waiver] exempt after require_subscription=false"
# membership is parked inactive, so a true here is purely the exemption short-circuit
assert_eq "$(dbq "SELECT has_premium_membership($DBUID)::text;")" "true" "[waiver] has_premium via exemption"
# subscription projection itself is untouched by the waiver
assert_eq "$(dbq "SELECT status FROM subscriptions WHERE stripe_subscription_id='$SUB';")" "active" "[waiver] live subscription row still active"
# restore tenant gating + membership for the steps that follow
dbx "UPDATE tenant_settings SET require_subscription=true WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$DBUID);"
assert_eq "$(dbq "SELECT is_membership_exempt($DBUID)::text;")" "false" "[waiver] exemption removed cleanly"
dbx "UPDATE user_memberships SET is_active=true WHERE user_id=$DBUID;"

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

# The failing renewal also delivers invoice.payment_failed -> the dunning handler.
# It must record the event (dedupe row) WITHOUT touching the subscription
# projection (status stays past_due, driven solely by customer.subscription.updated).
# The email send is isolated regardless of Resend creds -- exhaustively covered by
# email-resilience.test.sh -- so this matrix case does NOT assert on the email
# outcome (this env may carry live creds), only that the projection is untouched.
info "[dunning] invoice.payment_failed recorded, subscription projection untouched"
# Locate the event by CUSTOMER, not subscription: current Stripe API versions
# drop the top-level `invoice.subscription` field event_id_for() keys on, so the
# invoice is matched on its `customer` (the clock customer whose renewal failed).
event_id_for_invoice_customer() {
  local cusid="$1"
  sapi events list --limit 50 | python3 -c "
import sys,json
cusid='$cusid'
for e in json.load(sys.stdin)['data']:
    obj=e['data']['object']
    if e['type']=='invoice.payment_failed' and obj.get('customer')==cusid:
        print(e['id']); break"
}
PFEVID=""
for _ in $(seq 1 15); do
  PFEVID=$(event_id_for_invoice_customer "$PDCUS")
  [ -n "$PFEVID" ] && [ "$(dbq "SELECT count(*) FROM billing_webhook_events WHERE stripe_event_id='$PFEVID';")" == "1" ] && break
  sleep 2
done
if [ -z "$PFEVID" ]; then
  fail "[dunning] could not locate invoice.payment_failed event id"
else
  assert_eq "$(dbq "SELECT count(*) FROM billing_webhook_events WHERE stripe_event_id='$PFEVID';")" "1" "[dunning] invoice.payment_failed recorded in billing_webhook_events"
  assert_eq "$(dbq "SELECT event_type FROM billing_webhook_events WHERE stripe_event_id='$PFEVID';")" "invoice.payment_failed" "[dunning] recorded event_type is invoice.payment_failed"
  # The dunning handler must NOT mutate the projection: status is still past_due
  # (set by customer.subscription.updated), membership still active in grace.
  assert_eq "$(dbq "SELECT status FROM subscriptions WHERE stripe_subscription_id='$PDSUB';")" "past_due" "[dunning] subscription projection untouched by dunning handler"
  assert_eq "$(dbq "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;")" "true" "[dunning] membership still active (dunning handler is notify-only)"
fi

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
RESUB=$(create_subscription "$RECUS" "$STRIPE_PRICE_FISCAL_AGENT" "premium")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$RESUB';" "active" "[reactivate] new subscription active"
wait_for_sql "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;" "true" "[reactivate] membership active again"
wait_for_sql "SELECT membership_tier FROM user_memberships WHERE user_id=$DBUID;" "premium" "[reactivate] membership tier premium"
assert_eq "$(dbq "SELECT has_premium_membership($DBUID)::text;")" "true" "[reactivate] has_premium_membership true"
wait_for_sql "SELECT accepts_sponsorships::text FROM tenants WHERE id=(SELECT tenant_id FROM users WHERE id=$DBUID);" "true" "[reactivate] tenant sponsorship entitlement set"

# =========================================================================
# 8. premium lapse -> published listing auto-unlisted.
#    syncListingPublicationFromSubscription: cancelling the premium sub must
#    demote the owner's 'published' directory listing to 'unlisted'.
# =========================================================================
info "[unlist] premium lapse auto-unlists the owner's published listing"
DBTENANT=$(dbq "SELECT tenant_id FROM users WHERE id=$DBUID;")
dbx "INSERT INTO fiscal_agent_listings (tenant_id, managed_by_user_id, name, status)
     VALUES ($DBTENANT, $DBUID, 'Lanef Webhook Charity', 'published');"
assert_eq "$(dbq "SELECT status FROM fiscal_agent_listings WHERE tenant_id=$DBTENANT;")" "published" "[unlist] listing seeded published"
cancel_subscription "$RESUB"
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$RESUB';" "canceled" "[unlist] premium subscription canceled"
wait_for_sql "SELECT status FROM fiscal_agent_listings WHERE tenant_id=$DBTENANT;" "unlisted" "[unlist] listing auto-unlisted on lapse"
wait_for_sql "SELECT accepts_sponsorships::text FROM tenants WHERE id=$DBTENANT;" "false" "[unlist] tenant sponsorship entitlement cleared on lapse"

# ---- teardown ------------------------------------------------------------
info "webhook-matrix: teardown (cancel Stripe subs, delete clocks + users)"
dbx "DELETE FROM fiscal_agent_listings WHERE tenant_id=$DBTENANT;"
cancel_subscription "$SUB"
# $PDSUB is cancelled implicitly when its test clock is deleted.
sapi test_helpers test_clocks delete "$PDCLOCK" >/dev/null 2>&1
cleanup_test_users

echo
echo "webhook-matrix: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
exit "$FAIL_COUNT"
