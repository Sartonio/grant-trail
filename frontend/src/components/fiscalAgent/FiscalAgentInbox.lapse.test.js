import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Link is the only react-router-dom dependency the inbox uses.
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }) => <a href={to}>{children}</a>,
}));

import FiscalAgentInbox from './FiscalAgentInbox';

const inquiry = {
  id: '1',
  status: 'new',
  submittedAt: new Date().toISOString(),
  project: {
    name: 'Clean Rivers',
    mission: 'Restore local waterways',
    focus: 'Environment',
    projectType: 'Program',
    estAnnualBudget: '$50k',
    timeline: '12 months',
  },
  contact: { name: 'Dana Lee', email: 'dana@example.com', organization: 'Rivers Co' },
  message: 'Looking for a fiscal sponsor.',
};

describe('FiscalAgentInbox — read-only when subscription lapsed (TASK A5)', () => {
  const onUpdateStatus = vi.fn();
  const onOnboard = vi.fn();
  beforeEach(() => { onUpdateStatus.mockClear(); onOnboard.mockClear(); });

  it('shows a Resubscribe-to-edit notice and disables triage actions when read-only', () => {
    render(
      <FiscalAgentInbox
        inquiries={[inquiry]}
        onUpdateStatus={onUpdateStatus}
        onOnboard={onOnboard}
        readOnly
      />,
    );

    // Read-only notice with the billing nudge link.
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(/read-only/i);
    expect(screen.getByRole('link', { name: /Resubscribe to edit/i })).toHaveAttribute(
      'href',
      '/subscription',
    );

    // Triage actions are disabled and do not mutate.
    const accept = screen.getByRole('button', { name: /Accept/i });
    expect(accept).toBeDisabled();
    fireEvent.click(accept);
    expect(onUpdateStatus).not.toHaveBeenCalled();
  });

  it('enables triage actions when not read-only', () => {
    render(
      <FiscalAgentInbox
        inquiries={[inquiry]}
        onUpdateStatus={onUpdateStatus}
        onOnboard={onOnboard}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
    const accept = screen.getByRole('button', { name: /Accept/i });
    expect(accept).not.toBeDisabled();
    fireEvent.click(accept);
    expect(onUpdateStatus).toHaveBeenCalledWith('1', 'accepted');
  });
});
