import { adminSupabase, buildRedirectUrl, corsHeaders, getOrCreateStripeCustomer, requireAuthenticatedProfile, stripe } from '../_shared/stripe.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { profile } = await requireAuthenticatedProfile(request.headers.get('Authorization'));
    const { returnPath = '/' } = await request.json().catch(() => ({}));
    const customerId = await getOrCreateStripeCustomer(profile);
    const portalConfigurationId = Deno.env.get('STRIPE_BILLING_PORTAL_CONFIGURATION_ID') || undefined;

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
    console.error('Billing portal session error:', error);
    try {
      await adminSupabase.from('system_logs').insert({
        event_name: 'create_billing_portal_session_failure',
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

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create billing portal session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});