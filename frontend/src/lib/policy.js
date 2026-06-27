// src/lib/policy.js
//
// Centralized authorization + billing policy (issue #41).
//
// Two orthogonal axes drive every route decision:
//   1. ROLE       — who the user is (super_admin / admin / grantee / logged-out)
//   2. BILLING    — whether the user has the subscription their role requires
//
// Historically these were tangled together in App.js (one ternary, one /home
// redirect) and partly in lib/billing.js (hasRequiredSubscription). This module
// is the single source of truth so routes consume one decision and the two
// redirects stay semantically distinct:
//   - wrong role / not authenticated -> a role redirect (/login or /)
//   - authenticated but unpaid       -> the billing nudge (/subscription)
//
// Billing-lapse policy (issue #40 = read-only degrade): a lapsed admin can VIEW
// every admin route read-only but cannot perform mutations. Mutation attempts
// route to the billing nudge. See `canMutate`.

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  GRANTEE: 'grantee',
};

// Where unpaid-but-authenticated users are nudged to pay.
export const BILLING_NUDGE_PATH = '/subscription';

export function getRole(session) {
  return session?.userRecord?.role || null;
}

export function isAuthenticated(session) {
  return !!session?.userRecord;
}

// --- Billing axis -----------------------------------------------------------

// Does this session satisfy the subscription its role requires?
//   super_admin -> always (exempt by role)
//   admin       -> exempt/waived OR premium membership
//   grantee     -> basic membership
//   no role     -> false
//
// This is the single subscription decision; it replaces the copy that used to
// live in both App.js and lib/billing.js:hasRequiredSubscription.
export function hasRequiredSubscription(session) {
  const role = getRole(session);
  if (!role) return false;
  if (role === ROLES.SUPER_ADMIN) return true;
  if (role === ROLES.ADMIN) {
    return !!session?.membership?.isExempt || !!session?.membership?.hasPremiumAccess;
  }
  return !!session?.membership?.hasBasicAccess;
}

// True when an authenticated, non-super_admin user is missing the subscription
// their role requires (i.e. should be nudged to pay).
export function needsSubscription(session) {
  if (!isAuthenticated(session)) return false;
  if (getRole(session) === ROLES.SUPER_ADMIN) return false;
  return !hasRequiredSubscription(session);
}

// --- Read-only lapse (issue #40) --------------------------------------------

// A lapsed admin keeps READ access to admin routes but loses WRITE access.
// `canMutate` is the single gate every admin mutation handler consults.
//
//   - Not an admin: governed by the route guards instead (granteees/super
//     admins are not subject to the read-only-admin policy), so default true.
//   - Admin with required subscription (or exempt/waived): can mutate.
//   - Lapsed admin (no premium, not exempt): read-only -> cannot mutate.
export function canMutate(session) {
  if (getRole(session) !== ROLES.ADMIN) return true;
  return hasRequiredSubscription(session);
}

// Convenience inverse for components: is this admin in read-only (lapsed) mode?
export function isReadOnlyAdmin(session) {
  return getRole(session) === ROLES.ADMIN && !hasRequiredSubscription(session);
}

// --- Charity Directory entitlements -----------------------------------------
//
// Two SKUs gate the Fiscal Agent / Charity Directory:
//   - basic                   -> seeker may VIEW full listings + contact charities.
//   - premium ("Fiscal Agents Plan") -> charity may OWN/publish a listing + triage
//     inquiries. This reuses the existing org-admin premium plan rather than a
//     separate fiscal_agent SKU.
// super_admin and exempt tenants pass both, mirroring `hasRequiredSubscription`.
// These are UX gates; RLS on the backend is the real security boundary.

// Seeker gate: can this session view the full directory (vs. the teaser)?
// True for the basic SKU OR super_admin OR exempt. (Premium/listing
// owners still see their OWN listing via RLS; browsing the directory is part of
// the basic product.)
export function canViewDirectory(session) {
  if (getRole(session) === ROLES.SUPER_ADMIN) return true;
  const membership = session?.membership;
  if (!membership) return false;
  return (
    !!membership.isExempt ||
    !!membership.hasBasicAccess
  );
}

// Owner gate: can this session own/publish a listing? Folds into the premium
// ("Fiscal Agents Plan") entitlement: true for premium OR super_admin OR exempt.
// Mutation rights on top of this still defer to the read-only-admin lapse policy
// via `canMutate` / `useWriteGuard`.
export function canOwnListing(session) {
  if (getRole(session) === ROLES.SUPER_ADMIN) return true;
  const membership = session?.membership;
  if (!membership) return false;
  return !!membership.isExempt || !!membership.hasPremiumAccess;
}
