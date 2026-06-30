// Pure status -> membership-active mapping, extracted from stripe.ts so the
// grace-window invariant can be unit-tested without the full Stripe forwarder.
//
// past_due is INCLUDED on purpose: it keeps membership.is_active true during the
// read-only grace window (#40), even though a past_due premium owner's listing
// is still auto-unlisted (see syncListingPublicationFromSubscription). Any other
// status (canceled, unpaid, incomplete, paused, ...) is inactive.
export const ACTIVE_MEMBERSHIP_STATUSES = ['active', 'trialing', 'past_due'] as const;

export function isSubscriptionActive(status: string): boolean {
  return (ACTIVE_MEMBERSHIP_STATUSES as readonly string[]).includes(status);
}
