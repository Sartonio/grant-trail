import type Stripe from 'npm:stripe@18.1.1';
import { isSubscriptionActive } from './subscription-status.ts';
import { adminSupabase, ensurePlatformMembershipProductIds } from './stripe-client.ts';

// Subscription-event handling: webhook/sync-my-subscription call this to persist
// a Stripe subscription into `subscriptions` + `user_memberships`, and to keep a
// premium charity's directory listing publication state in sync.

// Stripe subscription statuses that count as a PREMIUM lapse for the directory
// (TASK A5). A lapse auto-unlists the owner's published listing.
const LAPSE_STATUSES = ['past_due', 'canceled', 'unpaid'];
// Statuses that count as a healthy, paid subscription and re-publish a listing
// that was auto-unlisted by a prior lapse.
const ACTIVE_STATUSES = ['active', 'trialing'];

/**
 * Auto-unlist / re-publish a charity's directory listing as their premium
 * ("Fiscal Agents Plan") subscription lapses or reactivates (TASK A5).
 *
 *   - lapse  (past_due/canceled/unpaid): demote a 'published' listing to
 *     'unlisted' so it falls out of the public teaser view. Drafts and
 *     super_admin-'hidden' listings are left untouched.
 *   - active (active/trialing): restore an 'unlisted' listing to 'published'.
 *     Only 'unlisted' (the auto-lapse state) is restored, never a manual draft
 *     or hidden listing.
 *
 * Runs as the service role (RLS + moderation-guard exempt) so the flip needs no
 * owner entitlement. Idempotent: re-delivered events match zero rows once the
 * status already reflects the subscription state. Never deletes data — only the
 * status toggles between 'published' and 'unlisted'.
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
  if (membershipTier !== 'premium') return;

  let fromStatus: string | null = null;
  let toStatus: string | null = null;
  if (LAPSE_STATUSES.includes(status)) {
    fromStatus = 'published';
    toStatus = 'unlisted';
  } else if (ACTIVE_STATUSES.includes(status)) {
    fromStatus = 'unlisted';
    toStatus = 'published';
  } else {
    // incomplete / paused / etc.: leave the listing as-is.
    return;
  }

  // Listings are tenant-owned: the caller resolves the tenant (directly for a
  // tenant-owned customer, via the payer's tenant on the legacy per-user path).
  if (!tenantId) return;

  const { error } = await adminSupabase
    .from('fiscal_agent_listings')
    .update({ status: toStatus })
    .eq('tenant_id', tenantId)
    .eq('status', fromStatus);

  if (error) {
    throw new Error(`Unable to sync listing publication (${fromStatus}->${toStatus}): ${error.message}`);
  }
}

/**
 * Keep the tenant-level Charity Directory entitlement flag
 * (tenants.accepts_sponsorships) tracking the premium subscription: set on
 * active/trialing, cleared on past_due/canceled/unpaid, untouched otherwise
 * (incomplete/paused). This flag is the single entitlement the app checks
 * (policy.canOwnListing) — no 'fiscal_agent' pseudo-tier exists anywhere.
 */
