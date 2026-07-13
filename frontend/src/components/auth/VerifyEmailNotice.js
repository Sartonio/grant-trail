// src/components/auth/VerifyEmailNotice.js
// The shared "Check Your Email" screen shown when an account still needs its
// email verified — after a fresh signup AND when an unconfirmed user tries to
// log in. Owns the resend button, its cooldown, and friendly error mapping so
// both entry points behave identically.
import React, { useEffect, useState } from 'react';
import { FaCheckCircle } from 'react-icons/fa';
import '../../styles/Login.css';

export const RESEND_COOLDOWN_SECONDS = 15;

// Rate-limit shapes from supabase.auth.resend (429s / "security purposes" copy).
const RATE_LIMIT_ERROR = /rate limit|too many|security purposes/i;

// resend({type:'signup'}) fails with this when the account's email is already
// verified — the account no longer needs this screen at all.
export const CONFIRMED_ACCOUNT_ERROR = /already (been )?confirmed/i;

function isRateLimitError(err) {
  return err?.status === 429 || RATE_LIMIT_ERROR.test(err?.message || '');
}

/**
 * @param {object} props
 * @param {string} props.email - address the verification link was/will be sent to
 * @param {() => Promise<void>} props.onResend - sends a fresh verification email; throws on failure
 * @param {() => void} [props.onAlreadyConfirmed] - called when resend reports the email is already verified
 * @param {'signup'|'login'} [props.wrapper] - which page chrome (CSS classes) to render in
 * @param {React.ReactNode} [props.note] - optional extra paragraph (e.g. invite caveat)
 * @param {React.ReactNode} [props.footer] - footer content below the resend button
 */
function VerifyEmailNotice({
  email,
  onResend,
  onAlreadyConfirmed,
  wrapper = 'signup',
  note = null,
  footer = null,
}) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [loading, setLoading] = useState(false);
  const [infoMsg, setInfoMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleResend() {
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);

    try {
      await onResend();
      setInfoMsg('We sent a fresh verification link to your email address.');
    } catch (err) {
      // Never surface raw auth errors; keep messaging friendly.
      if (CONFIRMED_ACCOUNT_ERROR.test(err?.message || '') && onAlreadyConfirmed) {
        onAlreadyConfirmed();
      } else if (isRateLimitError(err)) {
        setErrorMsg('Please wait a moment before requesting another email.');
      } else {
        setErrorMsg('Unable to resend verification email. Please try again shortly.');
      }
    } finally {
      setLoading(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }

  return (
    <div className={wrapper}>
      <div className={`${wrapper}-container`} style={{ textAlign: 'center' }}>
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
        {note}
        <button
          type="button"
          onClick={handleResend}
          disabled={loading || cooldown > 0}
        >
          <span>
            {cooldown > 0
              ? `Resend available in ${cooldown}s`
              : loading
                ? 'Sending link…'
                : 'Resend verification email'}
          </span>
        </button>
        {footer}
      </div>
    </div>
  );
}

export default VerifyEmailNotice;
