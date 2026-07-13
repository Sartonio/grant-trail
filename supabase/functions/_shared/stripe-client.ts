import Stripe from 'npm:stripe@18.1.1';
import { createClient } from 'npm:@supabase/supabase-js@2.84.0';
import { AuthError } from './validation.ts';
import { parseAllowedOrigins, requireHttpOrigin, resolveAppOrigin } from './redirect.ts';

// Stripe/Supabase client construction + the auth/customer helpers shared by
// every checkout/portal-session edge function (create-checkout-session,
// create-billing-portal-session, sync-my-subscription).

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
// APP_URL is the fallback redirect base for Stripe success/cancel URLs. Stripe
// rejects URLs without an explicit scheme (`url_invalid`), and a scheme-less env
// (e.g. "www.example.org" instead of "https://www.example.org") otherwise fails
// silently at checkout time. Validate it at boot so a misconfig fails loudly.
const appUrl = requireHttpOrigin('APP_URL', Deno.env.get('APP_URL') ?? 'http://localhost:3000');
// Extra origins the frontend may redirect back to (e.g. Vercel previews).
// Comma-separated; exact origins or `https://*.<account-scoped-suffix>` wildcards.
const allowedReturnOrigins = parseAllowedOrigins(Deno.env.get('APP_URL_ALLOWED_ORIGINS'));

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase environment variables for Stripe billing functions.');
}

if (!stripeSecretKey) {
  throw new Error('Missing STRIPE_SECRET_KEY environment variable.');
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2025-02-24.acacia',
});

export const adminSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export function getUserSupabaseClient(authHeader: string | null) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function buildRedirectUrl(
  returnPath: string | undefined,
  querySuffix: string,
  returnOrigin?: string,
) {
  // Honour a client-supplied origin only if it's on the allowlist; otherwise
  // fall back to APP_URL. Never trust the raw origin as the redirect base.
  const base = resolveAppOrigin(returnOrigin, appUrl, allowedReturnOrigins);
  const normalizedPath = returnPath?.startsWith('/') ? returnPath : '/';
  // querySuffix begins with '?'; if the return path already carries a query
  // string (e.g. '/path?flow=onboarding'), join with '&' instead of a second '?'.
  const suffix = normalizedPath.includes('?') ? `&${querySuffix.replace(/^\?/, '')}` : querySuffix;
  return `${base}${normalizedPath}${suffix}`;
}

export async function requireAuthenticatedProfile(authHeader: string | null) {
  const bearerToken = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!bearerToken) {
    throw new AuthError('Unauthorized');
  }

  const {
    data: { user },
    error: userError,
  } = await adminSupabase.auth.getUser(bearerToken);

  if (userError || !user) {
    throw new AuthError('Unauthorized');
  }

  // Billing schema is anchored to public.users — look up the app user record directly.
  const { data: userRecord, error: userErrorRecord } = await adminSupabase
    .from('users')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (userErrorRecord || !userRecord) {
    throw new Error('No user profile found for the authenticated user.');
  }

  return {
    user,
    profile: {
      profileTable: 'users' as const,
      profileId: userRecord.id as number,
      // select('*') already pulls tenant_id off public.users — surface it so the
      // tenant-owned premium billing helpers don't need a second round-trip.
      tenantId: (userRecord.tenant_id ?? null) as number | null,
      role: (userRecord.role ?? 'grantee') as string,
      record: userRecord as Record<string, unknown>,
    },
  };
}

export async function getOrCreateStripeCustomer(profile: {
  profileTable: string;
  profileId: number;
  record: Record<string, unknown>;
}) {
  const { data: existingCustomer, error } = await adminSupabase
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', profile.profileId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load billing customer: ${error.message}`);
  }

  if (existingCustomer?.stripe_customer_id) {
    return existingCustomer.stripe_customer_id;
  }

  const firstName = String(profile.record.firstname ?? '');
  const lastName = String(profile.record.lastname ?? '');
  const email = String(profile.record.email ?? '');
  const organizationName = String(profile.record.organization_name ?? '');

  const customer = await stripe.customers.create({
    email,
    name: `${firstName} ${lastName}`.trim(),
    metadata: {
      user_id: String(profile.profileId),
      organization_name: organizationName,
    },
  });

  // Upsert, not insert: get-or-create is not atomic (the Stripe round-trip sits
  // between the SELECT and this write), so a concurrent call or a leftover row
  // would make a plain INSERT die on billing_customers_user_id_key. Last writer
  // wins; both writers hold a freshly created customer for the same user.
  const { error: insertError } = await adminSupabase.from('billing_customers').upsert(
    {
      user_id: profile.profileId,
      stripe_customer_id: customer.id,
    },
    { onConflict: 'user_id' },
  );

  if (insertError) {
    throw new Error(`Unable to save billing customer: ${insertError.message}`);
  }

  return customer.id;
}

