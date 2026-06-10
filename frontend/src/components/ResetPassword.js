import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import '../styles/Login.css';

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const hasRecoveryToken = useMemo(() => {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return hash.includes('type=recovery') || search.includes('type=recovery');
  }, []);

  const recoveryError = useMemo(() => {
    const hash = window.location.hash || '';
    if (hash.includes('error_code=otp_expired')) {
      return 'This reset link has expired or was already used. Please request a new password reset email.';
    }
    if (hash.includes('error=access_denied')) {
      return 'This reset link is not valid. Please request a new password reset email.';
    }
    return '';
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setErrorMsg(error.message || 'Unable to reset password.');
      return;
    }

    setSuccessMsg('Password updated successfully. Redirecting to login...');
    await supabase.auth.signOut();
    setTimeout(() => navigate('/login'), 1200);
  }

  return (
    <div className="login">
      <div className="login-container">
        <h2>Create New Password</h2>
        <p className="login-subtitle">Set a new password for your account.</p>

        {!hasRecoveryToken && !successMsg && (
          <div className="error">
            <span className="error-icon">⚠️</span>
            <span>
              {recoveryError || 'This reset link appears invalid or expired. Request a new password reset from the login page.'}
            </span>
          </div>
        )}

        {successMsg ? (
          <div className="success-message">{successMsg}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="new-password">New Password</label>
              <div className="input-with-icon">
                <span className="input-icon">🔒</span>
                <input
                  id="new-password"
                  type="password"
                  placeholder="Enter new password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  disabled={loading || !hasRecoveryToken}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="confirm-password">Confirm Password</label>
              <div className="input-with-icon">
                <span className="input-icon">🔒</span>
                <input
                  id="confirm-password"
                  type="password"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading || !hasRecoveryToken}
                />
              </div>
            </div>

            {errorMsg && (
              <div className="error">
                <span className="error-icon">⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <button type="submit" disabled={loading || !hasRecoveryToken}>
              {loading && <span className="button-spinner"></span>}
              <span>{loading ? 'Updating password...' : 'Update Password'}</span>
            </button>
          </form>
        )}

        <div className="login-footer">
          <Link to="/login">Back to login</Link>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
