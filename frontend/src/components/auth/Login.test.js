import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }) => <a href={to}>{children}</a>,
  useNavigate: () => mockNavigate,
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
