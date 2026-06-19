import { describe, it, expect } from 'vitest';
import {
  hasRequiredSubscription,
  needsSubscription,
  canMutate,
  isReadOnlyAdmin,
  getRole,
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
