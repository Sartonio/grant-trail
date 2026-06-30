# components/billing

Subscription management UI.

- `SubscriptionPage.js` — shows current membership, starts Stripe checkout for a
  tier, opens the Stripe billing portal, and syncs membership from Stripe.
  Billing calls are wrapped in a timeout so an unreachable Stripe degrades gracefully.

Invariant: never talk to Stripe or hard-code price/product IDs here. Go through
`lib/billing.js` (`startCheckoutSession`, `startBillingPortalSession`,
`syncMembershipFromStripe`), which routes to the edge functions; product IDs come
from `platform_settings`. This is the billing nudge target (`/subscription`).
