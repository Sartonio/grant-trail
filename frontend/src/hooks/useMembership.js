import * as Sentry from '@sentry/react';
import { fetchMembershipStatus, syncMembershipFromStripe } from '../lib/billing';

// No user record yet, or a role-exempt user (super_admin): passes every gate.
const EXEMPT_MEMBERSHIP = {
  isExempt: true,
  hasBasicAccess: true,
  hasPremiumAccess: true,
  membership: null,
  activeSubscription: null,
};

// Fetch failed: fail closed, deny every gate until a successful load.
const RESTRICTED_MEMBERSHIP = {
  isExempt: false,
  hasBasicAccess: false,
  hasPremiumAccess: false,
  membership: null,
  activeSubscription: null,
};

// Membership helpers. `loadMembershipStatus` resolves the membership status for a
// user record (super_admins are exempt); `refreshMembership` syncs from Stripe and
// updates the session in place. Session ownership stays in App — the hook closes
// over the passed-in `session` / `setSession`.
export function useMembership(session, setSession) {
  // super_admins are exempt, while grantees and some admins can require billing.
  async function loadMembershipStatus(userRecord) {
    if (!userRecord) return EXEMPT_MEMBERSHIP;
    if (userRecord.role === 'super_admin') return EXEMPT_MEMBERSHIP;
    try {
      return await fetchMembershipStatus();
    } catch (_error) {
      return RESTRICTED_MEMBERSHIP;
    }
  }

  async function refreshMembership() {
    if (!session?.userRecord || session.userRecord.role === 'super_admin') return;
    try {
      await syncMembershipFromStripe();
      const membership = await fetchMembershipStatus();
      setSession(prev => (prev ? { ...prev, membership: { ...membership } } : prev));
    } catch (err) {
      console.error('Failed to refresh membership:', err);
      Sentry.captureException(err);
    }
  }

  return { loadMembershipStatus, refreshMembership };
}
