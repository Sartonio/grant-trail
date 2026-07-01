import { adminSupabase, corsHeaders, buildRedirectUrl, ensurePlatformMembershipProductIds, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe } from '../_shared/stripe-client.ts';
import { assertPostRequest, parseJsonBody, validateFeatureKey, validateReturnPath, ValidationError } from '../_shared/validation.ts';

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
    const featureKey = validateFeatureKey(body.featureKey, ALLOWED_FEATURE_KEYS, 'admin_membership');
    const { tier, priceEnv } = TIER_BY_FEATURE_KEY[featureKey];
    const stripePriceId = Deno.env.get(priceEnv);

    if (!stripePriceId) {
      throw new Error(`Missing ${priceEnv} environment variable.`);
    }

    await ensurePlatformMembershipProductIds();

    const customerId = await getOrCreateStripeCustomer(profile);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: buildRedirectUrl(returnPath, '?checkout=success'),
      cancel_url: buildRedirectUrl(returnPath, '?checkout=canceled'),
      client_reference_id: String(profile.profileId),
      metadata: {
        user_id: String(profile.profileId),
        feature_key: featureKey,
        membership_tier: tier,
      },
      subscription_data: {
        metadata: {
          user_id: String(profile.profileId),
          feature_key: featureKey,
          membership_tier: tier,
        },
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

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create checkout session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
