import React, { useEffect, useMemo, useState } from 'react';
import * as Sentry from '@sentry/react';
import { FaShieldAlt, FaSyncAlt, FaExclamationTriangle, FaArrowRight, FaUsers } from 'react-icons/fa';
import {
  MEMBERSHIP_TIERS,
  startBillingPortalSession,
  startCheckoutSession,
} from '../../lib/billing';
import { getRole, ROLES } from '../../lib/policy';
import './SubscriptionPage.css';

// The premium ("Fiscal Agents Plan") tier is tenant-owned: one subscription
// covers the whole organization. An org holds the plan when its
// tenant_memberships row is active and not past its end date.
function hasActiveOrgPlan(tenantMembership) {
  if (!tenantMembership || !tenantMembership.is_active) return false;
  if (!tenantMembership.ends_at) return true;
  return new Date(tenantMembership.ends_at).getTime() > Date.now();
}

// Billing Edge Function calls go through Stripe; if Stripe is unreachable the
// request can hang, so cap how long we wait before treating it as unavailable.
const BILLING_REQUEST_TIMEOUT_MS = 15000;

// After a successful checkout, re-poll membership on a short then longer delay to
// let the Stripe webhook land before we tell the user their access is still locked.
const SYNC_RETRY_ONE_MS = 2500;
const SYNC_RETRY_TWO_MS = 7000;

function withTimeout(promise, ms) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Billing request timed out.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

