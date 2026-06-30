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
 * Scoped to the premium tier: only premium owns a listing (canOwnListing =
 * premium), so basic/directory_access subscription churn never touches listings.
 */
async function syncListingPublicationFromSubscription(
  userId: number,
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

  const { error } = await adminSupabase
    .from('fiscal_agent_listings')
    .update({ status: toStatus })
    .eq('owner_user_id', userId)
    .eq('status', fromStatus);

  if (error) {
    throw new Error(`Unable to sync listing publication (${fromStatus}->${toStatus}): ${error.message}`);
  }
}

export async function upsertSubscriptionFromStripe(subscription: Stripe.Subscription) {
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
    .select('user_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (customerError || !billingCustomer) {
    throw new Error('No billing customer found for Stripe customer id.');
  }

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

  const payload = {
    user_id: billingCustomer.user_id,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    stripe_product_id: productId,
    stripe_price_id: priceId,
    membership_tier: membershipTier,
    status: subscription.status,
    current_period_start: subscription.items.data[0]?.current_period_start
      ? new Date(subscription.items.data[0].current_period_start * 1000).toISOString()
      : null,
    current_period_end: subscription.items.data[0]?.current_period_end
      ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
      : null,
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

  const membershipPayload = {
    user_id: billingCustomer.user_id,
    subscription_id: subscriptionRow?.id ?? null,
    membership_tier: membershipTier,
    is_active: isActive,
    starts_at: payload.current_period_start ?? new Date().toISOString(),
    ends_at: payload.current_period_end,
    source: 'stripe',
  };

  const { error: membershipError } = await adminSupabase
    .from('user_memberships')
    .upsert(membershipPayload, { onConflict: 'user_id' });

  if (membershipError) {
    throw new Error(`Unable to sync user membership: ${membershipError.message}`);
  }

  // Auto-unlist on premium lapse / re-publish on reactivation (TASK A5). Keyed
  // off the Stripe status directly (note: past_due keeps membership.is_active
  // true for the read-only grace window above, but still unlists the listing).
  await syncListingPublicationFromSubscription(billingCustomer.user_id, membershipTier, subscription.status);
}
