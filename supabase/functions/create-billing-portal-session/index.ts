import { buildRedirectUrl, corsHeaders, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe } from '../_shared/stripe.ts';
import { assertPostRequest, parseJsonBody, validateReturnPath, ValidationError } from '../_shared/validation.ts';
import { logSystemEvent } from '../_shared/logging.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertPostRequest(request);
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));
    const body = await parseJsonBody(request);
    const returnPath = validateReturnPath(body.returnPath);
    const customerId = await getOrCreateStripeCustomer(profile);
    const portalConfigurationId = Deno.env.get('STRIPE_BILLING_PORTAL_CONFIGURATION_ID');

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: buildRedirectUrl(returnPath, ''),
      configuration: portalConfigurationId,
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
    console.error('Billing portal session error:', error);
    await logSystemEvent(
      'create_billing_portal_session_failure',
      'critical',
      error instanceof Error ? error.message : String(error),
      { path: new URL(request.url).pathname },
      error instanceof Error ? error.stack : undefined,
    );

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create billing portal session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});