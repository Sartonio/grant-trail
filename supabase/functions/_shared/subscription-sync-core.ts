import type Stripe from 'npm:stripe@18.1.1';

// PURE decision core for the Stripe subscription sync. Extracted verbatim from
// stripe-subscription-sync.ts (behavior-preserving): input = facts (Stripe
// subscription state, DB rows, config), output = decision values / write
// payloads. No Deno.env, no fetch, no Stripe/Supabase clients — the impure
// shell (stripe-subscription-sync.ts) gathers facts, calls these, and executes
// the resulting writes. Exhaustively unit-tested in subscription-sync-core.test.ts.

// ── Directory lifecycle tables (TASK A5) ────────────────────────────────────
// Stripe subscription statuses that count as a PREMIUM lapse for the directory.
// A lapse auto-unlists the owner's published listing.
export const LAPSE_STATUSES = ['past_due', 'canceled', 'unpaid'];
// Statuses that count as a healthy, paid subscription and re-publish a listing
// that was auto-unlisted by a prior lapse.
export const ACTIVE_STATUSES = ['active', 'trialing'];

// The app has exactly two SKUs: 'basic' and 'premium' (the "Fiscal Agents
// Plan"). The charity onboarding flow uses the 'premium' tier (matched by
// product ID like any premium sub).
export const KNOWN_TIERS = ['basic', 'premium'];

export type ListingTransition = { fromStatus: string; toStatus: string };

/**
 * Decide the listing publication flip for a premium subscription lifecycle
 * event, or null for "leave the listing as-is":
 *   - lapse  (past_due/canceled/unpaid): 'published' -> 'unlisted'
 *   - active (active/trialing):          'unlisted'  -> 'published'
 *   - any other status / non-premium tier / unresolved tenant: no-op.
 */
export function planListingPublication(
  membershipTier: string,
  status: string,
  tenantId: number,
): ListingTransition | null {
  if (membershipTier !== 'premium') return null;

  if (LAPSE_STATUSES.includes(status)) {
    if (!tenantId) return null;
    return { fromStatus: 'published', toStatus: 'unlisted' };
  }
  if (ACTIVE_STATUSES.includes(status)) {
    if (!tenantId) return null;
    return { fromStatus: 'unlisted', toStatus: 'published' };
  }
  // incomplete / paused / etc.: leave the listing as-is.
  return null;
}

/**
 * Decide the tenants.accepts_sponsorships flag for a premium subscription
 * lifecycle event: true on active/trialing, false on past_due/canceled/unpaid,
 * null (untouched) otherwise. An unresolved tenant is a silent no-op, aligned
 * with planListingPublication — a legacy user-owned sub with no resolvable
 * tenant must not fail the webhook.
 */
export function planSponsorshipEntitlement(
  membershipTier: string,
  status: string,
  tenantId: number,
): { accepts: boolean } | null {
  if (membershipTier !== 'premium') return null;

  let accepts: boolean;
  if (ACTIVE_STATUSES.includes(status)) accepts = true;
  else if (LAPSE_STATUSES.includes(status)) accepts = false;
  else return null;

  if (!tenantId) return null;
  return { accepts };
}

// ── Membership-tier resolution ──────────────────────────────────────────────

/** Tier from subscription metadata: membership_tier wins; else feature_key mapping. */
export function resolveTierFromMetadata(metadata: Stripe.Metadata): string {
  let membershipTier = String(metadata.membership_tier ?? '').toLowerCase();

  if (!membershipTier) {
    const featureKey = String(metadata.feature_key ?? '').toLowerCase();
    if (featureKey === 'basic_membership') membershipTier = 'basic';
    if (featureKey === 'premium_membership' || featureKey === 'admin_membership' || featureKey === 'excel_export') membershipTier = 'premium';
  }
  return membershipTier;
}

/**
 * Fallback tier resolution by matching the subscription's product against the
 * platform_settings product ids. Returns currentTier unchanged on no match
 * (premium wins if both ids match the same product).
 */
export function resolveTierFromPlatformProducts(
  productId: string,
  platform: { basic_membership_product_id?: unknown; premium_membership_product_id?: unknown } | null,
  currentTier: string,
): string {
  const basicProduct = String(platform?.basic_membership_product_id ?? '');
  const premiumProduct = String(platform?.premium_membership_product_id ?? '');

  let membershipTier = currentTier;
  if (productId === basicProduct) membershipTier = 'basic';
  if (productId === premiumProduct) membershipTier = 'premium';
  return membershipTier;
}

