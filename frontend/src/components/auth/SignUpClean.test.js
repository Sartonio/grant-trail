import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-router', () => ({
  Link: ({ to, children }) => <a href={to}>{children}</a>,
  useSearchParams: () => [new URLSearchParams(window.location.search)],
}));

vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      resend: vi.fn(),
    },
  },
}));

vi.mock('../../lib/invites', () => ({
  getInviteByToken: vi.fn(),
}));

import { supabase } from '../../supabaseClient';
import { getInviteByToken } from '../../lib/invites';
import SignUp from './SignUpClean';

const FRESH_SIGNUP_RESPONSE = {
  data: { user: { id: 'u1', identities: [{ id: 'i1' }] }, session: null },
  error: null,
};

// Existing account (confirmed or not): Supabase returns a placeholder user
// with an EMPTY identities array when Confirm-email is ON.
const EXISTING_ACCOUNT_RESPONSE = {
  data: { user: { id: 'u1', identities: [] }, session: null },
  error: null,
};

async function fillAndSubmit({ email = 'maria@example.com' } = {}) {
  fireEvent.change(screen.getByLabelText(/email address/i), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: 'password123' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  });
}

function renderAt(search = '') {
  window.history.pushState({}, '', `/signup${search}`);
  render(<SignUp />);
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.auth.resend.mockResolvedValue({ error: null });
});

describe('SignUpClean — existing-account routing (C1 revised)', () => {
  test('fresh signup shows the verify screen with the neutral login line', async () => {
    supabase.auth.signUp.mockResolvedValue(FRESH_SIGNUP_RESPONSE);
    renderAt();
    await fillAndSubmit();

    expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText(/already have an account\?/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /log in or reset your password/i }),
    ).toHaveAttribute('href', '/login');
    // No resend attempted for a genuinely new account
    expect(supabase.auth.resend).not.toHaveBeenCalled();
  });

  test('existing account (empty identities) shows the already-have-an-account screen, no resend', async () => {
    supabase.auth.signUp.mockResolvedValue(EXISTING_ACCOUNT_RESPONSE);
    renderAt();
    await fillAndSubmit();

    // Confirmed and unconfirmed both read as "already have an account" —
    // login handles the unconfirmed case with the confirm-email screen.
    expect(screen.getByText(/you already have an account/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute(
      'href',
      '/login',
    );
    // No probing resend against an existing account.
    expect(supabase.auth.resend).not.toHaveBeenCalled();
  });

  test('existing account via signUp "already registered" error also shows the log-in screen', async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    });
    renderAt();
    await fillAndSubmit();

    expect(screen.getByText(/you already have an account/i)).toBeInTheDocument();
    // Raw auth error never surfaced verbatim.
    expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();
    expect(supabase.auth.resend).not.toHaveBeenCalled();
  });

  test('already-have-an-account screen mentions confirming email and password reset', async () => {
    supabase.auth.signUp.mockResolvedValue(EXISTING_ACCOUNT_RESPONSE);
    renderAt();
    await fillAndSubmit();

    expect(screen.getByText(/help you confirm it after you log in/i)).toBeInTheDocument();
    expect(screen.getByText(/reset it from the login page/i)).toBeInTheDocument();
  });

  test('manual resend that reports already-confirmed switches to the log-in screen', async () => {
    vi.useFakeTimers();
    try {
      supabase.auth.signUp.mockResolvedValue(FRESH_SIGNUP_RESPONSE);
      renderAt();
      await fillAndSubmit();
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();

      // Wait out the 15s cooldown, then resend against a now-confirmed account.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });
      supabase.auth.resend.mockResolvedValue({
        error: { message: 'Email address already confirmed', status: 400 },
      });

      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: /resend verification email/i }),
        );
      });

      expect(screen.getByText(/you already have an account/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test('genuine signup failures still show their real error on the form', async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Password should be at least 6 characters' },
    });
    renderAt();
    await fillAndSubmit();

    expect(
      screen.getByText(/password should be at least 6 characters/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
    expect(supabase.auth.resend).not.toHaveBeenCalled();
  });
});

