import { adminSupabase, buildRedirectUrl, corsHeaders, getOrCreateStripeCustomer, isMissingCustomerError, requireAuthenticatedProfile, stripe } from '../_shared/stripe-client.ts';
import { assertPostRequest, AuthError, parseJsonBody, validateReturnOrigin, validateReturnPath, ValidationError } from '../_shared/validation.ts';

// Admin roles that may manage the org plan. super_admin is billing-exempt but is
// still an org admin and may open the tenant portal if one happens to exist.
const ADMIN_ROLES = ['admin', 'super_admin'];

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

    // "Any current admin manages the org plan in one place": if the caller's
    // tenant has a tenant-owned billing customer AND the caller is an admin, open
    // the portal for the TENANT customer — even an admin who never paid. Look up
    // (not get-or-create) the tenant customer; a missing one falls through to the
    // caller's per-user customer (current behavior + its no-customer error path).
    // `isTenantCustomer` records which billing_customers row supplied the ID so
    // the self-heal path below can clear the right row on a stale customer.
    let customerId: string | null = null;
    let isTenantCustomer = false;
    if (ADMIN_ROLES.includes(profile.role) && profile.tenantId) {
      const { data: tenantCustomer, error: tenantCustomerError } = await adminSupabase
        .from('billing_customers')
        .select('stripe_customer_id')
        .eq('tenant_id', profile.tenantId)
        .maybeSingle();
      if (tenantCustomerError) {
        throw new Error(`Unable to load tenant billing customer: ${tenantCustomerError.message}`);
      }
      customerId = tenantCustomer?.stripe_customer_id ?? null;
      isTenantCustomer = !!customerId;
    }

    if (!customerId) {
      customerId = await getOrCreateStripeCustomer(profile);
      isTenantCustomer = false;
    }

    const portalConfigurationId = Deno.env.get('STRIPE_BILLING_PORTAL_CONFIGURATION_ID') || undefined;
    const returnUrl = buildRedirectUrl(returnPath, '', returnOrigin);

    let session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
        configuration: portalConfigurationId,
      });
    } catch (portalError) {
      // Self-heal a stale/seeded customer ID: the billing_customers row points at
      // a customer that no longer exists in this Stripe account (e.g. a test-mode
      // ID against live keys, or restored data). Clear the offending row and
      // retry ONCE against a freshly created customer. Anything else re-throws.
      if (!isMissingCustomerError(portalError)) {
        throw portalError;
      }

      if (isTenantCustomer && profile.tenantId) {
        // Clear the stale tenant-owned row, then fall through to the caller's
        // per-user customer (mirrors the "missing tenant customer" semantics).
        await adminSupabase.from('billing_customers').delete().eq('tenant_id', profile.tenantId);
        customerId = await getOrCreateStripeCustomer(profile);
      } else {
        // Clear the stale per-user row, then get-or-create makes a fresh customer.
        await adminSupabase.from('billing_customers').delete().eq('user_id', profile.profileId);
        customerId = await getOrCreateStripeCustomer(profile);
      }

      session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
        configuration: portalConfigurationId,
      });
    }

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

    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create billing portal session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});