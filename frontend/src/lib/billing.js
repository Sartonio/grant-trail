import { supabase } from '../supabaseClient';
// The app has exactly two tiers. Charity listing ownership is NOT a tier — it
// is a tenant-level entitlement (tenants.accepts_sponsorships) set by the
// billing sync while the ORG_ADMIN ('premium', "Fiscal Agents Plan")
// subscription is active. See policy.canOwnListing.
export const MEMBERSHIP_TIERS = {
  BASIC: 'basic',
  ORG_ADMIN: 'premium',
};

export const FEATURE_KEYS = {
  BASIC_MEMBERSHIP: 'basic_membership',
  ADMIN_MEMBERSHIP: 'admin_membership',
  EXCEL_EXPORT: 'excel_export',
};

// Single checkout function for both tiers; it derives price + tier from the
// feature key (basic_membership -> basic, everything else -> premium).
const CHECKOUT_FUNCTION_CANDIDATES = [
  'create-checkout-session',
];

const PORTAL_FUNCTION_CANDIDATES = [
  'create-billing-portal-session',
];

const SYNC_MEMBERSHIP_FUNCTION_CANDIDATES = [
  'sync-my-subscription',
];

// Stripe product IDs are never hard-coded. They come from platform_settings
// (kept in sync from the configured Stripe price env vars by the Edge Functions),
// with an optional build-time env override for environments that prefer to pin
// them. No literal product ID ships in the bundle.
const ENV_BASIC_PRODUCT_ID = import.meta.env.VITE_STRIPE_PRODUCT_BASIC || '';
const ENV_PREMIUM_PRODUCT_ID = import.meta.env.VITE_STRIPE_PRODUCT_PREMIUM || '';
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY || '';

let cachedProductIds = null;

export function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const raw = typeof atob === 'function'
      ? atob(padded)
      // @ts-ignore Buffer is the Node fallback used when the browser atob is absent (SSR/tests).
      : Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function getExpectedProjectRef() {
  try {
    const host = new URL(SUPABASE_URL).hostname;
    return host.split('.')[0] || null;
  } catch (_error) {
    return null;
  }
}

export async function getRequiredAccessToken() {
  const expectedRef = getExpectedProjectRef();

  // Force a token refresh first so edge functions receive a currently valid JWT.
  const refreshed = await supabase.auth.refreshSession();
  let accessToken = refreshed?.data?.session?.access_token || '';

  if (!accessToken) {
    const { data: sessionData } = await supabase.auth.getSession();
    accessToken = sessionData?.session?.access_token || '';
  }

  if (!accessToken) {
    throw new Error('No active login session found. Please sign in again and retry.');
  }

  const payload = decodeJwtPayload(accessToken);
  const tokenRef = payload?.ref || null;
  if (expectedRef && tokenRef && tokenRef !== expectedRef) {
    await supabase.auth.signOut();
    throw new Error('Your login session belongs to a different Supabase project. Please sign in again.');
  }

  return accessToken;
}

async function getMembershipProductIds() {
  if (cachedProductIds) return cachedProductIds;

  const { data, error } = await supabase
    .from('platform_settings')
    .select('basic_membership_product_id, premium_membership_product_id')
    .eq('id', 1)
    .single();

  if (error) {
    cachedProductIds = {
      basic: ENV_BASIC_PRODUCT_ID,
      premium: ENV_PREMIUM_PRODUCT_ID,
    };
    return cachedProductIds;
  }

  cachedProductIds = {
    basic: data?.basic_membership_product_id || ENV_BASIC_PRODUCT_ID,
    premium: data?.premium_membership_product_id || ENV_PREMIUM_PRODUCT_ID,
  };

  return cachedProductIds;
}

export async function invokeFirstAvailable(functionNames, payloadFactory) {
  let lastError = null;

  for (const fnName of functionNames) {
    const payload = payloadFactory(fnName);
    try {
      const data = await invokeViaHttp(fnName, payload);
      if (data?.url) {
        return data;
      }
      lastError = new Error(`Function ${fnName} did not return a checkout URL.`);
      continue;
    } catch (error) {
      lastError = withFetchDiagnostics(error);
    }
  }

  throw lastError || new Error('Unable to start billing flow. No checkout function could be reached.');
}

function withFetchDiagnostics(error) {
  const message = (error && error.message) || String(error || 'Unknown error');
  if (/failed to fetch|networkerror|fetch failed/i.test(message)) {
    return new Error(
      `${message}. Check that Edge Functions are deployed, your project URL/key are correct, and your browser/network is not blocking requests to *.functions.supabase.co.`
    );
  }
  return error instanceof Error ? error : new Error(message);
}

