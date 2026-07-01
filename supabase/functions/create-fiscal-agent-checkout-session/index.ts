import { corsHeaders, buildRedirectUrl, stripe } from '../_shared/stripe.ts';
import { assertPostRequest, parseJsonBody, validateReturnPath, ValidationError } from '../_shared/validation.ts';
import { logSystemEvent } from '../_shared/logging.ts';

// Charity onboarding (pay-first). A charity becomes a fiscal agent under the
// existing PREMIUM plan ("Fiscal Agents Plan", STRIPE_PRICE_FISCAL_AGENT) — there is no
// separate fiscal_agent SKU. This is simply the pay-FIRST entry path into premium:
// it does NOT require an existing authenticated session. The charity supplies
// intake fields in the body; we stamp them into Checkout metadata (with
// provision_flow='fiscal_agent_onboarding') so the webhook can provision the
// tenant + draft listing + invite (the "signup link") on
// checkout.session.completed. No account/customer is created here, avoiding
// orphan accounts for abandoned checkouts.

const MAX_FIELD = 2000;

function readString(value: unknown, field: string, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ValidationError(`${field} is required.`);
    }
    return '';
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_FIELD) {
    throw new ValidationError(`${field} is too long.`);
  }
  return trimmed;
}

function readEmail(value: unknown): string {
  const email = readString(value, 'email', true);
  // Minimal shape check — Stripe is the system of record for the receipt address.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('email must be a valid email address.');
  }
  return email;
}

function normalizeFocus(value: unknown): string {
  // Accept either a string[] or comma-separated string; store as a comma list in
  // metadata (Stripe metadata values are strings). The webhook splits it back.
  if (value === undefined || value === null || value === '') {
    return '';
  }
  let parts: string[];
  if (Array.isArray(value)) {
    parts = value.map((v) => String(v).trim());
  } else if (typeof value === 'string') {
    parts = value.split(',').map((v) => v.trim());
  } else {
    throw new ValidationError('focus must be an array or comma-separated string.');
  }
  const joined = parts.filter(Boolean).join(',');
  if (joined.length > MAX_FIELD) {
    throw new ValidationError('focus is too long.');
  }
  return joined;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertPostRequest(request);
    const body = await parseJsonBody(request);
    const returnPath = validateReturnPath(body.returnPath);
    // Charity listing ownership folds into premium, so the pay-first onboarding
    // charges the premium price (the "Fiscal Agents Plan").
    const stripePriceId = Deno.env.get('STRIPE_PRICE_FISCAL_AGENT');

    if (!stripePriceId) {
      throw new Error('Missing STRIPE_PRICE_FISCAL_AGENT environment variable.');
    }

    const intake = {
      name: readString(body.name, 'name', true),
      location: readString(body.location, 'location', false),
      ein: readString(body.ein, 'ein', false),
      focus: normalizeFocus(body.focus),
      blurb: readString(body.blurb, 'blurb', false),
      email: readEmail(body.email),
    };

    // Pay-first: no customer/account exists yet. Let Stripe collect the customer
    // by email; the webhook resolves/creates the app-side records on completion.
    const metadata = {
      membership_tier: 'premium',
      provision_flow: 'fiscal_agent_onboarding',
      intake_name: intake.name,
      intake_location: intake.location,
      intake_ein: intake.ein,
      intake_focus: intake.focus,
      intake_blurb: intake.blurb,
      intake_email: intake.email,
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: intake.email,
      line_items: [{ price: stripePriceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: buildRedirectUrl(returnPath, '?checkout=success'),
      cancel_url: buildRedirectUrl(returnPath, '?checkout=canceled'),
      client_reference_id: intake.email,
      metadata,
      subscription_data: {
        metadata,
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
    console.error('Fiscal agent checkout session error:', error);
    await logSystemEvent(
      'create_fiscal_agent_checkout_session_failure',
      'critical',
      error instanceof Error ? error.message : String(error),
      { path: new URL(request.url).pathname },
      error instanceof Error ? error.stack : undefined,
    );

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to create checkout session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
