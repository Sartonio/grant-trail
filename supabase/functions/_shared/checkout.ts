import type Stripe from 'npm:stripe@18.1.1';
import { buildRedirectUrl } from './stripe.ts';

// Shared builder for the two membership checkout functions (premium + basic).
// They differ only by priceId / tier / featureKey; everything else — mode,
// promo codes, redirect URLs, client_reference_id, and the metadata (which is
// repeated verbatim in both `metadata` and `subscription_data.metadata`) — is
// identical, so it lives here once.
export function buildMembershipCheckoutSession(
  { customerId, priceId, tier, featureKey, profileId, returnPath }: {
    customerId: string;
    priceId: string;
    tier: string;
    featureKey: string;
    profileId: string | number;
    returnPath: string;
  },
): Stripe.Checkout.SessionCreateParams {
  const metadata = {
    user_id: String(profileId),
    feature_key: featureKey,
    membership_tier: tier,
  };
  return {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: buildRedirectUrl(returnPath, '?checkout=success'),
    cancel_url: buildRedirectUrl(returnPath, '?checkout=canceled'),
    client_reference_id: String(profileId),
    metadata,
    subscription_data: { metadata },
  };
}
