import { describe, it, expect } from 'vitest';
import {
  hasRequiredSubscription,
  needsSubscription,
  canMutate,
  isReadOnlyAdmin,
  getRole,
  canViewDirectory,
  canOwnListing,
  ROLES,
} from './policy';

// --- Session factories ------------------------------------------------------

const loggedOut = null;

function superAdmin() {
  return { userRecord: { role: ROLES.SUPER_ADMIN }, membership: null };
}
function grantee({ paid }) {
  return { userRecord: { role: ROLES.GRANTEE }, membership: { hasBasicAccess: paid } };
}
function admin({ paid = false, exempt = false } = {}) {
  return {
    userRecord: { role: ROLES.ADMIN },
    membership: { hasPremiumAccess: paid, isExempt: exempt },
  };
}

describe('policy.hasRequiredSubscription', () => {
  it('super_admin is always satisfied (role-exempt)', () => {
    expect(hasRequiredSubscription(superAdmin())).toBe(true);
  });
  it('grantee requires basic membership', () => {
    expect(hasRequiredSubscription(grantee({ paid: true }))).toBe(true);
    expect(hasRequiredSubscription(grantee({ paid: false }))).toBe(false);
  });
  it('admin requires premium OR exemption/waiver', () => {
    expect(hasRequiredSubscription(admin({ paid: true }))).toBe(true);
    expect(hasRequiredSubscription(admin({ exempt: true }))).toBe(true);
    expect(hasRequiredSubscription(admin({ paid: false, exempt: false }))).toBe(false);
  });
  it('returns false for a session with no role', () => {
    expect(hasRequiredSubscription(loggedOut)).toBe(false);
    expect(hasRequiredSubscription({ userRecord: {} })).toBe(false);
  });
});

describe('policy.needsSubscription (billing nudge candidate)', () => {
  it('is false for logged-out and super_admin', () => {
    expect(needsSubscription(loggedOut)).toBe(false);
    expect(needsSubscription(superAdmin())).toBe(false);
  });
  it('is true only for an authenticated non-super user missing their subscription', () => {
    expect(needsSubscription(grantee({ paid: false }))).toBe(true);
    expect(needsSubscription(grantee({ paid: true }))).toBe(false);
    expect(needsSubscription(admin({ paid: false }))).toBe(true);
    expect(needsSubscription(admin({ paid: true }))).toBe(false);
  });
});

describe('policy.canMutate / isReadOnlyAdmin (read-only lapse #40)', () => {
  it('non-admins can always mutate (their access is gated by route guards)', () => {
    expect(canMutate(grantee({ paid: false }))).toBe(true);
    expect(canMutate(grantee({ paid: true }))).toBe(true);
    expect(canMutate(superAdmin())).toBe(true);
  });
  it('a paid/exempt admin can mutate and is NOT read-only', () => {
    expect(canMutate(admin({ paid: true }))).toBe(true);
    expect(isReadOnlyAdmin(admin({ paid: true }))).toBe(false);
    expect(canMutate(admin({ exempt: true }))).toBe(true);
    expect(isReadOnlyAdmin(admin({ exempt: true }))).toBe(false);
  });
  it('a lapsed admin CANNOT mutate and IS read-only', () => {
    const lapsed = admin({ paid: false, exempt: false });
    expect(canMutate(lapsed)).toBe(false);
    expect(isReadOnlyAdmin(lapsed)).toBe(true);
  });
});

describe('policy.getRole', () => {
  it('reads the role off the session, null when absent', () => {
    expect(getRole(admin())).toBe(ROLES.ADMIN);
    expect(getRole(loggedOut)).toBe(null);
  });
});

// --- Charity Directory entitlements -----------------------------------------
// Mirrors the data-layer gate proven in supabase/tests/charity-directory-rls.test.sh:
// basic (the seeker SKU) OR super_admin OR exempt may VIEW the directory;
// premium ("Fiscal Agents Plan") OR super_admin OR exempt may OWN a listing —
// listing ownership folds into premium rather than a separate fiscal_agent SKU.

// A seeker/charity session with arbitrary entitlement booleans.
function seeker({ basic = false, premium = false, exempt = false } = {}) {
  return {
    userRecord: { role: ROLES.GRANTEE },
    membership: { hasBasicAccess: basic, hasPremiumAccess: premium, isExempt: exempt },
  };
}

describe('policy.canViewDirectory', () => {
  it('super_admin always sees the directory (even with null membership)', () => {
    expect(canViewDirectory(superAdmin())).toBe(true);
  });
  it('basic OR exempt unlocks the directory', () => {
    expect(canViewDirectory(seeker({ basic: true }))).toBe(true);
    expect(canViewDirectory(seeker({ exempt: true }))).toBe(true);
  });
  it('premium ALONE does NOT unlock browsing (that is part of the basic SKU)', () => {
    expect(canViewDirectory(seeker({ premium: true }))).toBe(false);
  });
  it('a plain authed user with no entitlement sees only the teaser', () => {
    expect(canViewDirectory(seeker())).toBe(false);
  });
  it('logged-out / membershipless sessions cannot view', () => {
    expect(canViewDirectory(loggedOut)).toBe(false);
    expect(canViewDirectory({ userRecord: { role: ROLES.GRANTEE }, membership: null })).toBe(false);
  });
});

describe('policy.canOwnListing', () => {
  it('super_admin OR premium OR exempt may own a listing', () => {
    expect(canOwnListing(superAdmin())).toBe(true);
    expect(canOwnListing(seeker({ premium: true }))).toBe(true);
    expect(canOwnListing(seeker({ exempt: true }))).toBe(true);
  });
  it('basic ALONE does NOT confer ownership (strict, non-cross-granting)', () => {
    expect(canOwnListing(seeker({ basic: true }))).toBe(false);
  });
  it('no entitlement / logged-out cannot own', () => {
    expect(canOwnListing(seeker())).toBe(false);
    expect(canOwnListing(loggedOut)).toBe(false);
  });
});