/**
 * Get-or-create the TENANT's Stripe customer for tenant-owned premium billing.
 *
 * The premium ("Fiscal Agents Plan") tier is tenant-owned: one Stripe customer
 * per tenant (billing_customers.tenant_id, partial-unique per the migration),
 * so any admin of the org drives the same customer / invoices / portal and a
 * second admin can never double-provision. Mirrors getOrCreateStripeCustomer's
 * lookup + race handling, keyed on tenant_id instead of user_id. The
 * billing_customers CHECK requires exactly one owner, so the inserted row sets
 * tenant_id and leaves user_id NULL.
 */
export async function getOrCreateStripeCustomerForTenant(profile: {
  tenantId: number | null;
  record: Record<string, unknown>;
}) {
  const tenantId = profile.tenantId;
  if (!tenantId) {
    throw new Error('No tenant on the authenticated profile for tenant billing.');
  }

  const { data: existingCustomer, error } = await adminSupabase
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load tenant billing customer: ${error.message}`);
  }

  if (existingCustomer?.stripe_customer_id) {
    return existingCustomer.stripe_customer_id;
  }

  // Name the Stripe customer after the org/tenant; fall back to the caller's
  // organization_name if the tenant name lookup comes back empty.
  const { data: tenant } = await adminSupabase
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const email = String(profile.record.email ?? '');
  const tenantName = String(tenant?.name ?? profile.record.organization_name ?? '');

  const customer = await stripe.customers.create({
    email,
    name: tenantName,
    metadata: {
      tenant_id: String(tenantId),
    },
  });

  // Upsert on the tenant_id partial-unique index: get-or-create is not atomic
  // (the Stripe round-trip sits between the SELECT and this write), so a
  // concurrent second admin or a leftover row would make a plain INSERT die on
  // idx_billing_customers_tenant_id. Last writer wins; both hold a freshly
  // created customer for the same tenant. user_id stays NULL (the one-owner
  // CHECK requires exactly one of user_id / tenant_id).
  const { error: insertError } = await adminSupabase.from('billing_customers').upsert(
    {
      tenant_id: tenantId,
      user_id: null,
      stripe_customer_id: customer.id,
    },
    { onConflict: 'tenant_id' },
  );

  if (insertError) {
    throw new Error(`Unable to save tenant billing customer: ${insertError.message}`);
  }

  return customer.id;
}

export async function ensurePlatformMembershipProductIds() {
  const basicPriceId = Deno.env.get('STRIPE_PRICE_BASIC') ?? '';
  const premiumPriceId = Deno.env.get('STRIPE_PRICE_FISCAL_AGENT') || '';

  if (!basicPriceId && !premiumPriceId) {
    return;
  }

  const updates: Record<string, string> = {};

  if (basicPriceId) {
    const basicPrice = await stripe.prices.retrieve(basicPriceId);
    const basicProductId = typeof basicPrice.product === 'string' ? basicPrice.product : basicPrice.product?.id;
    if (!basicProductId) {
      throw new Error('Unable to determine the Stripe product for STRIPE_PRICE_BASIC.');
    }
    updates.basic_membership_product_id = basicProductId;
  }

  if (premiumPriceId) {
    const premiumPrice = await stripe.prices.retrieve(premiumPriceId);
    const premiumProductId = typeof premiumPrice.product === 'string' ? premiumPrice.product : premiumPrice.product?.id;
    if (!premiumProductId) {
      throw new Error('Unable to determine the Stripe product for the premium membership price.');
    }
    updates.premium_membership_product_id = premiumProductId;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  const { error } = await adminSupabase
    .from('platform_settings')
    .upsert({ id: 1, ...updates }, { onConflict: 'id' });

  if (error) {
    throw new Error(`Unable to sync platform membership product settings: ${error.message}`);
  }
}
