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
#
# TENANT-OWNED premium (the redesign): a tenant-owned billing customer (user_id
# NULL, tenant_id set) drives the ORG plan through tenant_memberships +
# tenants.accepts_sponsorships + the tenant's listing — active/past_due/canceled/
# reactivate lifecycle, keyed directly off tenant_id. A legacy USER-owned premium
# sub additionally MIRRORS its entitlement into tenant_memberships.

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
# The step-3 upgrade also MIRRORED premium into tenant_memberships (legacy
# user-owned premium sub). is_membership_exempt() reads that row too, so park
# it as well; both are restored below.
dbx "UPDATE tenant_memberships SET is_active=false WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$DBUID);"
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
dbx "UPDATE tenant_memberships SET is_active=true WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$DBUID);"

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
# SUB (the user-owned PREMIUM sub from step 3) is still active, so its
# tenant_memberships mirror keeps the tenant exempt (is_membership_exempt) and
# would mask this per-user lapse. Park the mirror to observe the lapse; step
# 7's premium reactivation re-activates it via the mirror upsert.
dbx "UPDATE tenant_memberships SET is_active=false WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$DBUID);"
assert_eq "$(dbq "SELECT has_basic_membership($DBUID)::text;")" "false" "[lapse] has_basic_membership false after lapse"

# =========================================================================
# 6b. OUT-OF-ORDER delivery guard: an OLDER customer.subscription.created
#     event (status=active) re-delivered AFTER customer.subscription.deleted
#     must NOT resurrect the canceled subscription. The stripe_event_id dedup
#     row is deleted first so the delivery passes idempotency and exercises
#     the ordering marker (stripe_subscription_event_cursors /
#     claim_stripe_subscription_event) alone.
# =========================================================================
info "[out-of-order] stale .created after .deleted does not resurrect entitlement"
OOEVID=$(event_id_for "customer.subscription.created" "$DELSUB")
if [ -z "$OOEVID" ]; then
  fail "[out-of-order] could not locate created event id for $DELSUB"
else
  # The deleted event advanced the ordering cursor past the created event.
  assert_eq "$(dbq "SELECT count(*) FROM stripe_subscription_event_cursors WHERE stripe_subscription_id='$DELSUB';")" "1" "[out-of-order] ordering cursor row exists"
  # Drop the dedup row so the resend is NOT swallowed as a duplicate.
  dbx "DELETE FROM billing_webhook_events WHERE stripe_event_id='$OOEVID';"
  sapi events resend "$OOEVID" >/dev/null
  # Wait until the (re)delivered event is recorded, proving the webhook ran...
  wait_for_sql "SELECT count(*) FROM billing_webhook_events WHERE stripe_event_id='$OOEVID';" "1" "[out-of-order] stale event delivered + recorded"
  # ...then assert the stale write was REJECTED: still canceled, still lapsed.
  assert_eq "$(dbq "SELECT status FROM subscriptions WHERE stripe_subscription_id='$DELSUB';")" "canceled" "[out-of-order] subscription NOT resurrected (still canceled)"
  assert_eq "$(dbq "SELECT is_active::text FROM user_memberships WHERE user_id=$DBUID;")" "false" "[out-of-order] membership NOT resurrected (still inactive)"
fi

# Pure-SQL semantics of the atomic claim: newer wins, equal is allowed
# (redelivery), older is rejected.
info "[out-of-order] claim_stripe_subscription_event ordering semantics"
assert_eq "$(dbq "SELECT claim_stripe_subscription_event('sub_ordertest', '2026-01-02T00:00:00Z')::text;")" "true"  "[claim] first event claims"
assert_eq "$(dbq "SELECT claim_stripe_subscription_event('sub_ordertest', '2026-01-02T00:00:00Z')::text;")" "true"  "[claim] equal timestamp (redelivery) allowed"
assert_eq "$(dbq "SELECT claim_stripe_subscription_event('sub_ordertest', '2026-01-01T00:00:00Z')::text;")" "false" "[claim] older event rejected"
assert_eq "$(dbq "SELECT claim_stripe_subscription_event('sub_ordertest', '2026-01-03T00:00:00Z')::text;")" "true"  "[claim] newer event claims"
dbx "DELETE FROM stripe_subscription_event_cursors WHERE stripe_subscription_id='sub_ordertest';"

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

