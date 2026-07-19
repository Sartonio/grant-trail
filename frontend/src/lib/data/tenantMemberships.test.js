// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.hoisted(() => vi.fn());

vi.mock('../../supabaseClient', () => ({ supabase: { from: fromMock } }));

import { getMyTenantMembership } from './tenantMemberships';

beforeEach(() => {
  fromMock.mockReset();
});

describe('getMyTenantMembership', () => {
  it('selects the active tenant membership, newest first, as a single row', async () => {
    const row = { tenant_id: 2, membership_tier: 'premium', is_active: true };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const limit = vi.fn(() => ({ maybeSingle }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    fromMock.mockReturnValue({ select });

    const { data } = await getMyTenantMembership();

    expect(fromMock).toHaveBeenCalledWith('tenant_memberships');
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('is_active', true);
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(1);
    expect(data).toBe(row);
  });

  it('does not add a tenant_id filter (RLS scopes the row to the caller)', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn(() => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }));
    const select = vi.fn(() => ({ eq }));
    fromMock.mockReturnValue({ select });

    await getMyTenantMembership();

    // The only .eq() is the is_active filter — no client-side tenant scoping.
    expect(eq).toHaveBeenCalledTimes(1);
    expect(eq).toHaveBeenCalledWith('is_active', true);
  });
});
