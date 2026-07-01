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

/** @typedef {import('./types').Session} Session */
/** @typedef {import('./types').Role} Role */

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

// Where an unpaid grantee is sent: the same billing nudge as everyone else.
// Aliased to policy's BILLING_NUDGE_PATH so the path lives in one place.
export const GRANTEE_BILLING_REDIRECT = BILLING_NUDGE_PATH;

// Resolve the redirect (if any) for a guarded route. Returns a path string to
// redirect to, or null when the route should render. Pure function so the
// redirect matrix can be snapshot-tested without a router.
//
// requireRole:
//   - a role string  -> exactly this role is required
//   - 'authenticated'-> any logged-in user
// roleRedirect: where to send a user who fails the role check. Either a path
//   string, or a function (session) => path so a route can send different
//   roles to their own home (e.g. admin -> /admin, super_admin -> /super/tenants).
// billingMode:
//   - 'none'     -> billing not gated on this route
//   - 'redirect' -> unpaid user redirected (grantee routes)
//   - 'readOnly' -> route renders; lapsed admin gets read-only (no redirect)
/**
 * @param {Session} session
 * @param {Object} options
 * @param {Role|'authenticated'} [options.requireRole]
 * @param {string|((session: Session) => string)} [options.roleRedirect]
 * @param {'none'|'redirect'|'readOnly'} [options.billingMode]
 * @param {string} [options.billingRedirect]
 * @returns {{ redirect: string|null, readOnly?: boolean }}
 */
export function resolveGuard(session, { requireRole, roleRedirect, billingMode = 'none', billingRedirect = GRANTEE_BILLING_REDIRECT }) {
  const resolveRoleRedirect = () =>
    typeof roleRedirect === 'function' ? roleRedirect(session) : roleRedirect;

  // --- Role axis ---
  if (requireRole === 'authenticated') {
    if (!isAuthenticated(session)) return { redirect: resolveRoleRedirect() };
  } else if (requireRole) {
    if (getRole(session) !== requireRole) return { redirect: resolveRoleRedirect() };
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
/**
 * @param {Object} props
 * @param {Session} [props.session]
 * @param {Role|'authenticated'} [props.requireRole]
 * @param {string|((session: Session) => string)} [props.roleRedirect]
 * @param {'none'|'redirect'|'readOnly'} [props.billingMode]
 * @param {string} [props.billingRedirect]
 * @param {React.ReactNode} props.children
 */
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
