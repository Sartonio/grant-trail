import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));

const startCheckoutSession = vi.fn();
const startBillingPortalSession = vi.fn();
vi.mock('../../lib/billing', () => ({
  MEMBERSHIP_TIERS: { BASIC: 'basic', ORG_ADMIN: 'premium' },
  startCheckoutSession: (...args) => startCheckoutSession(...args),
  startBillingPortalSession: (...args) => startBillingPortalSession(...args),
}));

import SubscriptionPage from './SubscriptionPage';

// Admin whose organization holds the active tenant-owned Fiscal Agents Plan.
const orgPlanAdmin = {
  userRecord: { role: 'admin' },
  membership: {
    isExempt: false,
    hasPremiumAccess: true,
    hasBasicAccess: false,
    tenantMembership: { is_active: true, ends_at: null, membership_tier: 'premium' },
  },
};

// Admin with no org plan and no exemption: the checkout CTA should show.
const needsCheckoutAdmin = {
  userRecord: { role: 'admin' },
  membership: {
    isExempt: false,
    hasPremiumAccess: false,
    hasBasicAccess: false,
    tenantMembership: null,
  },
};

beforeEach(() => {
  startCheckoutSession.mockReset().mockResolvedValue({ url: 'https://checkout' });
  startBillingPortalSession.mockReset().mockResolvedValue({ url: 'https://portal' });
});

describe('SubscriptionPage organization plan', () => {
  it('shows the organization-plan panel for an admin whose org holds the plan', () => {
    render(<SubscriptionPage session={orgPlanAdmin} />);

    expect(screen.getByText(/Your organization holds the Fiscal Agents Plan/i)).toBeInTheDocument();
    expect(screen.getByText(/no one else has to pay/i)).toBeInTheDocument();
    // No checkout CTA when the org already has an active plan.
    expect(screen.queryByRole('button', { name: /Start Fiscal Agents Plan/i })).not.toBeInTheDocument();
  });

  it('opens the billing portal from the org-plan panel (unchanged call signature)', () => {
    render(<SubscriptionPage session={orgPlanAdmin} />);
    fireEvent.click(screen.getByRole('button', { name: /Manage Organization Plan/i }));
    expect(startBillingPortalSession).toHaveBeenCalledWith({ returnPath: '/subscription' });
  });

  it('shows the org-wide checkout CTA for an admin with no active plan', () => {
    render(<SubscriptionPage session={needsCheckoutAdmin} />);

    const cta = screen.getByRole('button', { name: /Start Fiscal Agents Plan for your organization/i });
    expect(cta).toBeInTheDocument();
    expect(screen.queryByText(/Your organization holds the Fiscal Agents Plan/i)).not.toBeInTheDocument();

    fireEvent.click(cta);
    expect(startCheckoutSession).toHaveBeenCalledWith({ membershipTier: 'premium', returnPath: '/subscription' });
  });

  it('treats an expired org membership as needing checkout', () => {
    const expired = {
      userRecord: { role: 'admin' },
      membership: {
        isExempt: false,
        hasPremiumAccess: false,
        tenantMembership: { is_active: true, ends_at: '2000-01-01T00:00:00Z' },
      },
    };
    render(<SubscriptionPage session={expired} />);
    expect(screen.queryByText(/Your organization holds the Fiscal Agents Plan/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Fiscal Agents Plan for your organization/i })).toBeInTheDocument();
  });
});
