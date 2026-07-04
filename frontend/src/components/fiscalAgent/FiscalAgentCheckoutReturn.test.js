import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }) => <a href={to}>{children}</a>,
}));

import FiscalAgentCheckoutReturn from './FiscalAgentCheckoutReturn';

function renderWith(search) {
  window.history.pushState({}, '', `/fiscal-agents/checkout/return${search}`);
  const onSynced = vi.fn(() => Promise.resolve());
  render(<FiscalAgentCheckoutReturn onSynced={onSynced} />);
  return onSynced;
}

describe('FiscalAgentCheckoutReturn — cancel vs success (Stripe spells it "canceled")', () => {
  it('shows the cancel UI on ?checkout=canceled and never syncs', () => {
    const onSynced = renderWith('?checkout=canceled&flow=onboarding');

    expect(screen.getByText(/Checkout canceled/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Continue to payment/i })).toHaveAttribute(
      'href',
      '/subscription',
    );
    expect(onSynced).not.toHaveBeenCalled();
  });

  it('shows the subscribed view and syncs on ?checkout=success', () => {
    const onSynced = renderWith('?checkout=success&flow=onboarding');

    expect(screen.getByText(/You’re subscribed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Finish your listing/i })).toHaveAttribute(
      'href',
      '/fiscal-agents/listing/edit',
    );
    expect(onSynced).toHaveBeenCalled();
  });
});
