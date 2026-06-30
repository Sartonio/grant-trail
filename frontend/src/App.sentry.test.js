import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// refreshMembership() syncs from Stripe then refetches. Force the sync to fail
// so the catch block (console.error + Sentry) runs.
const syncError = new Error('stripe sync failed');
vi.mock('./lib/billing', () => ({
  fetchSessionContext: vi.fn(async () => ({
    userRecord: { id: 'u1', user_id: 'u1', is_active: true, role: 'grantee', tenant_id: 't1' },
    tenant: { is_active: true, tenant_type: 'self_service', name: 'T' },
    tenantConfig: { type: 'self_service', name: 'T' },
    membership: { isExempt: false, hasBasicAccess: true, hasPremiumAccess: false, membership: null, activeSubscription: null },
  })),
  fetchMembershipStatus: vi.fn(async () => ({ isExempt: false, hasBasicAccess: true, hasPremiumAccess: false, membership: null, activeSubscription: null })),
  syncMembershipFromStripe: vi.fn(async () => { throw syncError; }),
  hasRequiredSubscription: vi.fn(() => true),
}));

// Replace the subscription page with a stub that lets us fire onMembershipUpdated
// (i.e. App.refreshMembership) directly. Header/Footer are stubbed out as noise.
vi.mock('./components/billing/SubscriptionPage', () => ({
  default: ({ onMembershipUpdated }) => (
    <button onClick={onMembershipUpdated}>trigger-refresh</button>
  ),
}));
vi.mock('./components/layout/Header', () => ({ default: () => <div /> }));
vi.mock('./components/layout/Footer', () => ({ default: () => <div /> }));

// Table-aware Supabase mock that drives App into an authenticated grantee session.
function responseFor(table, mode) {
  if (mode === 'single') {
    if (table === 'users') return { data: { id: 'u1', user_id: 'u1', is_active: true, role: 'grantee', tenant_id: 't1' }, error: null };
    if (table === 'tenants') return { data: { is_active: true, tenant_type: 'self_service', name: 'T' }, error: null };
    return { data: {}, error: null };
  }
  return { data: [], error: null };
}
function makeBuilder(table) {
  let mode = 'list';
  const builder = {
    then: (resolve) => resolve(responseFor(table, mode)),
    single: vi.fn(() => { mode = 'single'; return builder; }),
  };
  ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit'].forEach((m) => { builder[m] = vi.fn(() => builder); });
  return builder;
}
vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })), signOut: vi.fn() },
    from: vi.fn((table) => makeBuilder(table)),
    channel: vi.fn(() => { const ch = { on: vi.fn(() => ch), subscribe: vi.fn(() => ch) }; return ch; }),
    removeChannel: vi.fn(),
  },
}));

import App from './App';

describe('App membership refresh error reporting', () => {
  beforeEach(() => { captureException.mockClear(); });

  it('captures the error in Sentry and preserves console.error when membership refresh fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.pushState({}, '', '/subscription');

    render(<App />);

    const trigger = await screen.findByText('trigger-refresh');
    fireEvent.click(trigger);

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(syncError));
    expect(consoleSpy).toHaveBeenCalledWith('Failed to refresh membership:', syncError);

    consoleSpy.mockRestore();
  });
});
