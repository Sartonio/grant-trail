// Characterization tests for stripe-subscription-sync.ts — pinning CURRENT
// decision behavior ahead of the pure-core extraction (subscription-sync-core).
//
// TESTABILITY INVENTORY (why this file is thin): stripe-subscription-sync.ts
// cannot be imported in a unit test AT ALL — it imports stripe-client.ts, which
// at module load reads Deno.env, THROWS if SUPABASE_URL / STRIPE_SECRET_KEY are
// absent, and constructs live Stripe + Supabase clients bound at module scope
// (no dependency injection, and Deno has no module mocking). The existing
// _shared tests (redirect, subscription-status) all test pure modules for the
// same reason. Consequently the following decision paths are UNREACHABLE by
// unit tests in the current shape and are pinned by transcription into the
// extracted core's tests (subscription-sync-core.test.ts) instead:
//   - stale-event skip via claim_stripe_subscription_event (ordering guard)
//   - missing price/product throw; missing billing_customers throw
//   - tenant-owned vs user-owned routing (billing_customers.tenant_id)
//   - membership-tier resolution (metadata.membership_tier / feature_key /
//     platform_settings product-id fallback) and the unknown-tier throw
//   - metadata.user_id parsing on tenant-owned customers
//   - tenant_memberships / user_memberships upsert payloads
//   - legacy premium mirror + non-premium demotion of the tenant mirror row
//   - listing auto-unlist / re-publish and accepts_sponsorships transitions
//     (incl. the null-tenant divergence: listing sync no-ops, sponsorship
//     sync throws)
// The only decision seam reachable today is the status -> is_active mapping
// the sync consumes from subscription-status.ts. Pinned here over the full
// Stripe status universe (subscription-status.test.ts covers the same module
// more narrowly; this pins the sync's derived is_active for every status the
// sync can receive from Stripe).
//
// Run:  deno test supabase/functions/_shared/stripe-subscription-sync.characterization.test.ts
import { isSubscriptionActive } from './subscription-status.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Every status Stripe can put on a Subscription, mapped to the is_active value
// upsertSubscriptionFromStripe writes into user_memberships / tenant_memberships.
const EXPECTED_IS_ACTIVE: Record<string, boolean> = {
  active: true,
  trialing: true,
  past_due: true, // read-only grace window (#40) — stays active
  canceled: false,
  unpaid: false,
  incomplete: false,
  incomplete_expired: false,
  paused: false,
};

Deno.test('sync derives membership is_active per the pinned status table', () => {
  for (const [status, expected] of Object.entries(EXPECTED_IS_ACTIVE)) {
    assert(
      isSubscriptionActive(status) === expected,
      `expected ${status} -> is_active=${expected}`,
    );
  }
});

Deno.test('unknown / empty statuses derive is_active=false', () => {
  for (const status of ['', 'ACTIVE', 'something_new']) {
    assert(isSubscriptionActive(status) === false, `expected '${status}' -> false`);
  }
});
