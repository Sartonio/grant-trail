import Stripe from 'npm:stripe@18.1.1';
import { createClient } from 'npm:@supabase/supabase-js@2.84.0';

// Stripe/Supabase client construction + the auth/customer helpers shared by
// every checkout/portal-session edge function (create-checkout-session,
// create-billing-portal-session, sync-my-subscription).

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:3000';

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

export function buildRedirectUrl(returnPath: string | undefined, querySuffix: string) {
  const normalizedPath = returnPath?.startsWith('/') ? returnPath : '/';
  // querySuffix begins with '?'; if the return path already carries a query
  // string (e.g. '/path?flow=onboarding'), join with '&' instead of a second '?'.
  const suffix = normalizedPath.includes('?') ? `&${querySuffix.replace(/^\?/, '')}` : querySuffix;
  return `${appUrl}${normalizedPath}${suffix}`;
}

export async function requireAuthenticatedProfile(authHeader: string | null) {
  const bearerToken = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!bearerToken) {
    throw new Error('Unauthorized');
  }

  const {
    data: { user },
    error: userError,
  } = await adminSupabase.auth.getUser(bearerToken);

  if (userError || !user) {
    throw new Error('Unauthorized');
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

  const { error: insertError } = await adminSupabase.from('billing_customers').insert({
    user_id: profile.profileId,
    stripe_customer_id: customer.id,
  });

  if (insertError) {
    throw new Error(`Unable to save billing customer: ${insertError.message}`);
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
