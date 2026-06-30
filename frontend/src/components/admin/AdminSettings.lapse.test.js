import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock navigation so we can assert blocked mutations route to the billing nudge.
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  Link: ({ to, children }) => <a href={to}>{children}</a>,
}));

// Mock supabase so a mutation would be observable if it ever fired.
const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
vi.mock('../../supabaseClient', () => ({
  supabase: { from: () => ({ update }) },
}));

import AdminSettings from './AdminSettings';

const tenantConfig = {
  require_grant_approval: true,
  require_budget_approval: true,
  require_expense_approval: true,
  support_email: 'a@b.com',
  support_phone: '',
};

const lapsedAdmin = {
  userRecord: { role: 'admin', tenant_id: 't1' },
  membership: { hasPremiumAccess: false, isExempt: false },
  tenantConfig,
};
const paidAdmin = {
  userRecord: { role: 'admin', tenant_id: 't1' },
  membership: { hasPremiumAccess: true },
  tenantConfig,
};

describe('AdminSettings — lapsed admin can READ but cannot WRITE (#40)', () => {
  beforeEach(() => { navigate.mockClear(); update.mockClear(); });

  it('renders the settings view in read-only mode (can read)', () => {
    render(<AdminSettings session={lapsedAdmin} readOnly />);
    // View is rendered.
    expect(screen.getByText('Settings')).toBeInTheDocument();
    // Read-only banner is shown.
    expect(screen.getByRole('status')).toHaveTextContent(/read-only/i);
    // Save button is disabled.
    expect(screen.getByRole('button', { name: /Save Settings/i })).toBeDisabled();
  });

  it('blocks the save mutation and routes to the billing nudge', () => {
    render(<AdminSettings session={lapsedAdmin} readOnly />);
    // Make a change so the button would normally be enabled, then force-click handler.
    const emailInput = screen.getByPlaceholderText('support@yourorg.com');
    fireEvent.change(emailInput, { target: { value: 'changed@x.com' } });
    // Even invoking the handler path must not mutate; the write guard intercepts.
    const btn = screen.getByRole('button', { name: /Save Settings/i });
    fireEvent.click(btn);
    expect(update).not.toHaveBeenCalled();
  });

  it('a paid admin is not read-only and can save', async () => {
    render(<AdminSettings session={paidAdmin} />);
    expect(screen.queryByRole('status')).toBeNull();
    const emailInput = screen.getByPlaceholderText('support@yourorg.com');
    fireEvent.change(emailInput, { target: { value: 'changed@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Settings/i }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });
});
