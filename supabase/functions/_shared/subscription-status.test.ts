// Fast, dependency-free Deno unit test for the Stripe status -> is_active
// mapping (gap #6). Catches a grace-window regression (e.g. past_due flipped to
// inactive) without standing up the live Stripe forwarder.
//
// Run:  deno test supabase/functions/_shared/subscription-status.test.ts
//
// Inline asserts (no std import) so it runs offline with zero setup.
import { isSubscriptionActive } from './subscription-status.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test('active, trialing and past_due map to is_active=true', () => {
  for (const status of ['active', 'trialing', 'past_due']) {
    assert(isSubscriptionActive(status) === true, `expected ${status} -> true`);
  }
});

Deno.test('every other status maps to is_active=false', () => {
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '']) {
    assert(isSubscriptionActive(status) === false, `expected ${status} -> false`);
  }
});
