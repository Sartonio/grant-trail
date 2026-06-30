import type Stripe from 'npm:stripe@18.1.1';
import { adminSupabase } from './stripe-client.ts';

// Pay-first charity (Fiscal Agent) tenant/listing/invite provisioning, run from
// the stripe-webhook on checkout completion.

const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:3000';

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'charity';
}

/**
 * Pay-first charity provisioning, run on `checkout.session.completed` for a
 * Checkout stamped with `provision_flow='fiscal_agent_onboarding'` (a premium-tier
 * subscription). Idempotent and best-effort-aware:
 *
 *   1. Ensure a `billing_customers` row links the Stripe customer to a public
 *      user (creating a tenant + invited admin user the FIRST time we see this
 *      billing email). This must run BEFORE `upsertSubscriptionFromStripe`, which
 *      requires that link to exist.
 *   2. Ensure a draft `fiscal_agent_listings` row exists for the tenant, seeded
 *      from the Checkout intake metadata.
 *   3. Ensure an `invites` row (role 'admin') exists — its token IS the signup
 *      link returned to the success page.
 *
 * Returns the invite token (the hard requirement) so the webhook can surface it.
 */
export async function provisionFiscalAgentFromCheckout(
  session: Stripe.Checkout.Session,
): Promise<{ token: string | null; signupUrl: string | null; email: string; orgName: string }> {
  const metadata = session.metadata ?? {};
  const email = String(
    metadata.intake_email ?? session.customer_details?.email ?? session.customer_email ?? '',
  )
    .trim()
    .toLowerCase();

  if (!email) {
    throw new Error('Fiscal agent provisioning requires a billing email.');
  }

  const stripeCustomerId = session.customer ? String(session.customer) : '';
  const orgName = String(metadata.intake_name ?? '').trim() || 'New Fiscal Agent';
  const focus = String(metadata.intake_focus ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  // --- Resolve / create the app user (tenant + invited admin) -----------------
  let userId: number | null = null;
  let tenantId: number | null = null;

  const { data: existingUser } = await adminSupabase
    .from('users')
    .select('id, tenant_id')
    .eq('email', email)
    .maybeSingle();

  if (existingUser) {
    userId = existingUser.id as number;
    tenantId = existingUser.tenant_id as number;
  } else {
    // New charity: create a managed tenant + an invited admin user. The user has
    // no auth.users row yet — the invite link is how they claim the account.
    let slug = slugify(orgName);
    const { data: slugClash } = await adminSupabase
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (slugClash) {
      slug = `${slug}-${crypto.randomUUID().slice(0, 6)}`;
    }

    const { data: tenant, error: tenantError } = await adminSupabase
      .from('tenants')
      .insert({ name: orgName, slug, tenant_type: 'managed' })
      .select('id')
      .single();
    if (tenantError || !tenant) {
      throw new Error(`Unable to create charity tenant: ${tenantError?.message}`);
    }
    tenantId = tenant.id as number;

    await adminSupabase
      .from('tenant_settings')
      .insert({ tenant_id: tenantId })
      .then(() => {}, () => {}); // tenant_settings may auto-exist; ignore conflict.

    const { data: user, error: userError } = await adminSupabase
      .from('users')
      .insert({
        tenant_id: tenantId,
        email,
        firstname: 'Pending',
        lastname: 'Setup',
        organization_name: orgName.slice(0, 50),
        phone_number: 'pending',
        role: 'admin',
        is_active: false,
      })
      .select('id')
      .single();
    if (userError || !user) {
      throw new Error(`Unable to create charity admin user: ${userError?.message}`);
    }
    userId = user.id as number;
  }

  // --- Link the Stripe customer so subscription sync can find the user --------
  if (stripeCustomerId) {
    const { data: existingCustomer } = await adminSupabase
      .from('billing_customers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!existingCustomer) {
      await adminSupabase
        .from('billing_customers')
        .insert({ user_id: userId, stripe_customer_id: stripeCustomerId })
        .then(() => {}, () => {}); // ignore unique-violation on concurrent webhooks.
    }
  }

  // --- Seed a draft listing (idempotent per tenant) --------------------------
  const { data: existingListing } = await adminSupabase
    .from('fiscal_agent_listings')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!existingListing) {
    const { error: listingError } = await adminSupabase.from('fiscal_agent_listings').insert({
      tenant_id: tenantId,
      owner_user_id: userId,
      name: orgName,
      location: String(metadata.intake_location ?? '') || null,
      ein: String(metadata.intake_ein ?? '') || null,
      focus,
      blurb: String(metadata.intake_blurb ?? '') || null,
      email,
      status: 'draft',
      verification: 'pending',
      accepting: true,
    });
    if (listingError) {
      throw new Error(`Unable to seed draft listing: ${listingError.message}`);
    }
  }

  // --- Invite row = signup link (hard requirement) ---------------------------
  let token: string | null = null;
  const { data: existingInvite } = await adminSupabase
    .from('invites')
    .select('token')
    .eq('tenant_id', tenantId)
    .eq('email', email)
    .is('used_at', null)
    .maybeSingle();

  if (existingInvite?.token) {
    token = String(existingInvite.token);
  } else {
    const { data: invite, error: inviteError } = await adminSupabase
      .from('invites')
      .insert({ tenant_id: tenantId, email, role: 'admin' })
      .select('token')
      .single();
    if (inviteError || !invite) {
      throw new Error(`Unable to create signup invite: ${inviteError?.message}`);
    }
    token = String(invite.token);
  }

  // Signup link = the /fiscal-agents/onboard route, which maps ?token= into the
  // invite-based CompleteProfile flow (see frontend App.js).
  const signupUrl = token
    ? `${appUrl}/fiscal-agents/onboard?token=${encodeURIComponent(token)}`
    : null;

  return { token, signupUrl, email, orgName };
}