async function syncTenantSponsorshipEntitlement(
  tenantId: number,
  membershipTier: string,
  status: string,
) {
  if (membershipTier !== 'premium') return;

  let accepts: boolean;
  if (ACTIVE_STATUSES.includes(status)) accepts = true;
  else if (LAPSE_STATUSES.includes(status)) accepts = false;
  else return;

  if (!tenantId) {
    throw new Error('Unable to resolve tenant for sponsorship entitlement sync: no tenant');
  }

  const { error } = await adminSupabase
    .from('tenants')
    .update({ accepts_sponsorships: accepts })
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
  const price = subscription.items.data[0]?.price;
  const priceId = price?.id;
  const productId = typeof price?.product === 'string' ? price.product : '';

  if (!priceId || !productId) {
    throw new Error('Subscription is missing a Stripe price id.');
  }

  const { data: billingCustomer, error: customerError } = await adminSupabase
    .from('billing_customers')
    .select('user_id, tenant_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (customerError || !billingCustomer) {
    throw new Error('No billing customer found for Stripe customer id.');
  }

  // Ownership: exactly one of user_id / tenant_id is set on a billing_customers
  // row (CHECK chk_billing_customers_one_owner). Tenant-owned => premium org
  // plan; user-owned => legacy per-user (basic today, or grandfathered premium).
  const ownerTenantId = (billingCustomer.tenant_id as number | null) ?? null;
  const isTenantOwned = ownerTenantId !== null;

  const metadata = subscription.metadata ?? {};
  let membershipTier = String(metadata.membership_tier ?? '').toLowerCase();

  if (!membershipTier) {
    const featureKey = String(metadata.feature_key ?? '').toLowerCase();
    if (featureKey === 'basic_membership') membershipTier = 'basic';
    if (featureKey === 'premium_membership' || featureKey === 'admin_membership' || featureKey === 'excel_export') membershipTier = 'premium';
  }

  // The app has exactly two SKUs: 'basic' and 'premium' (the "Fiscal Agents
  // Plan"). The charity onboarding flow uses the 'premium' tier (matched by
  // product ID like any premium sub).
  const KNOWN_TIERS = ['basic', 'premium'];

  if (!KNOWN_TIERS.includes(membershipTier)) {
    const { data: platform } = await adminSupabase
      .from('platform_settings')
      .select('basic_membership_product_id, premium_membership_product_id')
      .eq('id', 1)
      .maybeSingle();

    const basicProduct = String(platform?.basic_membership_product_id ?? '');
    const premiumProduct = String(platform?.premium_membership_product_id ?? '');

    if (productId === basicProduct) membershipTier = 'basic';
    if (productId === premiumProduct) membershipTier = 'premium';
  }

  if (!KNOWN_TIERS.includes(membershipTier)) {
    throw new Error('Unable to determine membership tier from subscription metadata/product.');
  }

  // On a tenant-owned customer the initiating admin rides along in
  // metadata.user_id (a numeric string), else null. A user-owned customer keeps
  // its billing_customers.user_id.
  const metaUserId = (() => {
    const raw = String(metadata.user_id ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  })();
  const subscriptionUserId = isTenantOwned ? metaUserId : (billingCustomer.user_id as number | null);

  const currentPeriodStart = subscription.items.data[0]?.current_period_start
    ? new Date(subscription.items.data[0].current_period_start * 1000).toISOString()
    : null;
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end
    ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
    : null;

  const payload = {
    user_id: subscriptionUserId,
    tenant_id: ownerTenantId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    stripe_product_id: productId,
    stripe_price_id: priceId,
    membership_tier: membershipTier,
    status: subscription.status,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    metadata,
  };

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

  if (isTenantOwned) {
    // Tenant-owned premium: entitlement lives in tenant_memberships (keyed by
    // tenant). The tier CHECK rejects anything but 'premium', so a non-premium
    // tier on a tenant customer is a misconfiguration — fail loudly rather than
    // let the upsert 23514 with an opaque message.
    if (membershipTier !== 'premium') {
      throw new Error(`Tenant-owned billing customer carries non-premium tier '${membershipTier}'.`);
    }

    const { error: tenantMembershipError } = await adminSupabase
      .from('tenant_memberships')
      .upsert(
        {
          tenant_id: ownerTenantId,
          subscription_id: subscriptionRow?.id ?? null,
          membership_tier: 'premium',
          is_active: isActive,
          starts_at: startsAt,
          ends_at: currentPeriodEnd,
          source: 'stripe',
        },
        { onConflict: 'tenant_id' },
      );

    if (tenantMembershipError) {
      throw new Error(`Unable to sync tenant membership: ${tenantMembershipError.message}`);
    }

    // Listing publication + accepts_sponsorships key DIRECTLY off the tenant.
    await syncListingPublicationFromSubscription(ownerTenantId, membershipTier, subscription.status);
    await syncTenantSponsorshipEntitlement(ownerTenantId, membershipTier, subscription.status);
    return true;
  }

  // ── User-owned (legacy per-user) path ─────────────────────────────────────
  const userId = billingCustomer.user_id as number | null;
  if (!userId) {
    throw new Error('User-owned billing customer is missing user_id.');
  }

  const membershipPayload = {
    user_id: userId,
    subscription_id: subscriptionRow?.id ?? null,
    membership_tier: membershipTier,
    is_active: isActive,
    starts_at: startsAt,
    ends_at: currentPeriodEnd,
    source: 'stripe',
  };

  const { error: membershipError } = await adminSupabase
    .from('user_memberships')
    .upsert(membershipPayload, { onConflict: 'user_id' });

  if (membershipError) {
    throw new Error(`Unable to sync user membership: ${membershipError.message}`);
  }

  // Resolve the payer's tenant for the listing / sponsorship / mirror syncs.
  const userTenantId = await resolveUserTenantId(userId);

  // Transition mirror: a legacy user-owned PREMIUM sub also refreshes the new
  // tenant_memberships row (onConflict tenant_id) so the tenant-scoped
  // entitlement stays current until live premium subs are migrated onto tenant
  // customers. Basic never mirrors (tier CHECK is premium-only).
  if (membershipTier === 'premium' && userTenantId) {
    const { error: mirrorError } = await adminSupabase
      .from('tenant_memberships')
      .upsert(
        {
          tenant_id: userTenantId,
          subscription_id: subscriptionRow?.id ?? null,
          membership_tier: 'premium',
          is_active: isActive,
          starts_at: startsAt,
          ends_at: currentPeriodEnd,
          source: 'stripe',
        },
        { onConflict: 'tenant_id' },
      );

    if (mirrorError) {
      throw new Error(`Unable to mirror legacy premium into tenant membership: ${mirrorError.message}`);
    }
  } else if (userTenantId) {
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
      .eq('subscription_id', subscriptionRow?.id ?? -1)
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
