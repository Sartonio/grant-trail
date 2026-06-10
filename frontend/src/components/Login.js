// src/components/Login.js
import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { supabase } from '../supabaseClient';
import { Link, useNavigate } from 'react-router-dom';
import '../styles/Login.css';

function Login({ onLogin }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  // Forgot password view
  const [forgotMode, setForgotMode]         = useState(false);
  const [resetSent, setResetSent]           = useState(false);
  const [resetLoading, setResetLoading]     = useState(false);
  const [resetError, setResetError]         = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
    } else {
      const user = data.user;

      const { data: userRecord, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (userError || !userRecord) {
        // User verified their email but hasn't completed their profile yet
        navigate('/complete-profile');
        setLoading(false);
      } else {
        await onLogin({ user, userRecord });
        navigate(userRecord?.role === 'admin' ? '/admin' : '/');
      }
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    if (!email.trim()) {
      setResetError('Please enter your email address above.');
      return;
    }
    setResetLoading(true);
    setResetError('');

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setResetLoading(false);
    if (error) {
      setResetError(error.message);
    } else {
      setResetSent(true);
    }
  }

  function enterForgotMode(e) {
    e.preventDefault();
    setForgotMode(true);
    setResetSent(false);
    setResetError('');
    setErrorMsg('');
  }

  // ── Forgot password view ──────────────────────────────────────────
  if (forgotMode) {
    return (
      <div className="login">
        <div className="login-container">
          <h2>Reset Password</h2>
          <p className="login-subtitle">
            Enter your email and we'll send you a reset link.
          </p>

          {resetSent ? (
            <div className="login-reset-success">
              <span>✅</span>
              <div>
                <strong>Check your inbox</strong>
                <p>A password reset link has been sent to <em>{email}</em>.</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword}>
              <div className="form-group">
                <label htmlFor="reset-email">Email Address</label>
                <div className="input-with-icon">
                  <span className="input-icon">📧</span>
                  <input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setResetError(''); }}
                    required
                    disabled={resetLoading}
                  />
                </div>
              </div>

              {resetError && (
                <div className="error">
                  <span className="error-icon">⚠️</span>
                  <span>{resetError}</span>
                </div>
              )}

              <button type="submit" disabled={resetLoading}>
                {resetLoading && <span className="button-spinner"></span>}
                <span>{resetLoading ? 'Sending...' : 'Send Reset Link'}</span>
              </button>
            </form>
          )}

          <div className="login-footer">
            <a href="#" onClick={e => { e.preventDefault(); setForgotMode(false); setResetSent(false); }}>
              ← Back to login
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Normal login view ─────────────────────────────────────────────
  return (
    <div className="login">
      <div className="login-container">
        <h2>Welcome Back</h2>
        <p className="login-subtitle">Log in to access your grant dashboard</p>

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <div className="input-with-icon">
              <span className="input-icon">📧</span>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-with-icon">
              <span className="input-icon">🔒</span>
              <input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="login-forgot-row">
            <a href="#" className="forgot-password" onClick={enterForgotMode}>
              Forgot password?
            </a>
          </div>

          <button type="submit" disabled={loading}>
            {loading && <span className="button-spinner"></span>}
            <span>{loading ? 'Logging in...' : 'Log In'}</span>
          </button>
        </form>

        {errorMsg && (
          <div className="error">
            <span className="error-icon">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="login-footer">
          Don't have an account? <Link to="/signup">Sign up here</Link>
        </div>
      </div>
    </div>
  );
}

export default Login;
