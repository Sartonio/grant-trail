// src/lib/guards.js
//
// Declarative route guards (issue #41). Two orthogonal axes — see lib/policy.js:
//   1. RequireRole         — role-based authorization (wrong role -> /login or /)
//   2. RequireSubscription — billing gating (unpaid -> billing nudge)
//
// <Guard> composes both axes so a route declares its role requirement and its
// billing requirement separately instead of collapsing them into one tangled
// ternary. The two redirects stay semantically distinct.
//
// Billing-lapse policy (#40 = read-only degrade): admin routes use
// billingMode="readOnly" so a lapsed admin keeps READ access (the route still
// renders) but loses WRITE access. The guard injects `readOnly` into the
// rendered element so components can disable mutations; mutation handlers
// themselves route blocked writes to the billing nudge via useWriteGuard.

import React from 'react';
import { Navigate } from 'react-router-dom';
import {
  ROLES,
  BILLING_NUDGE_PATH,
  getRole,
  isAuthenticated,
  needsSubscription,
  isReadOnlyAdmin,
} from './policy';

// Where an unpaid grantee is sent today. Historically App.js redirected unpaid
// grantees to "/home" (the LandingPage upgrade page, which links to
// /subscription). We preserve that target to keep Step-1 behavior identical;
// the semantically-distinct billing nudge (/subscription) is enforced on
// blocked *mutations* (Step 2) via useWriteGuard.
export const GRANTEE_BILLING_REDIRECT = '/home';

// Resolve the redirect (if any) for a guarded route. Returns a path string to
// redirect to, or null when the route should render. Pure function so the
// redirect matrix can be snapshot-tested without a router.
//
// requireRole:
//   - a role string  -> exactly this role is required
//   - 'authenticated'-> any logged-in user
// roleRedirect: where to send a user who fails the role check.
// billingMode:
//   - 'none'     -> billing not gated on this route
//   - 'redirect' -> unpaid user redirected (grantee routes)
//   - 'readOnly' -> route renders; lapsed admin gets read-only (no redirect)
export function resolveGuard(session, { requireRole, roleRedirect, billingMode = 'none', billingRedirect = GRANTEE_BILLING_REDIRECT }) {
  // --- Role axis ---
  if (requireRole === 'authenticated') {
    if (!isAuthenticated(session)) return { redirect: roleRedirect };
  } else if (requireRole) {
    if (getRole(session) !== requireRole) return { redirect: roleRedirect };
  }

  // --- Billing axis ---
  if (billingMode === 'redirect' && needsSubscription(session)) {
    return { redirect: billingRedirect };
  }

  // readOnly mode never redirects on billing; the route renders read-only.
  const readOnly = billingMode === 'readOnly' && isReadOnlyAdmin(session);
  return { redirect: null, readOnly };
}

// Guard component. Renders `children` when access is allowed, otherwise a
// <Navigate>. In readOnly mode it injects `readOnly` and `session` into a
// single child element so the page can degrade gracefully.
export function Guard({ session, requireRole, roleRedirect, billingMode, billingRedirect, children }) {
  const { redirect, readOnly } = resolveGuard(session, {
    requireRole,
    roleRedirect,
    billingMode,
    billingRedirect,
  });

  if (redirect) return <Navigate to={redirect} />;

  if (readOnly && React.isValidElement(children)) {
    return React.cloneElement(children, { readOnly: true });
  }
  return children;
}

// Thin role-only wrapper (authz axis). Wrong role / not authenticated -> redirect.
export function RequireRole({ session, role, redirectTo, children }) {
  return (
    <Guard session={session} requireRole={role ?? 'authenticated'} roleRedirect={redirectTo} billingMode="none">
      {children}
    </Guard>
  );
}

// Thin subscription-only wrapper (billing axis). Assumes role already checked.
// Unpaid -> billing redirect.
export function RequireSubscription({ session, redirectTo = GRANTEE_BILLING_REDIRECT, children }) {
  if (needsSubscription(session)) return <Navigate to={redirectTo} />;
  return children;
}

export { ROLES, BILLING_NUDGE_PATH };
