import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FaCheck,
  FaCheckCircle,
  FaChevronLeft,
  FaChevronRight,
  FaShieldAlt,
  FaArrowLeft,
} from 'react-icons/fa';
import * as Sentry from '@sentry/react';
import { startCheckoutSession, MEMBERSHIP_TIERS } from '../../lib/billing';
import { FOCUS_AREAS, Field } from './fiscalAgentsShared';
import './FiscalAgentDirectory.css';

/*
  Charity intake (pre-pay) — S5, UX §2.1.
  ---------------------------------------
  Pay-FIRST funnel: collect the minimum needed to seed a draft listing (org
  name, location, EIN, focus, blurb, billing email), then redirect to the
  Fiscal Agent Stripe checkout. No account is created here — provisioning
  happens on the webhook after payment. Intake is preserved in sessionStorage so
  a cancelled checkout (S8) can resume without re-typing.
*/

const STEPS = ['Organization', 'Profile', 'Checkout'];
const INTAKE_STORAGE_KEY = 'fa_intake_draft';

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(INTAKE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export default function FiscalAgentListIntake() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(
    () =>
      loadDraft() || {
        name: '',
        location: '',
        ein: '',
        email: '',
        focus: [],
        fee: '',
        blurb: '',
        plan: 'monthly',
      },
  );

  // Preserve intake across a cancelled checkout (S8 resume).
  useEffect(() => {
    try {
      sessionStorage.setItem(INTAKE_STORAGE_KEY, JSON.stringify(data));
    } catch (_error) {
      // Non-fatal: resume-after-cancel simply won't be available.
    }
  }, [data]);

  function toggleFocus(f) {
    setData((d) => ({
      ...d,
      focus: d.focus.includes(f) ? d.focus.filter((x) => x !== f) : [...d.focus, f],
    }));
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const stepValid =
    step === 0
      ? data.name && data.location && data.ein && EMAIL_RE.test(data.email)
      : step === 1
        ? data.focus.length > 0 && data.blurb
        : true;

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
  }

  async function continueToCheckout() {
    setWorking(true);
    setError('');
    try {
      const { url } = await startCheckoutSession({
        membershipTier: MEMBERSHIP_TIERS.FISCAL_AGENT,
        returnPath: '/fiscal-agents/checkout/return?flow=onboarding',
        intake: {
          name: data.name,
          location: data.location,
          ein: data.ein,
          email: data.email,
          focus: data.focus,
          fee_admin_pct: data.fee ? Number(String(data.fee).replace(/[^0-9.]/g, '')) || null : null,
          blurb: data.blurb,
          plan: data.plan,
        },
      });
      window.location.assign(url);
    } catch (err) {
      Sentry.captureException(err);
      setWorking(false);
      setError('Billing is temporarily unavailable — please try again later.');
    }
  }

  return (
    <div className="fad-page">
      <div className="fap-topbar">
        <Link to="/fiscal-agents" className="fap-back">
          <FaArrowLeft /> Back to the directory
        </Link>
      </div>

      <section className="fad-hero">
        <h1>List your charity as a Fiscal Agent</h1>
        <p>
          Tell us about your organization, then choose a Fiscal Agent subscription. You pay first —
          we’ll email a one-time signup link right after checkout so you can finish your listing.
        </p>
      </section>

      <div className="fad-intake">
        <ol className="fad-steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}>
              <span className="fad-step-num">{i < step ? <FaCheck /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="fad-form">
            <Field label="Organization name" required>
              <input
                type="text"
                value={data.name}
                onChange={(e) => setData({ ...data, name: e.target.value })}
                placeholder="Your 501(c)(3) name"
              />
            </Field>
            <Field label="Location" required>
              <input
                type="text"
                value={data.location}
                onChange={(e) => setData({ ...data, location: e.target.value })}
                placeholder="City, State"
              />
            </Field>
            <Field label="EIN (Tax ID)" required>
              <input
                type="text"
                value={data.ein}
                onChange={(e) => setData({ ...data, ein: e.target.value })}
                placeholder="12-3456789"
              />
            </Field>
            <Field label="Billing email" required>
              <input
                type="email"
                value={data.email}
                onChange={(e) => setData({ ...data, email: e.target.value })}
                placeholder="you@yourorg.org"
              />
            </Field>
            <p className="fad-hint">
              <FaShieldAlt /> We verify 501(c)(3) status before your listing goes live. Your signup
              link is sent to this email.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="fad-form">
            <Field label="Focus areas" required>
              <div className="fad-focuspick">
                {FOCUS_AREAS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`fad-chip ${data.focus.includes(f) ? 'is-active' : ''}`}
                    onClick={() => toggleFocus(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Admin fee">
              <input
                type="text"
                value={data.fee}
                onChange={(e) => setData({ ...data, fee: e.target.value })}
                placeholder="e.g. 7%"
              />
            </Field>
            <Field label="Short description" required>
              <textarea
                rows={3}
                value={data.blurb}
                onChange={(e) => setData({ ...data, blurb: e.target.value })}
                placeholder="One or two sentences organizations will see on your card…"
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="fad-plans">
            <p className="fad-modal-sub">
              Choose a Fiscal Agent subscription to publish your listing. Pay first — you’ll get an
              admin sign-in link right after checkout.
            </p>
            <div className="fad-plan-grid">
              <button
                type="button"
                className={`fad-plan ${data.plan === 'monthly' ? 'is-active' : ''}`}
                onClick={() => setData({ ...data, plan: 'monthly' })}
              >
                <span className="fad-plan-name">Monthly</span>
                <span className="fad-plan-price">$49<small>/mo</small></span>
                <span className="fad-plan-note">Cancel anytime</span>
              </button>
              <button
                type="button"
                className={`fad-plan ${data.plan === 'annual' ? 'is-active' : ''}`}
                onClick={() => setData({ ...data, plan: 'annual' })}
              >
                <span className="fad-plan-tag">Save 2 months</span>
                <span className="fad-plan-name">Annual</span>
                <span className="fad-plan-price">$490<small>/yr</small></span>
                <span className="fad-plan-note">Best value</span>
              </button>
            </div>
            <ul className="fad-checklist">
              <li><FaCheckCircle /> Verified listing in the directory</li>
              <li><FaCheckCircle /> Receive partnership requests from organizations</li>
              <li><FaCheckCircle /> Edit your profile anytime</li>
            </ul>
          </div>
        )}

        {error && (
          <div className="subscription-billing-unavailable" role="alert">
            {error}
          </div>
        )}

        <div className="fad-form-foot">
          {step > 0 ? (
            <button type="button" className="fad-btn fad-btn-ghost" onClick={() => setStep(step - 1)}>
              <FaChevronLeft /> Back
            </button>
          ) : (
            <button type="button" className="fad-btn fad-btn-ghost" onClick={() => navigate('/fiscal-agents')}>
              Cancel
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="fad-btn fad-btn-primary" disabled={!stepValid} onClick={next}>
              Continue <FaChevronRight />
            </button>
          ) : (
            <button type="button" className="fad-btn fad-btn-gold" disabled={working} onClick={continueToCheckout}>
              {working ? 'Opening checkout…' : 'Continue to checkout'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { INTAKE_STORAGE_KEY };
