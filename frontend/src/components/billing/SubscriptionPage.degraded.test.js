import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// Mock the billing lib so we control whether the Edge Function call fails/hangs.
const startCheckoutSession = vi.fn();
const startBillingPortalSession = vi.fn();
vi.mock('../../lib/billing', () => ({
  MEMBERSHIP_TIERS: { BASIC: 'basic', ORG_ADMIN: 'premium' },
  isOrgAdminSubscriptionRequired: () => false,
  startCheckoutSession: (...args) => startCheckoutSession(...args),
  startBillingPortalSession: (...args) => startBillingPortalSession(...args),
}));

import SubscriptionPage from './SubscriptionPage';

const BANNER = /Billing is temporarily unavailable — please try again later/i;

// Grantee without access: the resume-pay ("Complete Basic payment") button shows.
const granteeSession = {
  userRecord: { role: 'grantee' },
  membership: { hasBasicAccess: false, isExempt: false },
};

function expectPageStillFunctional() {
  // Core subscription UI is still rendered and interactive (not a crash/blank).
  expect(screen.getByRole('button', { name: /Complete Basic payment/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Refresh Access Status/i })).toBeEnabled();
}

describe('SubscriptionPage degraded billing UI', () => {
  beforeEach(() => {
    captureException.mockClear();
    startCheckoutSession.mockReset();
    startBillingPortalSession.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the degraded banner and reports to Sentry when checkout fails', async () => {
    const err = new Error('Failed to fetch');
    startCheckoutSession.mockRejectedValue(err);

    render(<SubscriptionPage session={granteeSession} />);
    fireEvent.click(screen.getByRole('button', { name: /Complete Basic payment/i }));

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(err);
    expectPageStillFunctional();
  });

  it('shows the degraded banner when the billing call times out', async () => {
    vi.useFakeTimers();
    // Never resolves — simulates Stripe being unreachable / hanging.
    startCheckoutSession.mockReturnValue(new Promise(() => {}));

    render(<SubscriptionPage session={granteeSession} />);
    fireEvent.click(screen.getByRole('button', { name: /Complete Basic payment/i }));

    // Advance past the request timeout to trip the degraded path.
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });

    expect(screen.getByText(BANNER)).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledTimes(1);
    expectPageStillFunctional();
  });

  it('does not show the degraded banner before any failure', () => {
    render(<SubscriptionPage session={granteeSession} />);
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expectPageStillFunctional();
  });
});
