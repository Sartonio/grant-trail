import type Stripe from 'npm:stripe@18.1.1';
import { isSubscriptionActive } from './subscription-status.ts';
import { adminSupabase, ensurePlatformMembershipProductIds } from './stripe-client.ts';
import {
  assertTenantOwnedTierAllowed,
  buildMembershipRow,
  buildSubscriptionPayload,
  derivePeriods,
  extractPricing,
  isKnownTier,
  parseMetaUserId,
  planListingPublication,
  planSponsorshipEntitlement,
  planTenantMirror,
  resolveOwner,
  resolveTierFromMetadata,
  resolveTierFromPlatformProducts,
} from './subscription-sync-core.ts';

// Subscription-event handling: webhook/sync-my-subscription call this to persist
// a Stripe subscription into `subscriptions` + `user_memberships`, and to keep a
// premium charity's directory listing publication state in sync.
//
// This module is the impure SHELL: it gathers facts (Stripe subscription state,
// DB rows, config), asks subscription-sync-core.ts (pure, exhaustively tested)
// what to do, and executes the resulting writes.

/**
 * Auto-unlist / re-publish a charity's directory listing as their premium
 * ("Fiscal Agents Plan") subscription lapses or reactivates (TASK A5).
 *
 * The lapse/reactivate decision lives in planListingPublication (core). Runs as
 * the service role (RLS + moderation-guard exempt) so the flip needs no owner
 * entitlement. Idempotent: re-delivered events match zero rows once the status
 * already reflects the subscription state. Never deletes data — only the status
 * toggles between 'published' and 'unlisted'.
 *
 * Scoped to the premium tier: only premium tenants publish a listing
 * (canOwnListing = tenant admin + premium), so basic/directory_access
 * subscription churn never touches listings.
 */
async function syncListingPublicationFromSubscription(
  tenantId: number,
  membershipTier: string,
  status: string,
) {
  // Listings are tenant-owned: the caller resolves the tenant (directly for a
  // tenant-owned customer, via the payer's tenant on the legacy per-user path).
  const plan = planListingPublication(membershipTier, status, tenantId);
  if (!plan) return;

  const { error } = await adminSupabase
    .from('fiscal_agent_listings')
    .update({ status: plan.toStatus })
    .eq('tenant_id', tenantId)
    .eq('status', plan.fromStatus);

  if (error) {
    throw new Error(`Unable to sync listing publication (${plan.fromStatus}->${plan.toStatus}): ${error.message}`);
  }
}

/**
 * Keep the tenant-level Charity Directory entitlement flag
 * (tenants.accepts_sponsorships) tracking the premium subscription: set on
 * active/trialing, cleared on past_due/canceled/unpaid, untouched otherwise
 * (incomplete/paused). This flag is the single entitlement the app checks
 * (policy.canOwnListing) — no 'fiscal_agent' pseudo-tier exists anywhere.
 * The decision (incl. the missing-tenant throw) lives in
 * planSponsorshipEntitlement (core).
 */
async function syncTenantSponsorshipEntitlement(
  tenantId: number,
  membershipTier: string,
  status: string,
) {
  const plan = planSponsorshipEntitlement(membershipTier, status, tenantId);
  if (!plan) return;

  const { error } = await adminSupabase
    .from('tenants')
    .update({ accepts_sponsorships: plan.accepts })
    .eq('id', tenantId);

  if (error) {
    throw new Error(`Unable to sync tenant sponsorship entitlement: ${error.message}`);
  }
}

// Resolve a user's tenant_id (legacy per-user path). Returns null if the user
// row or its tenant is missing.
async function resolveUserTenantId(userId: number): Promise<number | null> {
  const { data: user, error } = await adminSupabase
    .from('users')
    .select('tenant_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Unable to resolve tenant for user ${userId}: ${error.message}`);
  }
  return (user?.tenant_id as number | undefined) ?? null;
}

