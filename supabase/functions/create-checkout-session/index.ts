import { corsHeaders, buildRedirectUrl, ensurePlatformMembershipProductIds, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe } from '../_shared/stripe.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));
    const { returnPath = '/', featureKey = 'admin_membership' } = await request.json().catch(() => ({}));
    const stripePriceId = Deno.env.get('STRIPE_PRICE_FISCAL_AGENT_ACCESS') || Deno.env.get('STRIPE_PRICE_PRO');

    if (!stripePriceId) {
      throw new Error('Missing STRIPE_PRICE_FISCAL_AGENT_ACCESS or STRIPE_PRICE_PRO environment variable.');
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
        membership_tier: 'premium',
      },
      subscription_data: {
        metadata: {
          user_id: String(profile.profileId),
          feature_key: featureKey,
          membership_tier: 'premium',
        },
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create checkout session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});