// src/components/SignUpClean.js
// Step 1 of signup: collect email + password only.
// After email verification (or immediate confirmation if turned off),
// the user is redirected to /complete-profile to fill in their details.
import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { getInviteByToken } from '../../lib/invites';
import { Link, useSearchParams } from 'react-router';
import { FaEnvelope, FaLock, FaCheckCircle } from 'react-icons/fa';
import VerifyEmailNotice from './VerifyEmailNotice';
import '../../styles/Login.css';

// Heuristic for "an account with this email already exists" signUp errors.
const EXISTING_ACCOUNT_ERROR = /already registered|already exists|user already/i;

function SignUp() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  // Account-first Fiscal Agent signup carries ?plan=fiscal-agent through email
  // verification so CompleteProfile provisions an admin/listing tenant + premium
  // checkout instead of the default grantee + basic checkout.
  const plan = searchParams.get('plan');
  // Keep the plan choice alive across the hop to /login so Login can forward it
  // to /complete-profile (and into resend redirect links).
  const loginPath = plan ? `/login?plan=${encodeURIComponent(plan)}` : '/login';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifyScreen, setVerifyScreen] = useState(false);
  // An account with this email already exists (confirmed OR unconfirmed) —
  // route them to login. Unconfirmed users get the confirm-email screen there.
  const [accountExists, setAccountExists] = useState(false);

  // Invite state
  const [invite, setInvite] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(!!inviteToken);
  const [inviteError, setInviteError] = useState('');

  // Validate invite token on mount
  useEffect(() => {
    if (!inviteToken) return;

    async function validateInvite() {
      const { data, error } = await getInviteByToken(inviteToken);

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
    } else if (plan) {
      redirectUrl += `?plan=${encodeURIComponent(plan)}`;
    }
    return redirectUrl;
  }

  function getNormalizedEmail(value = email) {
    return value.trim().toLowerCase();
  }

  async function resendVerificationEmail() {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: getNormalizedEmail(),
      options: {
        emailRedirectTo: buildRedirectUrl(),
      },
    });

    if (error) {
      throw error;
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setErrorMsg('');

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const redirectUrl = buildRedirectUrl();
      const normalizedEmail = getNormalizedEmail();

      const signUpOptions = { emailRedirectTo: redirectUrl };
      if (!inviteToken && plan === 'fiscal-agent') {
        // Persist the plan choice in auth user metadata so it survives
        // navigations that drop the ?plan= query param (login redirect, root
        // redirect, verification link opened elsewhere). The emailRedirectTo
        // query param above stays as belt-and-braces for in-flight users.
        signUpOptions.data = { plan: 'fiscal-agent' };
      }

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: signUpOptions,
      });

      if (error) {
        if (EXISTING_ACCOUNT_ERROR.test(error.message || '')) {
          // Existing account — confirmed or not, send them to log in.
          setAccountExists(true);
          setLoading(false);
          return;
        }

        // Genuinely-new-account failures (weak password, network) keep their real error.
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
        // When Supabase returns a user with an EMPTY identities array, it is an
        // existing-account placeholder (confirmed OR unconfirmed). Product
        // decision: both cases read as "you already have an account" — the
        // login flow shows the confirm-email screen for the unconfirmed case.
        const isExistingAccount =
          Array.isArray(data?.user?.identities) && data.user.identities.length === 0;

        if (isExistingAccount) {
          setAccountExists(true);
        } else {
          setVerifyScreen(true);
        }
      }
    } catch (err) {
      setErrorMsg(err?.message || 'Unexpected error during signup');
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

  // Existing account (confirmed or unconfirmed): send them to login instead of
  // re-signing up. If their email still needs verifying, logging in shows the
  // confirm-email screen; password reset works either way.
  if (accountExists) {
    return (
      <div className="signup">
        <div className="signup-container" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', color: 'var(--color-primary)', marginBottom: '0.5em' }}>
            <FaCheckCircle />
          </div>
          <h2>You Already Have an Account</h2>
          <p style={{ color: '#6b7280', lineHeight: 1.6, marginBottom: '1.5em' }}>
            An account for <strong>{email}</strong> already exists.
            <br />Log in to continue — if your email hasn't been verified yet, we'll
            help you confirm it after you log in. Forgotten your password? You can
            reset it from the login page.
          </p>
          {inviteToken && (
            <p style={{ color: '#6b7280', lineHeight: 1.6, marginBottom: '1.5em' }}>
              Note: invite links can only be redeemed by new accounts. If you already
              have a GrantTrail account, please ask your admin how to proceed.
            </p>
          )}
          <Link to={loginPath} className="fad-btn fad-btn-primary" style={{ display: 'inline-block' }}>
            Log in
          </Link>
        </div>
      </div>
    );
  }

  // Show "check your email" screen after signup when confirmation is required
  if (verifyScreen) {
    return (
      <VerifyEmailNotice
        email={email}
        onResend={resendVerificationEmail}
        onAlreadyConfirmed={() => setAccountExists(true)}
        wrapper="signup"
        note={
          inviteToken ? (
            <p style={{ color: '#6b7280', lineHeight: 1.6, marginBottom: '1.5em' }}>
              Note: invite links can only be redeemed by new accounts. If you already
              have a GrantTrail account, please ask your admin how to proceed.
            </p>
          ) : null
        }
        footer={
          <div className="signup-footer">
            Already have an account?{' '}
            <Link to={loginPath}>Log in or reset your password</Link>.
          </div>
        }
      />
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
        ) : plan === 'fiscal-agent' ? (
          <p className="signup-subtitle">Create your account to list your charity as a Fiscal Agent</p>
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
          Already have an account? <Link to={loginPath}>Log in here</Link>
        </div>
      </div>
    </div>
  );
}

export default SignUp;