/**
 * Event-ordering guard (atomic at the DB level). Stripe does not guarantee
 * webhook delivery order, so before applying an event we advance a monotonic
 * per-subscription marker via the claim_stripe_subscription_event RPC — a
 * single conditional INSERT ... ON CONFLICT DO UPDATE ... WHERE. If the RPC
 * returns false, a NEWER event for this subscription has already been
 * processed and this (stale) one must be skipped, otherwise an out-of-order
 * `customer.subscription.updated` arriving after a newer update (or after
 * `customer.subscription.deleted`) would transiently resurrect a stale
 * entitlement.
 *
 * Returns true if the event was claimed (caller should apply it), false if it
 * is stale.
 */
async function claimSubscriptionEvent(
  stripeSubscriptionId: string,
  eventCreatedAt: Date,
): Promise<boolean> {
  const { data, error } = await adminSupabase.rpc('claim_stripe_subscription_event', {
    p_stripe_subscription_id: stripeSubscriptionId,
    p_event_at: eventCreatedAt.toISOString(),
  });
  if (error) {
    throw new Error(`Unable to claim subscription event ordering marker: ${error.message}`);
  }
  return Boolean(data);
}

/**
 * Persist a Stripe subscription into the local projection.
 *
 * `eventCreatedAt` is the ordering marker for the out-of-order-delivery guard:
 *   - webhook deliveries pass the Stripe event's `created` timestamp;
 *   - authoritative fresh API fetches (sync-my-subscription, the
 *     checkout.session.completed retrieve) omit it — the fetch time is used,
 *     which both wins over any older queued webhook and advances the marker so
 *     late-arriving stale webhooks are subsequently skipped.
 *
 * Returns true if the state was applied, false if it was skipped as stale.
 */
