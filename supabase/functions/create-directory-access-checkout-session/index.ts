import { adminSupabase, corsHeaders, buildRedirectUrl, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe } from '../_shared/stripe.ts';
import { assertPostRequest, parseJsonBody, validateReturnPath, ValidationError } from '../_shared/validation.ts';

// Seeker entitlement: Directory Access. Requires an authenticated user (mirrors
// create-checkout-session). The price is env-configured; tier is stamped into
// metadata so the webhook's upsertSubscriptionFromStripe maps it to the
// directory_access membership.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertPostRequest(request);
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));
    const body = await parseJsonBody(request);
    const returnPath = validateReturnPath(body.returnPath);
    const stripePriceId = Deno.env.get('STRIPE_PRICE_DIRECTORY');

    if (!stripePriceId) {
      throw new Error('Missing STRIPE_PRICE_DIRECTORY environment variable.');
    }

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
        membership_tier: 'directory_access',
      },
      subscription_data: {
        metadata: {
          user_id: String(profile.profileId),
          membership_tier: 'directory_access',
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
    console.error('Directory access checkout session error:', error);
    try {
      await adminSupabase.from('system_logs').insert({
        event_name: 'create_directory_access_checkout_session_failure',
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
        severity: 'critical',
        metadata: {
          path: new URL(request.url).pathname,
        },
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