describe('SignUpClean — fiscal-agent plan intent is durable', () => {
  test('fiscal-agent signup persists the plan in auth user metadata and the redirect URL', async () => {
    supabase.auth.signUp.mockResolvedValue(FRESH_SIGNUP_RESPONSE);
    renderAt('?plan=fiscal-agent');
    await fillAndSubmit();

    expect(supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          data: { plan: 'fiscal-agent' },
          emailRedirectTo: expect.stringContaining('/complete-profile?plan=fiscal-agent'),
        }),
      }),
    );
  });

  test('default signup passes no plan metadata', async () => {
    supabase.auth.signUp.mockResolvedValue(FRESH_SIGNUP_RESPONSE);
    renderAt();
    await fillAndSubmit();

    expect(supabase.auth.signUp).toHaveBeenCalledTimes(1);
    const { options } = supabase.auth.signUp.mock.calls[0][0];
    expect(options.data).toBeUndefined();
  });

  test('already-have-an-account "Log in" link preserves ?plan=fiscal-agent', async () => {
    supabase.auth.signUp.mockResolvedValue(EXISTING_ACCOUNT_RESPONSE);
    renderAt('?plan=fiscal-agent');
    await fillAndSubmit();

    expect(screen.getByText(/you already have an account/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute(
      'href',
      '/login?plan=fiscal-agent',
    );
  });

  test('signup footer login link preserves ?plan=fiscal-agent', () => {
    renderAt('?plan=fiscal-agent');

    expect(screen.getByRole('link', { name: /log in here/i })).toHaveAttribute(
      'href',
      '/login?plan=fiscal-agent',
    );
  });
});

describe('SignUpClean — invite flow note (C4)', () => {
  test('verify screen with ?invite= notes invites are for new accounts only, neutrally', async () => {
    getInviteByToken.mockResolvedValue({
      data: {
        token: 'tok123',
        role: 'grantee',
        email: null,
        used_at: null,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
      error: null,
    });
    supabase.auth.signUp.mockResolvedValue(FRESH_SIGNUP_RESPONSE);
    renderAt('?invite=tok123');

    // Wait for invite validation to finish
    await screen.findByLabelText(/email address/i);
    await fillAndSubmit();

    expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    expect(
      screen.getByText(/invite links can only be redeemed by new accounts/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ask your admin/i)).toBeInTheDocument();
  });

  test('verify screen without an invite does NOT show the invite note', async () => {
    supabase.auth.signUp.mockResolvedValue(FRESH_SIGNUP_RESPONSE);
    renderAt();
    await fillAndSubmit();

    expect(
      screen.queryByText(/invite links can only be redeemed/i),
    ).not.toBeInTheDocument();
  });
});

describe('SignUpClean — resend cooldown (A2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('resend button starts on a 15s cooldown after signup, re-enables at 0, and re-cools after a click', async () => {
    supabase.auth.signUp.mockResolvedValue(FRESH_SIGNUP_RESPONSE);
    renderAt();
    await fillAndSubmit();

    // Cooldown active right after the initial send
    const cooling = screen.getByRole('button', { name: /resend available in 15s/i });
    expect(cooling).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    const resendButton = screen.getByRole('button', {
      name: /resend verification email/i,
    });
    expect(resendButton).toBeEnabled();

    await act(async () => {
      fireEvent.click(resendButton);
    });

    expect(supabase.auth.resend).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: /resend available in \d+s/i }),
    ).toBeDisabled();
  });

  test('rate-limited manual resend shows a friendly wait message, not the raw error', async () => {
    supabase.auth.signUp.mockResolvedValue(FRESH_SIGNUP_RESPONSE);
    renderAt();
    await fillAndSubmit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    supabase.auth.resend.mockResolvedValue({
      error: {
        message: 'For security purposes, you can only request this once every 60 seconds',
        status: 429,
      },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /resend verification email/i }),
      );
    });

    expect(
      screen.getByText(/please wait a moment before requesting another email/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/security purposes/i)).not.toBeInTheDocument();
  });
});

describe('SignUpClean — happy path unchanged', () => {
  test('waitFor sanity: form renders with create account button', async () => {
    renderAt();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /create account/i }),
      ).toBeInTheDocument();
    });
  });
});
