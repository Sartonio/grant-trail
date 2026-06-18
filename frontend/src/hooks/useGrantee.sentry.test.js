import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ captureException: (...args) => captureException(...args) }));

// An authenticated user exists, but the users-table fetch returns an error so
// the error branch (console.error + Sentry) runs.
const fetchError = new Error('users fetch failed');
const builder = { then: (resolve) => resolve({ data: null, error: fetchError }) };
['select', 'eq', 'single'].forEach((m) => { builder[m] = vi.fn(() => builder); });
vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
    from: vi.fn(() => builder),
  },
}));

import { useUser } from './useGrantee';

describe('useUser error reporting', () => {
  beforeEach(() => { captureException.mockClear(); });

  it('captures the error in Sentry and preserves console.error when the user fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useUser());

    await waitFor(() => expect(captureException).toHaveBeenCalledWith(fetchError));
    expect(consoleSpy).toHaveBeenCalledWith('Error fetching user record:', fetchError);

    consoleSpy.mockRestore();
  });
});
