import { adminSupabase, corsHeaders, buildRedirectUrl, ensurePlatformMembershipProductIds, getOrCreateStripeCustomer, getOrCreateStripeCustomerForTenant, requireAuthenticatedProfile, stripe } from '../_shared/stripe-client.ts';
import { assertPostRequest, AuthError, parseJsonBody, validateFeatureKey, validateReturnOrigin, validateReturnPath, ValidationError } from '../_shared/validation.ts';
import { isSubscriptionActive } from '../_shared/subscription-status.ts';

// Feature key → (Stripe price env var, membership tier). `basic_membership` buys
// the basic plan; every other key folds into the premium "Fiscal Agents Plan".
// This is the single checkout entry point for both tiers — the price and the
// metadata tier are chosen from the validated feature key, never the client.
const TIER_BY_FEATURE_KEY = {
  basic_membership: { tier: 'basic', priceEnv: 'STRIPE_PRICE_BASIC' },
  admin_membership: { tier: 'premium', priceEnv: 'STRIPE_PRICE_FISCAL_AGENT' },
  premium_membership: { tier: 'premium', priceEnv: 'STRIPE_PRICE_FISCAL_AGENT' },
  excel_export: { tier: 'premium', priceEnv: 'STRIPE_PRICE_FISCAL_AGENT' },
};
const ALLOWED_FEATURE_KEYS = Object.keys(TIER_BY_FEATURE_KEY);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertPostRequest(request);
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));
    const body = await parseJsonBody(request);
    const returnPath = validateReturnPath(body.returnPath);
    const returnOrigin = validateReturnOrigin(body.returnOrigin);
    const featureKey = validateFeatureKey(body.featureKey, ALLOWED_FEATURE_KEYS, 'admin_membership');
    // featureKey is validated against ALLOWED_FEATURE_KEYS above, so it is
    // always a real key of TIER_BY_FEATURE_KEY; the cast is behavior-preserving.
    const { tier, priceEnv } = TIER_BY_FEATURE_KEY[featureKey as keyof typeof TIER_BY_FEATURE_KEY];
    const stripePriceId = Deno.env.get(priceEnv);

    if (!stripePriceId) {
      throw new Error(`Missing ${priceEnv} environment variable.`);
    }

    await ensurePlatformMembershipProductIds();

    // Premium ("Fiscal Agents Plan") is TENANT-owned: route to the tenant's one
    // Stripe customer so any admin drives the same org plan and a second admin
    // can never double-provision. Basic stays per-user (unchanged).
    const isPremium = tier === 'premium';

    // Entitlement dedup BEFORE touching Stripe: if the org already holds an
    // active premium membership (tenant-owned, backfilled, or mirrored from a
    // grandfathered user-owned sub), never open another premium checkout — the
    // customer-scoped check below can't see legacy subs living on a DIFFERENT
    // (per-user) Stripe customer. Also avoids minting an empty tenant Stripe
    // customer for an already-entitled org.
    if (isPremium && profile.tenantId) {
      const { data: orgMembership, error: orgMembershipError } = await adminSupabase
        .from('tenant_memberships')
        .select('is_active, ends_at')
        .eq('tenant_id', profile.tenantId)
        .maybeSingle();
      if (orgMembershipError) {
        throw new Error(`Unable to check org plan state: ${orgMembershipError.message}`);
      }
      const orgPlanActive = Boolean(orgMembership?.is_active)
        && (!orgMembership?.ends_at || new Date(orgMembership.ends_at).getTime() > Date.now());
      if (orgPlanActive) {
        return new Response(JSON.stringify({ url: buildRedirectUrl(returnPath, '?checkout=success', returnOrigin), alreadyActive: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }
    }

    const customerId = isPremium
      ? await getOrCreateStripeCustomerForTenant(profile)
      : await getOrCreateStripeCustomer(profile);

    // Idempotency: never open a second checkout for a customer who already has a
    // live subscription. Stale client-side membership state (e.g. an un-refreshed
    // session right after onboarding) would otherwise let them subscribe twice.
    // For premium this customer is the TENANT's, so a SECOND admin of an already-
    // subscribed org hits this same alreadyActive redirect (dedup across admins).
    // Send them to the success return instead, where membership re-syncs.
    const existing = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    if (existing.data.some((sub) => isSubscriptionActive(sub.status))) {
      return new Response(JSON.stringify({ url: buildRedirectUrl(returnPath, '?checkout=success', returnOrigin), alreadyActive: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Premium subs carry tenant_id so the sync layer keys tenant_memberships /
    // subscriptions off the org; user_id stays as the initiating admin. Basic
    // subs stay per-user (no tenant_id).
    const checkoutMetadata = {
      user_id: String(profile.profileId),
      feature_key: featureKey,
      membership_tier: tier,
      ...(isPremium && profile.tenantId ? { tenant_id: String(profile.tenantId) } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: buildRedirectUrl(returnPath, '?checkout=success', returnOrigin),
      cancel_url: buildRedirectUrl(returnPath, '?checkout=canceled', returnOrigin),
      client_reference_id: String(profile.profileId),
      metadata: checkoutMetadata,
      subscription_data: {
        metadata: checkoutMetadata,
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
    console.error('Checkout session error:', error);
    try {
      await adminSupabase.from('system_logs').insert({
        event_name: 'create_checkout_session_failure',
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
        severity: 'critical',
        metadata: {
          path: new URL(request.url).pathname,
        }
      });
    } catch (logError) {
      console.error('Failed to write system log to database:', logError);
    }

    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create checkout session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
