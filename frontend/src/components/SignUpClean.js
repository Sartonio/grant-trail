// src/components/SignUpClean.js
// Step 1 of signup: collect email + password only.
// After email verification (or immediate confirmation if turned off),
// the user is redirected to /complete-profile to fill in their details.
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Link, useSearchParams } from 'react-router-dom';
import { FaEnvelope, FaLock, FaCheckCircle } from 'react-icons/fa';
import '../styles/Login.css';

function SignUp() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifyScreen, setVerifyScreen] = useState(false);

  // Invite state
  const [invite, setInvite] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);
  const [inviteError, setInviteError] = useState('');

  // Validate invite token on mount
  useEffect(() => {
    if (!inviteToken) return;

    async function validateInvite() {
      const { data, error } = await supabase
        .from('invites')
        .select('*, tenants(name)')
        .eq('token', inviteToken)
        .single();

      if (error || !data) {
        setInviteError('Invalid invite link.');
      } else if (data.used_at) {
        setInviteError('This invite has already been used.');
      } else if (new Date(data.expires_at) < new Date()) {
        setInviteError('This invite has expired.');
      } else {
        setInvite(data);
        if (data.email) setEmail(data.email);
      }
      setInviteLoading(false);
    }

    validateInvite();
  }, [inviteToken]);

  function buildRedirectUrl() {
    let redirectUrl = `${window.location.origin}/complete-profile`;
    if (inviteToken) {
      redirectUrl += `?invite=${inviteToken}`;
    }
    return redirectUrl;
  }

  function getNormalizedEmail(value = email) {
    return value.trim().toLowerCase();
  }

  async function resendVerificationEmail(targetEmail = email) {
    const redirectUrl = buildRedirectUrl();
    const normalizedEmail = getNormalizedEmail(targetEmail);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });

    if (error) {
      throw error;
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const redirectUrl = buildRedirectUrl();
      const normalizedEmail = getNormalizedEmail();

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) {
        const shouldRetryWithResend = /already registered|already exists|user already/i.test(error.message || '');
        if (shouldRetryWithResend) {
          await resendVerificationEmail(normalizedEmail);
          setVerifyScreen(true);
          setInfoMsg('We sent a fresh verification link to your email address.');
          setLoading(false);
          return;
        }

        setErrorMsg(error.message || 'Signup failed');
        setLoading(false);
        return;
      }

      // If session is returned, user is auto-confirmed (email confirmation OFF)
      // If session is null, email confirmation is required
      if (data.session) {
        // Email confirmation is OFF - user is immediately confirmed
        // Navigate to complete-profile
        window.location.href = redirectUrl;
      } else {
        // Email confirmation is ON.
        // When Supabase returns a user with no identities, it is an existing account placeholder.
        // In that case, explicitly resend the signup confirmation email.
        const isExistingUnconfirmedUser =
          Array.isArray(data?.user?.identities) && data.user.identities.length === 0;

        if (isExistingUnconfirmedUser) {
          await resendVerificationEmail(normalizedEmail);
          setInfoMsg('We sent a fresh verification link to your email address.');
        }

        setVerifyScreen(true);
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Unexpected error during signup');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);

    try {
      await resendVerificationEmail();
      setInfoMsg('We sent a fresh verification link to your email address.');
    } catch (err) {
      setErrorMsg(err?.message || 'Unable to resend verification email.');
    } finally {
      setLoading(false);
    }
  }

  // Show loading state while validating invite
  if (inviteLoading) {
    return (
      <div className="signup">
        <div className="signup-container">
          <p>Validating invite...</p>
        </div>
      </div>
    );
  }

  // Show error if invite is invalid
  if (inviteToken && inviteError) {
    return (
      <div className="signup">
        <div className="signup-container">
          <h2>Invalid Invite</h2>
          <div className="error">
            <span className="error-icon">⚠️</span>
            <span>{inviteError}</span>
          </div>
          <div className="signup-footer">
            <Link to="/login">Back to login</Link>
          </div>
        </div>
      </div>
    );
  }

  // Show "check your email" screen after signup when confirmation is required
  if (verifyScreen) {
    return (
      <div className="signup">
        <div className="signup-container" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', color: 'var(--color-primary)', marginBottom: '0.5em' }}>
            <FaCheckCircle />
          </div>
          <h2>Check Your Email</h2>
          <p style={{ color: '#6b7280', lineHeight: 1.6, marginBottom: '1.5em' }}>
            We've sent a verification link to <strong>{email}</strong>.
            <br />Click the link in the email to verify your account, then you'll be asked to complete your profile.
          </p>
          {infoMsg && (
            <div className="success-message" style={{ marginBottom: '1em' }}>
              {infoMsg}
            </div>
          )}
          {errorMsg && (
            <div className="error" style={{ marginBottom: '1em' }}>
              <span className="error-icon">⚠️</span>
              <span>{errorMsg}</span>
            </div>
          )}
          <button type="button" onClick={handleResendVerification} disabled={loading}>
            <span>{loading ? 'Sending link…' : 'Resend verification email'}</span>
          </button>
          <div className="signup-footer">
            <Link to="/login">Back to login</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="signup">
      <div className="signup-container">
        <h2>Create Account</h2>
        {invite ? (
          <p className="signup-subtitle">
            You've been invited to join as a <strong>{invite.role}</strong>
          </p>
        ) : (
          <p className="signup-subtitle">Create your own workspace to track grants and expenses</p>
        )}

        <form onSubmit={handleSignup}>

          {/* Email */}
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <div className="input-with-icon">
              <FaEnvelope className="input-icon" />
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading || (invite?.email ? true : false)}
              />
            </div>
          </div>

          {/* Password */}
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-with-icon">
              <FaLock className="input-icon" />
              <input
                id="password"
                type="password"
                placeholder="Create a password (min 6 characters)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <button type="submit" disabled={loading}>
            {loading && <span className="button-spinner"></span>}
            <span>{loading ? 'Creating account…' : 'Create Account'}</span>
          </button>

        </form>

        {errorMsg && (
          <div className="error">
            <span className="error-icon">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="signup-footer">
          Already have an account? <Link to="/login">Log in here</Link>
        </div>
      </div>
    </div>
  );
}

export default SignUp;