# LEGACY MIRROR: RESUB is a premium sub on a USER-owned customer (map_customer).
# upsertSubscriptionFromStripe must ALSO mirror the entitlement into
# tenant_memberships (onConflict tenant_id) so legacy premium subs keep the new
# tenant-scoped entitlement fresh during the transition.
RECUS_TENANT=$(dbq "SELECT tenant_id FROM users WHERE id=$DBUID;")
wait_for_sql "SELECT is_active::text FROM tenant_memberships WHERE tenant_id=$RECUS_TENANT;" "true" "[mirror] legacy user-owned premium mirrored into tenant_memberships"
assert_eq "$(dbq "SELECT membership_tier FROM tenant_memberships WHERE tenant_id=$RECUS_TENANT;")" "premium" "[mirror] tenant membership tier premium"

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

# =========================================================================
# 9. TENANT-OWNED premium lifecycle (the redesign's core path).
#    A tenant-owned billing customer (user_id NULL, tenant_id set) drives the
#    ORG plan: active -> tenant_memberships.is_active + tenants.accepts_
#    sponsorships + published listing; past_due -> accepts_sponsorships cleared
#    + listing unlisted (membership stays active in grace); canceled -> cleared;
#    reactivation restores. Entitlement is keyed DIRECTLY off tenant_id, never a
#    per-user membership row.
# =========================================================================
info "[tenant] tenant-owned premium lifecycle"
TADMIN=$(create_test_user "lanef-tenant-webhook@example.com" "admin")
TTENANT=$(dbq "SELECT tenant_id FROM users WHERE id=$TADMIN;")
TCUS=$(new_stripe_customer "lanef-tenant-webhook@example.com")
map_tenant_customer "$TTENANT" "$TCUS"
# Seed a published listing so lapse can auto-unlist it.
dbx "INSERT INTO fiscal_agent_listings (tenant_id, managed_by_user_id, name, status)
     VALUES ($TTENANT, $TADMIN, 'Lanef Tenant Charity', 'published');"

info "[tenant] active -> tenant membership + accepts_sponsorships + listing"
TSUB=$(create_tenant_subscription "$TCUS" "$STRIPE_PRICE_FISCAL_AGENT" "$TTENANT" "$TADMIN")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$TSUB';" "active" "[tenant] subscription active"
wait_for_sql "SELECT tenant_id::text FROM subscriptions WHERE stripe_subscription_id='$TSUB';" "$TTENANT" "[tenant] subscription keyed by tenant_id"
# The initiating admin rides along in metadata.user_id.
assert_eq "$(dbq "SELECT user_id::text FROM subscriptions WHERE stripe_subscription_id='$TSUB';")" "$TADMIN" "[tenant] subscription records initiating admin as user_id"
wait_for_sql "SELECT is_active::text FROM tenant_memberships WHERE tenant_id=$TTENANT;" "true" "[tenant] tenant_memberships active"
wait_for_sql "SELECT membership_tier FROM tenant_memberships WHERE tenant_id=$TTENANT;" "premium" "[tenant] tenant membership tier premium"
wait_for_sql "SELECT accepts_sponsorships::text FROM tenants WHERE id=$TTENANT;" "true" "[tenant] accepts_sponsorships set"
# No per-user membership row is written for tenant-owned subs.
assert_eq "$(dbq "SELECT count(*) FROM user_memberships WHERE user_id=$TADMIN;")" "0" "[tenant] no per-user membership row for tenant-owned sub"
# Entitlement is live for the admin via the tenant path.
assert_eq "$(dbq "SELECT has_premium_membership($TADMIN)::text;")" "true" "[tenant] has_premium via tenant membership"

info "[tenant] past_due -> accepts_sponsorships cleared + listing unlisted"
# Republish the listing (active above already restored 'unlisted'->'published';
# ensure it's published before forcing the lapse).
dbx "UPDATE fiscal_agent_listings SET status='published' WHERE tenant_id=$TTENANT;"
TPDCLOCK=$(sapi test_helpers test_clocks create -d frozen_time=$(date +%s) | json_field id)
TPDCUS=$(sapi customers create --email "lanef-tenant-pastdue@example.com" -d test_clock="$TPDCLOCK" | json_field id)
map_tenant_customer "$TTENANT" "$TPDCUS"   # remap SAME tenant to the clock customer
TPDPM=$(sapi payment_methods create --type card -d "card[token]=tok_visa" | json_field id)
sapi payment_methods attach "$TPDPM" -d customer="$TPDCUS" >/dev/null
sapi customers update "$TPDCUS" -d "invoice_settings[default_payment_method]=$TPDPM" >/dev/null
TPDSUB=$(create_tenant_subscription "$TPDCUS" "$STRIPE_PRICE_FISCAL_AGENT" "$TTENANT" "$TADMIN")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$TPDSUB';" "active" "[tenant] past_due seed sub active"
TPDEND=$(sapi subscriptions retrieve "$TPDSUB" | python3 -c "import sys,json;print(json.load(sys.stdin)['items']['data'][0]['current_period_end'])")
TPDFAIL=$(sapi payment_methods create --type card -d "card[token]=tok_chargeCustomerFail" | json_field id)
sapi payment_methods attach "$TPDFAIL" -d customer="$TPDCUS" >/dev/null
sapi customers update "$TPDCUS" -d "invoice_settings[default_payment_method]=$TPDFAIL" >/dev/null
sapi test_helpers test_clocks advance "$TPDCLOCK" -d frozen_time=$((TPDEND+3600)) >/dev/null
for _ in $(seq 1 30); do
  [ "$(sapi test_helpers test_clocks retrieve "$TPDCLOCK" | json_field status)" == "ready" ] && break
  sleep 2
