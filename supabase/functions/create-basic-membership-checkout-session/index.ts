import { corsHeaders, ensurePlatformMembershipProductIds, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe } from '../_shared/stripe.ts';
import { assertPostRequest, parseJsonBody, validateFeatureKey, validateReturnPath, ValidationError } from '../_shared/validation.ts';
import { buildMembershipCheckoutSession } from '../_shared/checkout.ts';
import { logSystemEvent } from '../_shared/logging.ts';

const ALLOWED_FEATURE_KEYS = ['basic_membership'];

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertPostRequest(request);
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));
    const body = await parseJsonBody(request);
    const returnPath = validateReturnPath(body.returnPath);
    const featureKey = validateFeatureKey(body.featureKey, ALLOWED_FEATURE_KEYS, 'basic_membership');
    const stripePriceId = Deno.env.get('STRIPE_PRICE_BASIC');

    if (!stripePriceId) {
      throw new Error('Missing STRIPE_PRICE_BASIC environment variable.');
    }

    await ensurePlatformMembershipProductIds();

    const customerId = await getOrCreateStripeCustomer(profile);
    const session = await stripe.checkout.sessions.create(buildMembershipCheckoutSession({
      customerId,
      priceId: stripePriceId,
      tier: 'basic',
      featureKey,
      profileId: profile.profileId,
      returnPath,
    }));

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
    console.error('Basic membership checkout session error:', error);
    await logSystemEvent(
      'create_basic_membership_checkout_session_failure',
      'critical',
      error instanceof Error ? error.message : String(error),
      { path: new URL(request.url).pathname },
      error instanceof Error ? error.stack : undefined,
    );

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create basic membership checkout session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