async function invokeViaHttp(functionName, payload) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase configuration is missing for direct Edge Function fallback.');
  }

  const accessToken = await getRequiredAccessToken();

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const body = safeJsonParse(text);

  if (!response.ok) {
    const reason = body?.error || body?.message || text || `HTTP ${response.status}`;
    throw new Error(`Edge Function ${functionName} failed: ${reason}`);
  }

  return body;
}

function safeJsonParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_error) {
    return null;
  }
}

export async function startCheckoutSession({ membershipTier, returnPath = '/subscription' }) {
  const productIds = await getMembershipProductIds();
  const isOrgAdminPlan = membershipTier === MEMBERSHIP_TIERS.ORG_ADMIN;
  const stripeProductId = isOrgAdminPlan ? productIds.premium : productIds.basic;
  const featureKey = isOrgAdminPlan ? FEATURE_KEYS.ADMIN_MEMBERSHIP : FEATURE_KEYS.BASIC_MEMBERSHIP;

  return invokeFirstAvailable(CHECKOUT_FUNCTION_CANDIDATES, () => ({
    membershipTier,
    membership_tier: membershipTier,
    tier: membershipTier,
    stripeProductId,
    stripe_product_id: stripeProductId,
    productId: stripeProductId,
    product_id: stripeProductId,
    featureKey,
    feature_key: featureKey,
    returnPath,
    return_path: returnPath,
    returnOrigin: currentOrigin(),
  }));
}

export async function startBillingPortalSession({ returnPath = '/subscription' } = {}) {
  return invokeFirstAvailable(PORTAL_FUNCTION_CANDIDATES, () => ({
    returnPath,
    returnOrigin: currentOrigin(),
  }));
}

// The origin Stripe should return to. The edge function only honours it if it's
// on the server-side allowlist (else it falls back to APP_URL), so previews come
// back to their own URL while unknown origins can't be used as open redirects.
// Undefined in SSR/tests — JSON.stringify drops it, so the server uses APP_URL.
function currentOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : undefined;
}

export async function syncMembershipFromStripe() {
  return invokeFirstAvailable(SYNC_MEMBERSHIP_FUNCTION_CANDIDATES, () => ({}));
}

// Single-round-trip session bootstrap (issue #12). Returns the authenticated
// user's profile, tenant, tenant settings and membership status in one RPC,
// replacing the former chain of sequential queries during login. Resolves to
// `null` when the auth user has no profile row yet (needs profile completion).
export async function fetchSessionContext() {
  const { data, error } = await supabase.rpc('get_session_context');
  if (error) throw error;
  if (!data || !data.user) return null;

  const tenant = data.tenant || null;
  const tenantConfig = {
    ...(data.tenantSettings || {}),
    type: tenant?.tenant_type,
    name: tenant?.name,
    // Charity Directory entitlement flag (see policy.canOwnListing).
    accepts_sponsorships: !!tenant?.accepts_sponsorships,
  };

  const membership = data.membership || null;

  return {
    userRecord: data.user,
    tenant,
    tenantConfig,
    membership,
  };
}

export async function fetchMembershipStatus() {
  const [
    exemptRes,
    basicRes,
    premiumRes,
    membershipRes,
    subscriptionsRes,
  ] = await Promise.all([
    supabase.rpc('is_membership_exempt'),
    supabase.rpc('has_basic_membership'),
    supabase.rpc('has_premium_membership'),
    supabase
      .from('user_memberships')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('subscriptions')
      .select('*')
      .in('status', ['active', 'trialing', 'past_due'])
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);

  if (exemptRes.error || basicRes.error || premiumRes.error) {
    throw exemptRes.error || basicRes.error || premiumRes.error;
  }

  const activeSubscription = (subscriptionsRes.data || [])[0] || null;

  return {
    isExempt: !!exemptRes.data,
    hasBasicAccess: !!basicRes.data,
    hasPremiumAccess: !!premiumRes.data,
    membership: membershipRes.data || null,
    activeSubscription,
  };
}

export function isOrgAdminSubscriptionRequired(session) {
  const role = session?.userRecord?.role;
  if (role !== 'admin') return false;
  return !session?.membership?.isExempt;
}

export function hasFeature(session, featureKey) {
  if (!session?.membership) return false;
  if (session.membership.isExempt) return true;

  if (featureKey === FEATURE_KEYS.EXCEL_EXPORT) {
    return !!session.membership.hasBasicAccess || !!session.membership.hasPremiumAccess;
  }

  return false;
}

export function hasActiveSubscription(session) {
  if (!session?.membership) return false;
  return !!session.membership.hasBasicAccess;
}