// Manage-only subscription page. The PLAN CHOICE happens once at signup (the /join
// fork → grantee/Basic or fiscal-agent/Premium), so this page is no longer a plan
// chooser. It surfaces current access, a single resume-pay button for the plan the
// user's role already requires (covers abandoned-signup and lapsed subs), and the
// Stripe billing portal for managing an active subscription.
function SubscriptionPage({ session, onMembershipUpdated }) {
  const membership = session?.membership;
  const role = getRole(session);
  const isAdmin = role === ROLES.ADMIN;
  // Premium is tenant-owned: an admin whose org holds the active plan sees the
  // "organization plan" panel and manages the shared subscription; other admins
  // and grantees don't pay for it.
  const orgPlanActive = isAdmin && hasActiveOrgPlan(membership?.tenantMembership);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');

  const isWaived = membership?.membership?.source === 'manual';
  const hasAccess = isAdmin
    ? membership?.hasPremiumAccess || membership?.isExempt || isWaived
    : membership?.hasBasicAccess || membership?.isExempt || isWaived;

  // Resume-pay is for self-finishing the plan the role already requires — only when
  // the user is genuinely unpaid (never-paid OR lapsed) and not exempt/waived.
  const needsPayment = !hasAccess && !isWaived && !membership?.isExempt;
  const resumeTier = isAdmin ? MEMBERSHIP_TIERS.ORG_ADMIN : MEMBERSHIP_TIERS.BASIC;

  const hasBasicOnlyAdminAccess = isAdmin
    && !membership?.isExempt
    && !isWaived
    && membership?.hasBasicAccess
    && !membership?.hasPremiumAccess;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');

    if (checkoutStatus !== 'success') return;

    setSyncNotice('Purchase received. We are syncing your access...');
    onMembershipUpdated?.();

    const retryOne = window.setTimeout(() => onMembershipUpdated?.(), SYNC_RETRY_ONE_MS);
    const retryTwo = window.setTimeout(() => {
      onMembershipUpdated?.();
      setSyncNotice('If your access still looks locked, click Refresh Access Status below.');
    }, SYNC_RETRY_TWO_MS);

    const cleanPath = window.location.pathname;
    window.history.replaceState({}, '', cleanPath);

    return () => {
      window.clearTimeout(retryOne);
      window.clearTimeout(retryTwo);
    };
  }, [onMembershipUpdated]);

  const currentTierLabel = useMemo(() => {
    if (membership?.isExempt) {
      if (role === 'super_admin') return 'Exempt (Super Admin)';
      if (role === 'admin') return 'Exempt (TFAC or subscription-exempt fiscal agent)';
      return 'Full Access (subscription not required for your account)';
    }
    if (isWaived) {
      return role === 'admin'
        ? 'Fiscal Agents Plan (waived by your organization)'
        : 'Basic (waived by your administrator)';
    }
    if (role === 'admin' && membership?.hasPremiumAccess) return 'Fiscal Agents Plan (Paid)';
    if (membership?.hasBasicAccess) return 'Basic (Paid)';
    return 'No active subscription';
  }, [membership, isWaived, role]);

  const headline = isAdmin ? 'Manage Fiscal Agents Subscription' : 'Manage Basic Subscription';

  const description = isAdmin
    ? 'The Fiscal Agents Plan is an organization subscription — one plan covers your whole org. Review your access, start or renew the plan if needed, or open the billing portal to manage it.'
    : 'Review your current basic access, finish or renew payment if needed, or open the billing portal to manage an existing subscription.';

  const requiredMessage = isAdmin
    ? 'Your organization needs an active Fiscal Agents Plan before your admins can use the admin dashboard. One subscription covers the whole organization.'
    : 'Your account needs an active Basic plan before using grants and expenses.';

  const resumeLabel = isAdmin ? 'Start Fiscal Agents Plan for your organization' : 'Complete Basic payment';

  const handleResumePayment = async () => {
    setBillingUnavailable(false);
    setCheckoutLoading(true);
    try {
      const { url } = await withTimeout(
        startCheckoutSession({ membershipTier: resumeTier, returnPath: '/subscription' }),
        BILLING_REQUEST_TIMEOUT_MS,
      );
      window.location.assign(url);
    } catch (error) {
      // Stripe is unreachable / slow — degrade gracefully instead of surfacing a
      // raw error, and report the real cause to Sentry for diagnosis.
      Sentry.captureException(error);
      setBillingUnavailable(true);
      setCheckoutLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setBillingUnavailable(false);
    setPortalLoading(true);
    try {
      const { url } = await withTimeout(
        startBillingPortalSession({ returnPath: '/subscription' }),
        BILLING_REQUEST_TIMEOUT_MS,
      );
      window.location.assign(url);
    } catch (error) {
      Sentry.captureException(error);
      setBillingUnavailable(true);
      setPortalLoading(false);
    }
  };

  return (
    <section className="subscription-page">
      <div className="subscription-hero">
        <div className="subscription-hero-topline">Manage Subscription</div>
        <h2>{headline}</h2>
        <p>{description}</p>

        <div className="subscription-status-chip">
          <FaShieldAlt />
          <span>Current access: {currentTierLabel}</span>
        </div>

        {!hasAccess && (
          <div className="subscription-required-alert">
            <strong>Subscription needed:</strong> {requiredMessage}
          </div>
        )}

        {syncNotice && !hasAccess && (
          <div className="subscription-required-alert">
            <strong>Syncing:</strong> {syncNotice}
          </div>
        )}

        {hasBasicOnlyAdminAccess && (
          <div className="subscription-required-alert">
            <strong>Plan mismatch:</strong> Your Basic plan is active, but admin features require the Fiscal Agents plan.
          </div>
        )}

        {membership?.activeSubscription?.status === 'past_due' && (
          <div className="subscription-required-alert subscription-past-due-alert">
            <FaExclamationTriangle />
            {' '}<strong>Payment failed —</strong> please update your payment method to keep your access.
          </div>
        )}

        {billingUnavailable && (
          <div className="subscription-billing-unavailable" role="alert">
            <FaExclamationTriangle />
            <span>Billing is temporarily unavailable — please try again later.</span>
          </div>
        )}
      </div>

      {orgPlanActive && (
        <div className="subscription-org-plan">
          <div className="subscription-org-plan-icon">
            <FaUsers />
          </div>
          <div className="subscription-org-plan-body">
            <div className="subscription-hero-topline">Organization plan</div>
            <h3>Your organization holds the Fiscal Agents Plan</h3>
            <p>
              One subscription covers your whole organization — every admin gets
              access and no one else has to pay. Any admin can update the payment
              method, download invoices, or manage the plan from the billing portal.
            </p>
            <button
              className="subscription-manage-btn"
              onClick={handleManageBilling}
              disabled={portalLoading}
            >
              <FaSyncAlt /> {portalLoading ? 'Opening Billing...' : 'Manage Organization Plan'}
            </button>
          </div>
        </div>
      )}

      <div className="subscription-actions-row">
        {needsPayment && (
          <button className="subscription-plan-btn" onClick={handleResumePayment} disabled={checkoutLoading}>
            {checkoutLoading ? 'Opening Checkout...' : <>{resumeLabel} <FaArrowRight /></>}
          </button>
        )}

        {!isWaived && !membership?.isExempt && hasAccess && !orgPlanActive && (
          <button className="subscription-manage-btn" onClick={handleManageBilling} disabled={portalLoading}>
            <FaSyncAlt /> {portalLoading ? 'Opening Billing...' : 'Manage Subscription'}
          </button>
        )}

        <button className="subscription-refresh-btn" onClick={onMembershipUpdated}>
          <FaSyncAlt /> Refresh Access Status
        </button>
      </div>
    </section>
  );
}

export default SubscriptionPage;
