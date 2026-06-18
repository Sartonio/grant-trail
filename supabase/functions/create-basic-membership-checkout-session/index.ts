import { adminSupabase, corsHeaders, buildRedirectUrl, ensurePlatformMembershipProductIds, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe } from '../_shared/stripe.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));
    const { returnPath = '/', featureKey = 'basic_membership' } = await request.json().catch(() => ({}));
    const stripePriceId = Deno.env.get('STRIPE_PRICE_BASIC');

    if (!stripePriceId) {
      throw new Error('Missing STRIPE_PRICE_BASIC environment variable.');
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
        membership_tier: 'basic',
      },
      subscription_data: {
        metadata: {
          user_id: String(profile.profileId),
          feature_key: featureKey,
          membership_tier: 'basic',
        },
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Basic membership checkout session error:', error);
    try {
      await adminSupabase.from('system_logs').insert({
        event_name: 'create_basic_membership_checkout_session_failure',
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

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create basic membership checkout session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
