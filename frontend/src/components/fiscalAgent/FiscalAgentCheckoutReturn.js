import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaCheckCircle, FaEnvelopeOpenText, FaTimesCircle, FaArrowRight } from 'react-icons/fa';
import * as Sentry from '@sentry/react';
import { syncMembershipFromStripe } from '../../lib/billing';
import { INTAKE_STORAGE_KEY } from './FiscalAgentListIntake';
import './FiscalAgentDirectory.css';

/*
  Checkout return — S7 (success) / S8 (cancel), UX §5.
  ----------------------------------------------------
  Both the Directory Access (seeker) and Fiscal Agent (charity) checkouts return
  here. On success we sync the membership from Stripe so the entitlement flips
  promptly, then surface the next step:
    - Fiscal Agent (pay-first charity): "Check your email for your signup link."
      The listing exists as draft/unverified; the invite token is the signup
      link. Intake draft is cleared on success.
    - Directory Access (seeker): the directory unlocks — continue browsing.
  On cancel we keep the intake draft so the charity can resume the intake (S8).
*/

function readStatus() {
  const params = new URLSearchParams(window.location.search);
  return {
    status: params.get('status') || params.get('checkout') || 'success',
    // The charity pay-first onboarding return carries flow=onboarding; the seeker
    // Directory Access return does not. (Charity onboarding charges the premium
    // "Fiscal Agents Plan" — there is no separate fiscal_agent tier.)
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
    // Best-effort: flip the seeker's Directory Access entitlement promptly. For
    // the pay-first charity flow there's no session yet, so this is a no-op that
    // simply resolves — the real provisioning is the webhook + signup email.
    syncMembershipFromStripe()
      .catch((err) => Sentry.captureException(err))
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });

    // Success means the funnel completed — clear the preserved intake draft.
    try {
      sessionStorage.removeItem(INTAKE_STORAGE_KEY);
    } catch (_error) {
      // ignore
    }

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
          <p>No charge was made. Your details are saved — pick up where you left off.</p>
          <Link to="/fiscal-agents/list" className="fad-btn fad-btn-primary fad-btn-block">
            Resume <FaArrowRight />
          </Link>
          <p className="fad-paywall-fine">
            <Link to="/fiscal-agents">Back to the directory</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fad-page">
      <div className="fad-paywall-card fad-checkout-return">
        <span className="fad-paywall-icon">
          {isFiscalAgent ? <FaEnvelopeOpenText /> : <FaCheckCircle />}
        </span>
        {isFiscalAgent ? (
          <>
            <h2>Payment received</h2>
            <p>
              Check your email for your signup link to finish setting up your listing. Your listing
              is being created now and will appear in the directory once you complete it and we
              verify your 501(c)(3) status.
            </p>
            <p className="fad-paywall-fine">
              Didn’t get the email? Check spam, or contact support to resend your signup link.
            </p>
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
