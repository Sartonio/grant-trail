import Stripe from 'npm:stripe@18.1.1';
import { createClient } from 'npm:@supabase/supabase-js@2.84.0';

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
  return `${appUrl}${normalizedPath}${querySuffix}`;
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
  const premiumPriceId = Deno.env.get('STRIPE_PRICE_FISCAL_AGENT_ACCESS') || Deno.env.get('STRIPE_PRICE_PRO') || '';

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

export async function upsertSubscriptionFromStripe(subscription: Stripe.Subscription) {
  await ensurePlatformMembershipProductIds();

  const stripeCustomerId = String(subscription.customer);
  const price = subscription.items.data[0]?.price;
  const priceId = price?.id;
  const productId = typeof price?.product === 'string' ? price.product : '';

  if (!priceId || !productId) {
    throw new Error('Subscription is missing a Stripe price id.');
  }

  const { data: billingCustomer, error: customerError } = await adminSupabase
    .from('billing_customers')
    .select('user_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (customerError || !billingCustomer) {
    throw new Error('No billing customer found for Stripe customer id.');
  }

  const metadata = subscription.metadata ?? {};
  let membershipTier = String(metadata.membership_tier ?? '').toLowerCase();

  if (!membershipTier) {
    const featureKey = String(metadata.feature_key ?? '').toLowerCase();
    if (featureKey === 'basic_membership') membershipTier = 'basic';
    if (featureKey === 'premium_membership' || featureKey === 'admin_membership' || featureKey === 'excel_export') membershipTier = 'premium';
  }

  if (membershipTier !== 'basic' && membershipTier !== 'premium') {
    const { data: platform } = await adminSupabase
      .from('platform_settings')
      .select('basic_membership_product_id, premium_membership_product_id')
      .eq('id', 1)
      .maybeSingle();

    const basicProduct = String(platform?.basic_membership_product_id ?? '');
    const premiumProduct = String(platform?.premium_membership_product_id ?? '');

    if (productId === basicProduct) membershipTier = 'basic';
    if (productId === premiumProduct) membershipTier = 'premium';
  }

  if (membershipTier !== 'basic' && membershipTier !== 'premium') {
    throw new Error('Unable to determine membership tier from subscription metadata/product.');
  }

  const payload = {
    user_id: billingCustomer.user_id,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: subscription.id,
    stripe_product_id: productId,
    stripe_price_id: priceId,
    membership_tier: membershipTier,
    status: subscription.status,
    current_period_start: subscription.items.data[0]?.current_period_start
      ? new Date(subscription.items.data[0].current_period_start * 1000).toISOString()
      : null,
    current_period_end: subscription.items.data[0]?.current_period_end
      ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    metadata,
  };

  const { data: subscriptionRow, error: upsertError } = await adminSupabase
    .from('subscriptions')
    .upsert(payload, { onConflict: 'stripe_subscription_id' })
    .select('id')
    .single();

  if (upsertError) {
    throw new Error(`Unable to upsert subscription: ${upsertError.message}`);
  }

  const isActive = ['active', 'trialing', 'past_due'].includes(subscription.status);

  const membershipPayload = {
    user_id: billingCustomer.user_id,
    subscription_id: subscriptionRow?.id ?? null,
    membership_tier: membershipTier,
    is_active: isActive,
    starts_at: payload.current_period_start ?? new Date().toISOString(),
    ends_at: payload.current_period_end,
    source: 'stripe',
  };

  const { error: membershipError } = await adminSupabase
    .from('user_memberships')
    .upsert(membershipPayload, { onConflict: 'user_id' });

  if (membershipError) {
    throw new Error(`Unable to sync user membership: ${membershipError.message}`);
  }
}
