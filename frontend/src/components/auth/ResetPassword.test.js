import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  Link: ({ to, children }) => <a href={to}>{children}</a>,
}));

// Controllable supabase auth mock. Tests set `sessionResult` and capture the
// onAuthStateChange callback to simulate async supabase-js URL detection.
let sessionResult;
let authCallback;
const unsubscribe = vi.fn();
vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve(sessionResult)),
      onAuthStateChange: vi.fn((cb) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe } } };
      }),
      updateUser: vi.fn(() => Promise.resolve({ error: null })),
      signOut: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
}));

import ResetPassword from './ResetPassword';

function setUrl(hash = '', search = '') {
  window.history.replaceState({}, '', `/reset-password${search}${hash}`);
}

describe('ResetPassword recovery-link detection (C3)', () => {
  beforeEach(() => {
    navigate.mockClear();
    unsubscribe.mockClear();
    authCallback = undefined;
    sessionResult = { data: { session: null } };
    setUrl();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('enables the form when a session already exists before mount (hash consumed early)', async () => {
    sessionResult = { data: { session: { user: { id: 'u1' } } } };
    render(<ResetPassword />);

    await waitFor(() => {
      expect(screen.getByLabelText('New Password')).toBeEnabled();
    });
    expect(screen.getByLabelText('Confirm Password')).toBeEnabled();
    expect(screen.getByRole('button', { name: /Update Password/i })).toBeEnabled();
    expect(screen.queryByText(/invalid or expired/i)).not.toBeInTheDocument();
  });

  test('enables the form when a PASSWORD_RECOVERY auth event arrives after mount', async () => {
    render(<ResetPassword />);

    // No token in the URL and no session yet: pending, not the invalid error.
    expect(screen.getByText(/Verifying reset link/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid or expired/i)).not.toBeInTheDocument();

    await act(async () => {
      authCallback('PASSWORD_RECOVERY', { user: { id: 'u1' } });
    });

    expect(screen.getByLabelText('New Password')).toBeEnabled();
    expect(screen.getByRole('button', { name: /Update Password/i })).toBeEnabled();
  });

  test('enables the form when SIGNED_IN arrives with a session', async () => {
    render(<ResetPassword />);

    await act(async () => {
      authCallback('SIGNED_IN', { user: { id: 'u1' } });
    });

    expect(screen.getByLabelText('New Password')).toBeEnabled();
  });

  test('shows the expired-link error for an otp_expired error hash', async () => {
    setUrl('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    render(<ResetPassword />);

    expect(
      screen.getByText(/expired or was already used/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('New Password')).toBeDisabled();
    // Give the mount-time getSession promise a tick; still an error state.
    await act(async () => {});
    expect(screen.getByLabelText('New Password')).toBeDisabled();
  });

  test('shows pending then the invalid error only after the timeout with no signal', async () => {
    vi.useFakeTimers();
    render(<ResetPassword />);

    // Flush the getSession() promise (no session).
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Verifying reset link/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid or expired/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('New Password')).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New Password')).toBeDisabled();
  });

  test('a type=recovery token in the URL enables the form immediately', () => {
    setUrl('#access_token=abc&type=recovery');
    render(<ResetPassword />);

    expect(screen.getByLabelText('New Password')).toBeEnabled();
    expect(screen.queryByText(/Verifying reset link/i)).not.toBeInTheDocument();
  });

  test('unsubscribes from auth events on unmount', () => {
    const { unmount } = render(<ResetPassword />);
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