export async function upsertSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  eventCreatedAt?: Date,
): Promise<boolean> {
  const claimed = await claimSubscriptionEvent(subscription.id, eventCreatedAt ?? new Date());
  if (!claimed) {
    console.warn(`Skipping stale subscription event for ${subscription.id} (out-of-order delivery).`);
    return false;
  }

  await ensurePlatformMembershipProductIds();

  const stripeCustomerId = String(subscription.customer);
  const { priceId, productId } = extractPricing(subscription);

  const { data: billingCustomer, error: customerError } = await adminSupabase
    .from('billing_customers')
    .select('user_id, tenant_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (customerError || !billingCustomer) {
    throw new Error('No billing customer found for Stripe customer id.');
  }

  const { ownerTenantId, isTenantOwned } = resolveOwner(billingCustomer);

  const metadata = subscription.metadata ?? {};
  let membershipTier = resolveTierFromMetadata(metadata);

  if (!isKnownTier(membershipTier)) {
    const { data: platform } = await adminSupabase
      .from('platform_settings')
      .select('basic_membership_product_id, premium_membership_product_id')
      .eq('id', 1)
      .maybeSingle();

    membershipTier = resolveTierFromPlatformProducts(productId, platform ?? null, membershipTier);
  }

  if (!isKnownTier(membershipTier)) {
    throw new Error('Unable to determine membership tier from subscription metadata/product.');
  }

  // A user-owned customer keeps its billing_customers.user_id; a tenant-owned
  // one carries the initiating admin (if any) in metadata.user_id.
  const metaUserId = parseMetaUserId(metadata);
  const subscriptionUserId = isTenantOwned ? metaUserId : (billingCustomer.user_id as number | null);

  const { currentPeriodStart, currentPeriodEnd } = derivePeriods(subscription);

  const payload = buildSubscriptionPayload({
    subscription,
    stripeCustomerId,
    priceId,
    productId,
    membershipTier,
    subscriptionUserId,
    ownerTenantId,
    currentPeriodStart,
    currentPeriodEnd,
    metadata,
  });

  const { data: subscriptionRow, error: upsertError } = await adminSupabase
    .from('subscriptions')
    .upsert(payload, { onConflict: 'stripe_subscription_id' })
    .select('id')
    .single();

  if (upsertError) {
    throw new Error(`Unable to upsert subscription: ${upsertError.message}`);
  }

  const isActive = isSubscriptionActive(subscription.status);
  const startsAt = currentPeriodStart ?? new Date().toISOString();
  const subscriptionRowId = (subscriptionRow?.id as number | undefined) ?? null;

  if (isTenantOwned) {
    // Tenant-owned premium: entitlement lives in tenant_memberships (keyed by
    // tenant).
    assertTenantOwnedTierAllowed(membershipTier);

    const { error: tenantMembershipError } = await adminSupabase
      .from('tenant_memberships')
      .upsert(
        {
          tenant_id: ownerTenantId,
          ...buildMembershipRow({
            subscriptionRowId,
            membershipTier: 'premium',
            isActive,
            startsAt,
            endsAt: currentPeriodEnd,
          }),
        },
        { onConflict: 'tenant_id' },
      );

    if (tenantMembershipError) {
      throw new Error(`Unable to sync tenant membership: ${tenantMembershipError.message}`);
    }

    // Listing publication + accepts_sponsorships key DIRECTLY off the tenant.
    await syncListingPublicationFromSubscription(ownerTenantId as number, membershipTier, subscription.status);
    await syncTenantSponsorshipEntitlement(ownerTenantId as number, membershipTier, subscription.status);
    return true;
  }

  // ── User-owned (legacy per-user) path ─────────────────────────────────────
  const userId = billingCustomer.user_id as number | null;
  if (!userId) {
    throw new Error('User-owned billing customer is missing user_id.');
  }

  const { error: membershipError } = await adminSupabase
    .from('user_memberships')
    .upsert(
      {
        user_id: userId,
        ...buildMembershipRow({
          subscriptionRowId,
          membershipTier,
          isActive,
          startsAt,
          endsAt: currentPeriodEnd,
        }),
      },
      { onConflict: 'user_id' },
    );

  if (membershipError) {
    throw new Error(`Unable to sync user membership: ${membershipError.message}`);
  }

  // Resolve the payer's tenant for the listing / sponsorship / mirror syncs.
  const userTenantId = await resolveUserTenantId(userId);

  // Mirror decision (mirror premium / demote stale / none) lives in the core.
  const mirrorAction = planTenantMirror(membershipTier, userTenantId);

  if (mirrorAction === 'mirror-premium') {
    const { error: mirrorError } = await adminSupabase
      .from('tenant_memberships')
      .upsert(
        {
          tenant_id: userTenantId,
          ...buildMembershipRow({
            subscriptionRowId,
            membershipTier: 'premium',
            isActive,
            startsAt,
            endsAt: currentPeriodEnd,
          }),
        },
        { onConflict: 'tenant_id' },
      );

    if (mirrorError) {
      throw new Error(`Unable to mirror legacy premium into tenant membership: ${mirrorError.message}`);
    }
  } else if (mirrorAction === 'demote-stale') {
    // Downgrade path: if THIS subscription previously mirrored premium into
    // tenant_memberships and is now non-premium, deactivate that mirror row —
    // otherwise the tenant keeps a stale active premium entitlement
    // (is_membership_exempt reads tenant_memberships) after premium -> basic.
    // Keyed on subscription_id so a genuine tenant-owned membership (backed by
    // its own subscriptions row) is never touched.
    const { error: demoteError } = await adminSupabase
      .from('tenant_memberships')
      .update({ is_active: false })
      .eq('tenant_id', userTenantId)
      .eq('subscription_id', subscriptionRowId ?? -1)
      .eq('source', 'stripe');

    if (demoteError) {
      throw new Error(`Unable to deactivate stale premium tenant mirror: ${demoteError.message}`);
    }
  }

  // Auto-unlist on premium lapse / re-publish on reactivation (TASK A5). Keyed
  // off the Stripe status directly (note: past_due keeps membership.is_active
  // true for the read-only grace window above, but still unlists the listing).
  await syncListingPublicationFromSubscription(userTenantId ?? 0, membershipTier, subscription.status);

  // Tenant entitlement flag (accepts_sponsorships) tracks the same lifecycle.
  await syncTenantSponsorshipEntitlement(userTenantId ?? 0, membershipTier, subscription.status);
  return true;
}
