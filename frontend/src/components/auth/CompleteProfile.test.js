import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock routing: control search params per-test, capture navigation.
const navigate = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams],
  Link: ({ to, children }) => <a href={to}>{children}</a>,
}));

// Mock supabase so RPC provisioning is observable (and never real).
const rpc = vi.fn();
vi.mock('../../supabaseClient', () => ({
  supabase: { rpc: (...args) => rpc(...args) },
}));

// Mock the invites data layer.
const getInviteByToken = vi.fn();
const registerInvitedUser = vi.fn();
vi.mock('../../lib/invites', () => ({
  getInviteByToken: (...args) => getInviteByToken(...args),
  registerInvitedUser: (...args) => registerInvitedUser(...args),
}));

// Mock billing so Stripe checkout is observable (and never real).
const startCheckoutSession = vi.fn();
vi.mock('../../lib/billing', () => ({
  startCheckoutSession: (...args) => startCheckoutSession(...args),
  MEMBERSHIP_TIERS: { BASIC: 'basic', ORG_ADMIN: 'premium' },
}));

import CompleteProfile from './CompleteProfile';

const session = { user: { id: 'auth-user-1', email: 'invited@example.com' } };

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function fillForm() {
  fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Maria' } });
  fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Smith' } });
  fireEvent.change(screen.getByPlaceholderText('Phone number'), { target: { value: '555-0101' } });
  fireEvent.change(screen.getByPlaceholderText('Organization name'), { target: { value: 'Helping Hands' } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /Complete Setup/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
  rpc.mockResolvedValue({ data: { id: 'row-1' }, error: null });
  startCheckoutSession.mockResolvedValue({ url: 'https://stripe.test/session' });
});

describe('CompleteProfile — invalid invite must never fall through to self-service (C2)', () => {
  test('used invite shows the dedicated error screen, no form, no provisioning', async () => {
    searchParams = new URLSearchParams('invite=tok-used');
    getInviteByToken.mockResolvedValue({
      data: { used_at: PAST, expires_at: FUTURE, tenants: { name: 'Acme Org' } },
      error: null,
    });

    render(<CompleteProfile session={session} />);

    expect(await screen.findByText('Invite No Longer Valid')).toBeInTheDocument();
    expect(screen.getByText(/This invite has already been used\./)).toBeInTheDocument();
    expect(screen.getByText(/organization's admin/i)).toBeInTheDocument();
    // Link back to login.
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login');
    // No profile form — nothing to submit.
    expect(screen.queryByRole('button', { name: /Complete Setup/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('First name')).not.toBeInTheDocument();
    // And absolutely no self-service provisioning or checkout.
    expect(rpc).not.toHaveBeenCalled();
    expect(startCheckoutSession).not.toHaveBeenCalled();
  });

  test('expired invite shows the expired message (expiry was previously ignored)', async () => {
    searchParams = new URLSearchParams('invite=tok-expired');
    getInviteByToken.mockResolvedValue({
      data: { used_at: null, expires_at: PAST, tenants: { name: 'Acme Org' } },
      error: null,
    });

    render(<CompleteProfile session={session} />);

    expect(await screen.findByText('Invite No Longer Valid')).toBeInTheDocument();
    expect(screen.getByText(/This invite has expired\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete Setup/i })).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(startCheckoutSession).not.toHaveBeenCalled();
  });

  test('unknown token (no data) shows the invalid message', async () => {
    searchParams = new URLSearchParams('invite=tok-missing');
    getInviteByToken.mockResolvedValue({ data: null, error: null });

    render(<CompleteProfile session={session} />);

    expect(await screen.findByText('Invite No Longer Valid')).toBeInTheDocument();
    expect(screen.getByText(/Invalid invite link\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete Setup/i })).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(startCheckoutSession).not.toHaveBeenCalled();
  });

  test('lookup error shows the invalid message', async () => {
    searchParams = new URLSearchParams('invite=tok-error');
    getInviteByToken.mockResolvedValue({ data: null, error: { message: 'boom' } });

    render(<CompleteProfile session={session} />);

    expect(await screen.findByText('Invite No Longer Valid')).toBeInTheDocument();
    expect(screen.getByText(/Invalid invite link\./)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(startCheckoutSession).not.toHaveBeenCalled();
  });

  test('defense in depth: submit with a token but no validated invite errors instead of self-service', async () => {
    // Mount without the invite param so the form renders, then let the token
    // appear via a rerender — invite stays null while the form is visible.
    searchParams = new URLSearchParams();
    getInviteByToken.mockReturnValue(new Promise(() => {})); // never resolves
    const { rerender } = render(<CompleteProfile session={session} />);

    searchParams = new URLSearchParams('invite=tok-race');
    rerender(<CompleteProfile session={session} />);

    fillForm();
    submit();

    expect(await screen.findByText(/invite/i, { selector: '.error span:last-child' })).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(registerInvitedUser).not.toHaveBeenCalled();
    expect(startCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('CompleteProfile — valid flows unchanged', () => {
  test('shows loading state while the invite is validating', () => {
    searchParams = new URLSearchParams('invite=tok-pending');
    getInviteByToken.mockReturnValue(new Promise(() => {}));

    render(<CompleteProfile session={session} />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('First name')).not.toBeInTheDocument();
  });

  test('valid invite renders the form and registers via the invite RPC (no checkout)', async () => {
    searchParams = new URLSearchParams('invite=tok-valid');
    getInviteByToken.mockResolvedValue({
      data: { used_at: null, expires_at: FUTURE, tenants: { name: 'Acme Org' } },
      error: null,
    });
    registerInvitedUser.mockResolvedValue({ data: { id: 'user-row' }, error: null });
    const onProfileComplete = vi.fn();

    render(<CompleteProfile session={session} onProfileComplete={onProfileComplete} />);

    expect(await screen.findByText('Acme Org')).toBeInTheDocument();
    fillForm();
    submit();

    await waitFor(() => expect(registerInvitedUser).toHaveBeenCalledTimes(1));
    expect(registerInvitedUser).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok-valid', firstname: 'Maria', lastname: 'Smith' })
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(startCheckoutSession).not.toHaveBeenCalled();
    await waitFor(() => expect(onProfileComplete).toHaveBeenCalledTimes(1));
  });

  test('fiscal-agent plan provisions a charity tenant and starts premium checkout', async () => {
    searchParams = new URLSearchParams('plan=fiscal-agent');

    render(<CompleteProfile session={session} />);

    fillForm();
    submit();

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith(
      'provision_fiscal_agent_tenant',
      expect.objectContaining({ p_auth_uid: 'auth-user-1' })
    );
    await waitFor(() => expect(startCheckoutSession).toHaveBeenCalledTimes(1));
    expect(startCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ membershipTier: 'premium' })
    );
    expect(getInviteByToken).not.toHaveBeenCalled();
  });

  test('no invite param at all still uses the self-service branch + Basic checkout', async () => {
    searchParams = new URLSearchParams();

    render(<CompleteProfile session={session} />);

    fillForm();
    submit();

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith(
      'provision_self_service_tenant',
      expect.objectContaining({ p_auth_uid: 'auth-user-1', p_email: 'invited@example.com' })
    );
    await waitFor(() => expect(startCheckoutSession).toHaveBeenCalledTimes(1));
    expect(startCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ membershipTier: 'basic', returnPath: '/subscription' })
    );
    expect(getInviteByToken).not.toHaveBeenCalled();
  });
});