export function isKnownTier(membershipTier: string): boolean {
  return KNOWN_TIERS.includes(membershipTier);
}

// ── Ownership / identity ────────────────────────────────────────────────────

/**
 * Ownership: exactly one of user_id / tenant_id is set on a billing_customers
 * row (CHECK chk_billing_customers_one_owner). Tenant-owned => premium org
 * plan; user-owned => legacy per-user (basic today, or grandfathered premium).
 */
export function resolveOwner(billingCustomer: { user_id: unknown; tenant_id: unknown }): {
  ownerTenantId: number | null;
  isTenantOwned: boolean;
} {
  const ownerTenantId = (billingCustomer.tenant_id as number | null) ?? null;
  return { ownerTenantId, isTenantOwned: ownerTenantId !== null };
}

/**
 * On a tenant-owned customer the initiating admin rides along in
 * metadata.user_id (a numeric string), else null.
 */
export function parseMetaUserId(metadata: Stripe.Metadata): number | null {
  const raw = String(metadata.user_id ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The tier CHECK on tenant_memberships rejects anything but 'premium', so a
 * non-premium tier on a tenant customer is a misconfiguration — fail loudly
 * rather than let the upsert 23514 with an opaque message.
 */
export function assertTenantOwnedTierAllowed(membershipTier: string): void {
  if (membershipTier !== 'premium') {
    throw new Error(`Tenant-owned billing customer carries non-premium tier '${membershipTier}'.`);
  }
}

// ── Stripe subscription fact extraction ─────────────────────────────────────

export function extractPricing(subscription: Stripe.Subscription): { priceId: string; productId: string } {
  const price = subscription.items.data[0]?.price;
  const priceId = price?.id;
  const productId = typeof price?.product === 'string' ? price.product : '';

  if (!priceId || !productId) {
    throw new Error('Subscription is missing a Stripe price id.');
  }
  return { priceId, productId };
}

export function derivePeriods(subscription: Stripe.Subscription): {
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
} {
  const currentPeriodStart = subscription.items.data[0]?.current_period_start
    ? new Date(subscription.items.data[0].current_period_start * 1000).toISOString()
    : null;
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end
    ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
    : null;
  return { currentPeriodStart, currentPeriodEnd };
}

// ── Write payloads ──────────────────────────────────────────────────────────

/** The `subscriptions` table upsert row (onConflict: stripe_subscription_id). */
export function buildSubscriptionPayload(args: {
  subscription: Stripe.Subscription;
  stripeCustomerId: string;
  priceId: string;
  productId: string;
  membershipTier: string;
  subscriptionUserId: number | null;
  ownerTenantId: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  metadata: Stripe.Metadata;
}) {
  const { subscription } = args;
  return {
    user_id: args.subscriptionUserId,
    tenant_id: args.ownerTenantId,
    stripe_customer_id: args.stripeCustomerId,
    stripe_subscription_id: subscription.id,
    stripe_product_id: args.productId,
    stripe_price_id: args.priceId,
    membership_tier: args.membershipTier,
    status: subscription.status,
    current_period_start: args.currentPeriodStart,
    current_period_end: args.currentPeriodEnd,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    metadata: args.metadata,
  };
}

/**
 * Common membership row (user_memberships / tenant_memberships / mirror) —
 * caller adds the owner key ({ user_id } or { tenant_id }).
 */
export function buildMembershipRow(args: {
  subscriptionRowId: number | null;
  membershipTier: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
}) {
  return {
    subscription_id: args.subscriptionRowId,
    membership_tier: args.membershipTier,
    is_active: args.isActive,
    starts_at: args.startsAt,
    ends_at: args.endsAt,
    source: 'stripe',
  };
}

// ── Legacy per-user path: tenant mirror decision ────────────────────────────

export type TenantMirrorAction = 'mirror-premium' | 'demote-stale' | 'none';

/**
 * Transition mirror: a legacy user-owned PREMIUM sub also refreshes the
 * tenant_memberships row so the tenant-scoped entitlement stays current until
 * live premium subs migrate onto tenant customers. A non-premium sub with a
 * resolvable tenant deactivates its own stale mirror row instead (keyed on
 * subscription_id, so a genuine tenant-owned membership is never touched).
 * No resolvable tenant: nothing to mirror or demote.
 */
export function planTenantMirror(membershipTier: string, userTenantId: number | null): TenantMirrorAction {
  if (membershipTier === 'premium' && userTenantId) return 'mirror-premium';
  if (userTenantId) return 'demote-stale';
  return 'none';
}
