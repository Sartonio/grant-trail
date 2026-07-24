import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockNavigate = vi.fn();
// Controls the login page's own query string per-test (?plan=fiscal-agent).
let mockSearch = '';

vi.mock('react-router', () => ({
  Link: ({ to, children }) => <a href={to}>{children}</a>,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/login', search: mockSearch }),
}));

vi.mock('../../supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

vi.mock('../../lib/data/users', () => ({
  getUserByAuthId: vi.fn(),
}));

import { supabase } from '../../supabaseClient';
import { getUserByAuthId } from '../../lib/data/users';
import Login from './Login';

async function fillAndLogin({ email = 'maria@example.com', password = 'password123' } = {}) {
  fireEvent.change(screen.getByLabelText(/email address/i), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: password },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearch = '';
  supabase.auth.resend.mockResolvedValue({ error: null });
});

describe('Login — unconfirmed email', () => {
  test('login with correct credentials but unconfirmed email shows the confirm-email screen', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed', status: 400 },
    });
    render(<Login onLogin={vi.fn()} />);
    await fillAndLogin();

    expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText(/maria@example\.com/)).toBeInTheDocument();
    // A fresh verification link is sent immediately so the copy is truthful.
    expect(supabase.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'signup', email: 'maria@example.com' }),
    );
    // Raw auth error never surfaced verbatim.
    expect(screen.queryByText(/email not confirmed/i)).not.toBeInTheDocument();
    // Nothing else is reachable — no navigation happened.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('confirm-email screen has a resend button on cooldown and a way back to login', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed', status: 400 },
    });
    render(<Login onLogin={vi.fn()} />);
    await fillAndLogin();

    expect(
      screen.getByRole('button', { name: /resend available in \d+s/i }),
    ).toBeDisabled();

    fireEvent.click(screen.getByText(/back to login/i));
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  });

  test('a resend failure while entering the screen does not block it', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed', status: 400 },
    });
    supabase.auth.resend.mockResolvedValue({
      error: { message: 'For security purposes, you can only request this once every 60 seconds', status: 429 },
    });
    render(<Login onLogin={vi.fn()} />);
    await fillAndLogin();

    expect(screen.getByText(/check your email/i)).toBeInTheDocument();
  });

  test('other login errors still show on the form', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials', status: 400 },
    });
    render(<Login onLogin={vi.fn()} />);
    await fillAndLogin();

    expect(screen.getByText(/invalid login credentials/i)).toBeInTheDocument();
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
    expect(supabase.auth.resend).not.toHaveBeenCalled();
  });
});

describe('Login — plan intent survives the redirect to /complete-profile', () => {
  test('verified user without a profile is redirected with the login page query string', async () => {
    mockSearch = '?plan=fiscal-agent';
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'auth-1' }, session: {} },
      error: null,
    });
    getUserByAuthId.mockResolvedValue({ data: null, error: { message: 'not found' } });
    render(<Login onLogin={vi.fn()} />);
    await fillAndLogin();

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/complete-profile',
      search: '?plan=fiscal-agent',
    });
  });

  test('without a plan param the redirect carries an empty query string', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'auth-1' }, session: {} },
      error: null,
    });
    getUserByAuthId.mockResolvedValue({ data: null, error: { message: 'not found' } });
    render(<Login onLogin={vi.fn()} />);
    await fillAndLogin();

    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/complete-profile',
      search: '',
    });
  });

  test('resend verification includes the plan in emailRedirectTo when present in the URL', async () => {
    mockSearch = '?plan=fiscal-agent';
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed', status: 400 },
    });
    render(<Login onLogin={vi.fn()} />);
    await fillAndLogin();

    expect(supabase.auth.resend).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          emailRedirectTo: expect.stringContaining('/complete-profile?plan=fiscal-agent'),
        },
      }),
    );
  });

  test('resend verification without a plan keeps the plain redirect', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed', status: 400 },
    });
    render(<Login onLogin={vi.fn()} />);
    await fillAndLogin();

    const { options } = supabase.auth.resend.mock.calls[0][0];
    expect(options.emailRedirectTo).not.toContain('plan=');
    expect(options.emailRedirectTo).toContain('/complete-profile');
  });
});

describe('Login — password reset works regardless of confirmation state', () => {
  test('forgot-password sends a reset link without any confirmed-email gate', async () => {
    supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<Login onLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'unconfirmed@example.com' },
    });
    fireEvent.click(screen.getByText(/forgot password\?/i));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    });

    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'unconfirmed@example.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('/reset-password') }),
    );
    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
  });
});