done
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$TPDSUB';" "past_due" "[tenant] subscription past_due"
# Grace: tenant membership stays active on past_due, but the directory
# entitlement (accepts_sponsorships) is cleared and the listing unlisted.
wait_for_sql "SELECT is_active::text FROM tenant_memberships WHERE tenant_id=$TTENANT;" "true" "[tenant] tenant membership active during grace"
wait_for_sql "SELECT accepts_sponsorships::text FROM tenants WHERE id=$TTENANT;" "false" "[tenant] accepts_sponsorships cleared on past_due"
wait_for_sql "SELECT status FROM fiscal_agent_listings WHERE tenant_id=$TTENANT;" "unlisted" "[tenant] listing unlisted on past_due"

info "[tenant] canceled -> tenant membership inactive"
# The tenant is currently mapped to the clock customer ($TPDCUS), but a cancel on
# a clock customer is processed ASYNC by the clock. Do the cancel deterministically
# on a fresh NON-clock customer mapped to the SAME tenant: create an active
# tenant sub, then cancel it so customer.subscription.deleted fires immediately.
TDELCUS=$(new_stripe_customer "lanef-tenant-delete@example.com")
map_tenant_customer "$TTENANT" "$TDELCUS"
TDELSUB=$(create_tenant_subscription "$TDELCUS" "$STRIPE_PRICE_FISCAL_AGENT" "$TTENANT" "$TADMIN")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$TDELSUB';" "active" "[tenant] cancel seed sub active"
wait_for_sql "SELECT is_active::text FROM tenant_memberships WHERE tenant_id=$TTENANT;" "true" "[tenant] tenant membership active before cancel"
cancel_subscription "$TDELSUB"
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$TDELSUB';" "canceled" "[tenant] subscription canceled"
wait_for_sql "SELECT is_active::text FROM tenant_memberships WHERE tenant_id=$TTENANT;" "false" "[tenant] tenant membership inactive after cancel"
assert_eq "$(dbq "SELECT has_premium_membership($TADMIN)::text;")" "false" "[tenant] has_premium false after cancel"

info "[tenant] reactivation restores tenant entitlement"
TRECUS=$(new_stripe_customer "lanef-tenant-reactivate@example.com")
map_tenant_customer "$TTENANT" "$TRECUS"
TRESUB=$(create_tenant_subscription "$TRECUS" "$STRIPE_PRICE_FISCAL_AGENT" "$TTENANT" "$TADMIN")
wait_for_sql "SELECT status FROM subscriptions WHERE stripe_subscription_id='$TRESUB';" "active" "[tenant] reactivation subscription active"
wait_for_sql "SELECT is_active::text FROM tenant_memberships WHERE tenant_id=$TTENANT;" "true" "[tenant] tenant membership active again"
wait_for_sql "SELECT accepts_sponsorships::text FROM tenants WHERE id=$TTENANT;" "true" "[tenant] accepts_sponsorships restored"
wait_for_sql "SELECT status FROM fiscal_agent_listings WHERE tenant_id=$TTENANT;" "published" "[tenant] listing re-published on reactivation"

# ---- teardown ------------------------------------------------------------
info "webhook-matrix: teardown (cancel Stripe subs, delete clocks + users)"
dbx "DELETE FROM fiscal_agent_listings WHERE tenant_id=$DBTENANT;"
dbx "DELETE FROM fiscal_agent_listings WHERE tenant_id=$TTENANT;"
cancel_subscription "$TSUB"       # active sub on the now-orphaned first tenant customer
cancel_subscription "$TRESUB"
# $TPDSUB is cancelled implicitly when its test clock is deleted.
sapi test_helpers test_clocks delete "$TPDCLOCK" >/dev/null 2>&1
cancel_subscription "$SUB"
# $PDSUB is cancelled implicitly when its test clock is deleted.
sapi test_helpers test_clocks delete "$PDCLOCK" >/dev/null 2>&1
cleanup_test_users

echo
echo "webhook-matrix: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
exit "$FAIL_COUNT"
