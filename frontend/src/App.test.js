import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Exercises App.js's ACTUAL route table + <Guard> wiring (not a hand-copied
// mirror): seed a session, mount <App>, and assert the role/billing redirect.
// policy.js and guards.js are left REAL — they are what we are validating.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  fetchSessionContext: vi.fn(),
}));

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }));
vi.mock('./supabaseClient', () => ({
  supabase: { auth: { getUser: mocks.getUser, signOut: mocks.signOut } },
}));
vi.mock('./lib/billing', () => ({ fetchSessionContext: mocks.fetchSessionContext }));

vi.mock('./hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [], handleMarkRead: vi.fn(), handleMarkAllRead: vi.fn(), handleClearAll: vi.fn(),
  }),
}));
vi.mock('./hooks/usePlatformSettings', () => ({ usePlatformSettings: () => ({}) }));
vi.mock('./hooks/useMembership', () => ({
  useMembership: () => ({ loadMembershipStatus: vi.fn(), refreshMembership: vi.fn() }),
}));

// Stub the layout + route-target components so we can assert which one renders
// without dragging their data fetching into the test.
vi.mock('./components/layout/Header', () => ({ default: () => null }));
vi.mock('./components/layout/Footer', () => ({ default: () => null }));
vi.mock('./components/landing/LandingPage', () => ({ default: () => <div>LANDING</div> }));
vi.mock('./components/grant/Main', () => ({ default: () => <div>MAIN</div> }));
vi.mock('./components/admin/AdminDashboard', () => ({ default: () => <div>ADMIN_DASH</div> }));
vi.mock('./components/admin/TenantManagement', () => ({ default: () => <div>TENANTS</div> }));

import App from './App';

function seedUser({ role, membership, is_active = true, tenantActive = true }) {
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  mocks.fetchSessionContext.mockResolvedValue({
    userRecord: { id: 'u1', role, is_active },
    tenant: { is_active: tenantActive },
    tenantConfig: { type: 'managed' },
    membership,
  });
}

function renderAt(path) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.signOut.mockReset();
  mocks.fetchSessionContext.mockReset();
});

describe('App route table + Guard wiring', () => {
  it('shows the public landing page at "/" when logged out', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    renderAt('/');
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('redirects a super_admin from "/" to /super/tenants', async () => {
    seedUser({ role: 'super_admin', membership: null });
    renderAt('/');
    await waitFor(() => expect(window.location.pathname).toBe('/super/tenants'));
    expect(await screen.findByText('TENANTS')).toBeInTheDocument();
  });

  it('redirects a paid admin from "/" to /admin', async () => {
    seedUser({ role: 'admin', membership: { hasPremiumAccess: true } });
    renderAt('/');
    await waitFor(() => expect(window.location.pathname).toBe('/admin'));
    expect(await screen.findByText('ADMIN_DASH')).toBeInTheDocument();
  });

  it('redirects an unpaid grantee from "/" to the billing nudge (/home)', async () => {
    seedUser({ role: 'grantee', membership: { hasBasicAccess: false } });
    renderAt('/');
    await waitFor(() => expect(window.location.pathname).toBe('/home'));
  });

  it('renders the grantee dashboard at "/" for a paid grantee', async () => {
    seedUser({ role: 'grantee', membership: { hasBasicAccess: true } });
    renderAt('/');
    expect(await screen.findByText('MAIN')).toBeInTheDocument();
  });

  it('sends an admin who hits a grantee-only route (/grants) to /admin', async () => {
    seedUser({ role: 'admin', membership: { hasPremiumAccess: true } });
    renderAt('/grants');
    await waitFor(() => expect(window.location.pathname).toBe('/admin'));
  });

  it('sends a grantee who hits an admin-only route (/admin) back to "/"', async () => {
    seedUser({ role: 'grantee', membership: { hasBasicAccess: true } });
    renderAt('/admin');
    // Role guard bounces to "/", which then resolves to the grantee dashboard.
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await screen.findByText('MAIN')).toBeInTheDocument();
  });
});
