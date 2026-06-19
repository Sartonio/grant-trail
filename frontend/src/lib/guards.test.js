import { describe, it, expect } from 'vitest';
import { resolveGuard, GRANTEE_BILLING_REDIRECT } from './guards';
import { ROLES } from './policy';

// ---------------------------------------------------------------------------
// Redirect matrix: role x route x billing-state -> expected destination.
//
// This proves the route-guard refactor (#41) preserves the original behavior,
// and documents the ONE intentional change from the read-only-lapse policy
// (#40): a lapsed admin used to be redirected away from admin routes to /home;
// now the admin route RENDERS (read-only) instead of redirecting.
//
// `dest === null` means "the route renders" (no redirect). For admin routes a
// rendered route additionally carries readOnly=true when the admin is lapsed.
// ---------------------------------------------------------------------------

// Session factories ----------------------------------------------------------
const sessions = {
  loggedOut: null,
  superAdmin: { userRecord: { role: ROLES.SUPER_ADMIN }, membership: null },
  granteePaid: { userRecord: { role: ROLES.GRANTEE }, membership: { hasBasicAccess: true } },
  granteeUnpaid: { userRecord: { role: ROLES.GRANTEE }, membership: { hasBasicAccess: false } },
  adminPaid: { userRecord: { role: ROLES.ADMIN }, membership: { hasPremiumAccess: true } },
  adminExempt: { userRecord: { role: ROLES.ADMIN }, membership: { isExempt: true } },
  adminLapsed: { userRecord: { role: ROLES.ADMIN }, membership: { hasPremiumAccess: false, isExempt: false } },
};

// Route guard configs — mirror exactly how App.js declares each <Guard>.
const granteeGuard = { requireRole: 'authenticated', roleRedirect: '/login', billingMode: 'redirect' };
const subscriptionGuard = { requireRole: 'authenticated', roleRedirect: '/login', billingMode: 'none' };
const adminGuard = { requireRole: ROLES.ADMIN, roleRedirect: '/', billingMode: 'readOnly' };
const superGuard = { requireRole: ROLES.SUPER_ADMIN, roleRedirect: '/', billingMode: 'none' };

const NUDGE = GRANTEE_BILLING_REDIRECT; // '/home'

function destOf(sessionKey, guard) {
  const { redirect } = resolveGuard(sessions[sessionKey], guard);
  return redirect; // null === renders
}

describe('Redirect matrix — grantee routes (/grants, /expenses, ...)', () => {
  // BEFORE: session ? (granteeUnpaid ? /home : render) : /login
  const cases = [
    ['loggedOut', '/login'],
    ['granteePaid', null],
    ['granteeUnpaid', NUDGE],
    ['adminPaid', null],      // admin meets billing on grantee routes (premium)
    ['adminExempt', null],
    ['adminLapsed', NUDGE],   // lapsed admin lacks required sub -> nudged
    ['superAdmin', null],     // super_admin never billing-restricted
  ];
  it.each(cases)('%s -> %s', (sessionKey, expected) => {
    expect(destOf(sessionKey, granteeGuard)).toBe(expected);
  });
});

describe('Redirect matrix — /subscription (auth only, no billing gate)', () => {
  // BEFORE: session ? render : /login
  const cases = [
    ['loggedOut', '/login'],
    ['granteePaid', null],
    ['granteeUnpaid', null],
    ['adminLapsed', null],
    ['superAdmin', null],
  ];
  it.each(cases)('%s -> %s', (sessionKey, expected) => {
    expect(destOf(sessionKey, subscriptionGuard)).toBe(expected);
  });
});

describe('Redirect matrix — admin routes (/admin, /admin/users, ...)', () => {
  // BEFORE: role==='admin' ? (adminUnpaid ? /home : render) : /
  // AFTER  (#40): lapsed admin RENDERS read-only instead of redirecting to /home.
  const cases = [
    ['loggedOut', '/'],
    ['granteePaid', '/'],
    ['granteeUnpaid', '/'],
    ['superAdmin', '/'],
    ['adminPaid', null],
    ['adminExempt', null],
    ['adminLapsed', null], // CHANGED from '/home' -> renders read-only
  ];
  it.each(cases)('%s -> %s', (sessionKey, expected) => {
    expect(destOf(sessionKey, adminGuard)).toBe(expected);
  });

  it('only the lapsed admin renders admin routes in read-only mode', () => {
    expect(resolveGuard(sessions.adminLapsed, adminGuard).readOnly).toBe(true);
    expect(resolveGuard(sessions.adminPaid, adminGuard).readOnly).toBe(false);
    expect(resolveGuard(sessions.adminExempt, adminGuard).readOnly).toBe(false);
  });
});

describe('Redirect matrix — super-admin route (/super/tenants)', () => {
  // BEFORE: role==='super_admin' ? render : /
  const cases = [
    ['loggedOut', '/'],
    ['granteePaid', '/'],
    ['adminPaid', '/'],
    ['adminLapsed', '/'],
    ['superAdmin', null],
  ];
  it.each(cases)('%s -> %s', (sessionKey, expected) => {
    expect(destOf(sessionKey, superGuard)).toBe(expected);
  });
});

describe('Guard axis separation — role vs billing are distinct redirects', () => {
  it('wrong role on an admin route -> role redirect (/), never the billing nudge', () => {
    expect(destOf('granteeUnpaid', adminGuard)).toBe('/');
  });
  it('right role but unpaid on a grantee route -> billing nudge, never /login', () => {
    expect(destOf('granteeUnpaid', granteeGuard)).toBe(NUDGE);
  });
});
