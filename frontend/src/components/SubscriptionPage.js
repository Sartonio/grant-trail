import React, { useEffect, useMemo, useState } from 'react';
import { FaCheckCircle, FaBuilding, FaShieldAlt, FaSyncAlt } from 'react-icons/fa';
import {
  MEMBERSHIP_TIERS,
  isOrgAdminSubscriptionRequired,
  startBillingPortalSession,
  startCheckoutSession,
} from '../lib/billing';
import './SubscriptionPage.css';

function PlanCard({
  title,
  subtitle,
  icon,
  features,
  ctaLabel,
  onClick,
  disabled,
  featured,
  current,
  loading,
}) {
  return (
    <article className={`subscription-plan-card${featured ? ' featured' : ''}${current ? ' current' : ''}`}>
      <div className="subscription-plan-header">
        <div className="subscription-plan-icon">{icon}</div>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>

      <ul className="subscription-plan-features">
        {features.map((feature) => (
          <li key={feature}>
            <FaCheckCircle />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button className="subscription-plan-btn" onClick={onClick} disabled={disabled || loading}>
        {loading ? 'Opening Checkout...' : current ? 'Current Plan' : ctaLabel}
      </button>
    </article>
  );
}

function SubscriptionPage({ session, onMembershipUpdated }) {
  const membership = session?.membership;
  const role = session?.userRecord?.role;
  const needsAdminSubscription = isOrgAdminSubscriptionRequired(session);
  const isAdmin = role === 'admin';
  const [checkoutTier, setCheckoutTier] = useState(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [syncNotice, setSyncNotice] = useState('');

  const isWaived = membership?.membership?.source === 'manual';
  const hasAccess = role === 'admin'
    ? membership?.hasPremiumAccess || membership?.isExempt || isWaived
    : membership?.hasBasicAccess || membership?.isExempt || isWaived;
  const hasBasicOnlyAdminAccess = role === 'admin'
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

    const retryOne = window.setTimeout(() => onMembershipUpdated?.(), 2500);
    const retryTwo = window.setTimeout(() => {
      onMembershipUpdated?.();
      setSyncNotice('If your access still looks locked, click Refresh Access Status below.');
    }, 7000);

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

  const headline = role === 'admin'
    ? 'Manage Fiscal Agents Subscription'
    : 'Manage Basic Subscription';

  const description = role === 'admin'
    ? 'Review your current fiscal agent access, start checkout if you still need a plan, or open the billing portal to manage an existing subscription.'
    : 'Review your current basic access, start checkout if you still need a plan, or open the billing portal to manage an existing subscription.';

  const requiredMessage = role === 'admin'
    ? 'Your admin account needs an active Fiscal Agents plan before you can use the admin dashboard.'
    : 'Your account needs an active Basic plan before using grants and expenses.';

  const basicButtonLabel = !isAdmin ? 'Get Started' : 'Best for grantee accounts';
  const fiscalButtonLabel = isAdmin ? 'Start Managing Smarter' : 'For fiscal agent admins';

  const handleCheckout = async (tier) => {
    setErrorMessage('');
    setCheckoutTier(tier);
    try {
      const { url } = await startCheckoutSession({
        membershipTier: tier,
        returnPath: '/subscription',
      });
      window.location.assign(url);
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to start checkout. Please try again.');
      setCheckoutTier(null);
    }
  };

  const handleManageBilling = async () => {
    setErrorMessage('');
    setPortalLoading(true);
    try {
      const { url } = await startBillingPortalSession({ returnPath: '/subscription' });
      window.location.assign(url);
    } catch (error) {
      setErrorMessage(error?.message || 'Unable to open billing portal. Please try again.');
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

        {syncNotice && (
          <div className="subscription-required-alert">
            <strong>Syncing:</strong> {syncNotice}
          </div>
        )}

        {hasBasicOnlyAdminAccess && (
          <div className="subscription-required-alert">
            <strong>Plan mismatch:</strong> Your Basic plan is active, but admin features require the Fiscal Agents plan.
          </div>
        )}

        {errorMessage && <div className="subscription-error">{errorMessage}</div>}
      </div>

      <div className="subscription-plans-grid">
        <PlanCard
          title="Basic Plan"
          subtitle="Perfect for small organizations getting started"
          icon={<FaShieldAlt />}
          features={[
            'Expense tracking dashboard',
            'Receipt uploading and secure storage',
            'Simple reporting tools',
            'Secure data storage',
            'User-friendly interface',
            'Excel export included in the basic workflow',
            'Affordable monthly subscription',
          ]}
          ctaLabel={basicButtonLabel}
          onClick={!isAdmin ? () => handleCheckout(MEMBERSHIP_TIERS.BASIC) : undefined}
          disabled={isAdmin || hasAccess}
          current={!isAdmin && !isWaived && membership?.hasBasicAccess}
          loading={checkoutTier === MEMBERSHIP_TIERS.BASIC}
        />

        <PlanCard
          title="Fiscal Agents (Charities) Plan"
          subtitle="Designed for charities managing multiple organizations and projects"
          icon={<FaBuilding />}
          featured
          features={[
            'Manage multiple organizations in one platform',
            'Advanced reporting and financial insights',
            'Real-time tracking across projects',
            'Enhanced transparency for funders',
            'Scalable system for growth',
            'Required for non-TFAC admin accounts',
          ]}
          ctaLabel={fiscalButtonLabel}
          onClick={isAdmin ? () => handleCheckout(MEMBERSHIP_TIERS.ORG_ADMIN) : undefined}
          disabled={!isAdmin || hasAccess || !needsAdminSubscription}
          current={isAdmin && !isWaived && membership?.hasPremiumAccess}
          loading={checkoutTier === MEMBERSHIP_TIERS.ORG_ADMIN}
        />
      </div>

      <div className="subscription-actions-row">
        {!isWaived && !membership?.isExempt && (
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
