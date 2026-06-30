import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaCheckCircle, FaTimesCircle, FaArrowRight } from 'react-icons/fa';
import * as Sentry from '@sentry/react';
import { syncMembershipFromStripe } from '../../lib/billing';
import './FiscalAgentDirectory.css';

/*
  Checkout return — success / cancel.
  -----------------------------------
  Both the Directory Access (seeker) and Fiscal Agent (charity) checkouts return
  here, and both are now account-FIRST: the caller is authenticated, so on success
  we sync the membership from Stripe to flip the entitlement promptly, then point
  to the next step:
    - Fiscal Agent onboarding (flow=onboarding): the charity's draft listing
      already exists — send them to the listing editor to finish it.
    - Directory Access (seeker): the directory unlocks — continue browsing.
*/

function readStatus() {
  const params = new URLSearchParams(window.location.search);
  return {
    status: params.get('status') || params.get('checkout') || 'success',
    flow: params.get('flow') || '',
  };
}

export default function FiscalAgentCheckoutReturn() {
  const [{ status, flow }] = useState(readStatus);
  const [syncing, setSyncing] = useState(status === 'success');

  const isCancel = status === 'cancel' || status === 'cancelled';
  const isFiscalAgent = flow === 'onboarding';

  useEffect(() => {
    if (isCancel) return undefined;

    let cancelled = false;
    syncMembershipFromStripe()
      .catch((err) => Sentry.captureException(err))
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isCancel]);

  if (isCancel) {
    return (
      <div className="fad-page">
        <div className="fad-paywall-card fad-checkout-return">
          <span className="fad-paywall-icon">
            <FaTimesCircle />
          </span>
          <h2>Checkout canceled</h2>
          <p>No charge was made. You can pick up your subscription whenever you’re ready.</p>
          <Link
            to={isFiscalAgent ? '/fiscal-agents/me' : '/fiscal-agents'}
            className="fad-btn fad-btn-primary fad-btn-block"
          >
            {isFiscalAgent ? 'Go to your dashboard' : 'Back to the directory'} <FaArrowRight />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fad-page">
      <div className="fad-paywall-card fad-checkout-return">
        <span className="fad-paywall-icon">
          <FaCheckCircle />
        </span>
        {isFiscalAgent ? (
          <>
            <h2>You’re subscribed</h2>
            <p>
              {syncing
                ? 'Activating your Fiscal Agent subscription…'
                : 'Your subscription is active. Finish your listing and we’ll verify your 501(c)(3) status before it goes live.'}
            </p>
            <Link to="/fiscal-agents/listing/edit" className="fad-btn fad-btn-primary fad-btn-block">
              Finish your listing <FaArrowRight />
            </Link>
          </>
        ) : (
          <>
            <h2>You’re subscribed</h2>
            <p>
              {syncing
                ? 'Activating your Directory Access…'
                : 'Your Directory Access is active. The full directory is unlocked.'}
            </p>
            <Link to="/fiscal-agents" className="fad-btn fad-btn-primary fad-btn-block">
              Browse the directory <FaArrowRight />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
