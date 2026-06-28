import React, { useEffect, useRef, useState } from 'react';
import {
  FaTimes,
  FaCheck,
  FaChevronLeft,
  FaChevronRight,
  FaHandshake,
  FaCheckCircle,
} from 'react-icons/fa';
import './SponsorshipApplicationModal.css';

/*
  MOCKUP — Structured sponsorship application
  -------------------------------------------
  Replaces the old free-text ContactModal as the primary "apply / request
  partnership" action. A seeker submits a structured application that lands in
  the agent's inbox (see FiscalAgentInbox). Frontend-only: a simulated ~700ms
  async submit, then onSubmit(application) hands the payload to the parent,
  which assigns id/agentId/status/submittedAt.

  Reuses the directory's `.fad-*` look (modal, fields, stepper, buttons) and
  adds a few application-specific styles under the `sapp-` prefix.
*/

const FOCUS_AREAS = [
  'Education',
  'Arts & Culture',
  'Environment',
  'Health',
  'Youth',
  'Food Security',
  'Housing',
  'Community',
];

const PROJECT_TYPES = [
  'New project',
  'Existing program',
  'One-time event',
  'Ongoing initiative',
  'Research / pilot',
];

const BUDGET_RANGES = [
  'Under $25k',
  '$25k–$100k',
  '$100k–$250k',
  '$250k–$500k',
  '$500k–$1M',
  'Over $1M',
];

const TIMELINES = [
  'Ready now',
  'Within 1 month',
  '1–3 months',
  '3–6 months',
  'Just exploring',
];

const STEPS = ['Project', 'Contact', 'Review'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Field({ label, children, required }) {
  return (
    <label className="fad-field">
      <span className="fad-field-label">
        {label}
        {required && <em> *</em>}
      </span>
      {children}
    </label>
  );
}

/* Local copy of the directory Modal so this component is self-contained while
   matching the shared `.fad-*` look, Escape-to-close, and body scroll-lock. */
function Modal({ onClose, children, labelledBy }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fad-overlay" onMouseDown={onClose}>
      <div
        className="fad-modal is-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="fad-modal-close" onClick={onClose} aria-label="Close">
          <FaTimes />
        </button>
        {children}
      </div>
    </div>
  );
}

export default function SponsorshipApplicationModal({ agent, onClose, onSubmit }) {
  const [step, setStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [project, setProject] = useState({
    name: '',
    mission: '',
    focus: agent.focus && agent.focus[0] ? agent.focus[0] : FOCUS_AREAS[0],
    projectType: PROJECT_TYPES[0],
    estAnnualBudget: '',
    fundingSources: '',
    timeline: TIMELINES[0],
    startDate: '',
  });
  const [contact, setContact] = useState({
    name: '',
    email: '',
    organization: '',
    phone: '',
  });
  const [message, setMessage] = useState('');

  const firstFieldRef = useRef(null);

  // Focus the first field on mount and whenever the step changes.
  useEffect(() => {
    if (firstFieldRef.current) firstFieldRef.current.focus();
  }, [step]);

  const projectValid = project.name && project.mission && project.estAnnualBudget;
  const contactValid = contact.name && EMAIL_RE.test(contact.email);
  const allValid = projectValid && contactValid;

  const stepValid = step === 0 ? projectValid : step === 1 ? contactValid : allValid;

  function next() {
    if (step < STEPS.length - 1) setStep(step + 1);
  }

  async function submit() {
    if (!allValid || sending) return;
    setSending(true);
    setError('');
    try {
      await onSubmit({
        project: {
          name: project.name,
          mission: project.mission,
          focus: project.focus,
          projectType: project.projectType,
          estAnnualBudget: project.estAnnualBudget,
          fundingSources: project.fundingSources,
          timeline: project.timeline,
          startDate: project.startDate,
        },
        contact: {
          name: contact.name,
          email: contact.email,
          organization: contact.organization,
          phone: contact.phone,
        },
        message,
      });
      setSubmitted(true);
    } catch (_err) {
      setError('Could not send your application. Please try again.');
    } finally {
      setSending(false);
    }
  }

  // Clear in-app confirmation: once the inquiry is saved, replace the form with a
  // success panel so the seeker has unambiguous feedback that it went through.
  if (submitted) {
    return (
      <Modal onClose={onClose} labelledBy="sapp-title">
        <div className="sapp-success">
          <div className="sapp-success-icon" aria-hidden="true">
            <FaCheckCircle />
          </div>
          <h2 id="sapp-title" className="fad-modal-title">
            Application sent to {agent.name}
          </h2>
          <p className="fad-modal-sub">
            Your application is now in {agent.name}'s inbox, and we've emailed them a
            notification.{agent.responseTime ? ` They typically respond ${agent.responseTime}.` : ''}{' '}
            Keep an eye on the inbox you provided for their reply.
          </p>
          <div className="fad-form-foot sapp-success-foot">
            <button type="button" className="fad-btn fad-btn-primary" onClick={onClose}>
              <FaCheck /> Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} labelledBy="sapp-title">
      <h2 id="sapp-title" className="fad-modal-title">
        Apply for sponsorship with {agent.name}
      </h2>
      <p className="fad-modal-sub">
        Send a structured application. Typical response: {agent.responseTime}.
      </p>

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
          <Field label="Project name" required>
            <input
              ref={firstFieldRef}
              type="text"
              value={project.name}
              onChange={(e) => setProject({ ...project, name: e.target.value })}
              placeholder="e.g. Riverside Youth Mentorship"
            />
          </Field>
          <Field label="Mission / what you do" required>
            <textarea
              rows={3}
              value={project.mission}
              onChange={(e) => setProject({ ...project, mission: e.target.value })}
              placeholder="A sentence or two about your project's purpose and impact…"
            />
          </Field>
          <div className="sapp-row">
            <Field label="Focus area">
              <select
                value={project.focus}
                onChange={(e) => setProject({ ...project, focus: e.target.value })}
              >
                {FOCUS_AREAS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project type">
              <select
                value={project.projectType}
                onChange={(e) => setProject({ ...project, projectType: e.target.value })}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sapp-row">
            <Field label="Est. annual budget" required>
              <select
                value={project.estAnnualBudget}
                onChange={(e) => setProject({ ...project, estAnnualBudget: e.target.value })}
              >
                <option value="">Select a range…</option>
                {BUDGET_RANGES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Timeline">
              <select
                value={project.timeline}
                onChange={(e) => setProject({ ...project, timeline: e.target.value })}
              >
                {TIMELINES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sapp-row">
            <Field label="Current funding sources">
              <input
                type="text"
                value={project.fundingSources}
                onChange={(e) => setProject({ ...project, fundingSources: e.target.value })}
                placeholder="e.g. Individual donors, a pending grant"
              />
            </Field>
            <Field label="Target start date">
              <input
                type="date"
                value={project.startDate}
                onChange={(e) => setProject({ ...project, startDate: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="fad-form">
          <Field label="Your name" required>
            <input
              ref={firstFieldRef}
              type="text"
              value={contact.name}
              onChange={(e) => setContact({ ...contact, name: e.target.value })}
              placeholder="Jane Rivera"
            />
          </Field>
          <Field label="Contact email" required>
            <input
              type="email"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
              placeholder="you@project.org"
            />
            {contact.email && !EMAIL_RE.test(contact.email) && (
              <span className="sapp-error">Enter a valid email address.</span>
            )}
          </Field>
          <div className="sapp-row">
            <Field label="Organization">
              <input
                type="text"
                value={contact.organization}
                onChange={(e) => setContact({ ...contact, organization: e.target.value })}
                placeholder="Optional"
              />
            </Field>
            <Field label="Phone">
              <input
                type="tel"
                value={contact.phone}
                onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                placeholder="Optional"
              />
            </Field>
          </div>
          <Field label="Message to the fiscal agent">
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Anything else they should know about your project or what you need from a fiscal sponsor…"
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="sapp-review">
          <p className="fad-modal-sub">
            Review your application before sending it to {agent.name}.
          </p>

          <h4 className="sapp-review-head">Project</h4>
          <dl className="sapp-review-list">
            <div>
              <dt>Project</dt>
              <dd>{project.name}</dd>
            </div>
            <div>
              <dt>Mission</dt>
              <dd>{project.mission}</dd>
            </div>
            <div>
              <dt>Focus</dt>
              <dd>{project.focus}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{project.projectType}</dd>
            </div>
            <div>
              <dt>Est. budget</dt>
              <dd>{project.estAnnualBudget}</dd>
            </div>
            <div>
              <dt>Timeline</dt>
              <dd>{project.timeline}</dd>
            </div>
            {project.fundingSources && (
              <div>
                <dt>Funding sources</dt>
                <dd>{project.fundingSources}</dd>
              </div>
            )}
            {project.startDate && (
              <div>
                <dt>Start date</dt>
                <dd>{project.startDate}</dd>
              </div>
            )}
          </dl>

          <h4 className="sapp-review-head">Contact</h4>
          <dl className="sapp-review-list">
            <div>
              <dt>Name</dt>
              <dd>{contact.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{contact.email}</dd>
            </div>
            {contact.organization && (
              <div>
                <dt>Organization</dt>
                <dd>{contact.organization}</dd>
              </div>
            )}
            {contact.phone && (
              <div>
                <dt>Phone</dt>
                <dd>{contact.phone}</dd>
              </div>
            )}
          </dl>

          {message && (
            <>
              <h4 className="sapp-review-head">Message</h4>
              <p className="sapp-review-message">{message}</p>
            </>
          )}
        </div>
      )}

      {error && step === STEPS.length - 1 && (
        <p className="sapp-error sapp-submit-error" role="alert">
          {error}
        </p>
      )}

      <div className="fad-form-foot">
        {step > 0 ? (
          <button type="button" className="fad-btn fad-btn-ghost" onClick={() => setStep(step - 1)}>
            <FaChevronLeft /> Back
          </button>
        ) : (
          <button type="button" className="fad-btn fad-btn-ghost" onClick={onClose}>
            Cancel
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" className="fad-btn fad-btn-primary" disabled={!stepValid} onClick={next}>
            Continue <FaChevronRight />
          </button>
        ) : (
          <button
            type="button"
            className="fad-btn fad-btn-primary"
            disabled={!allValid || sending}
            onClick={submit}
          >
            {sending ? (
              'Sending…'
            ) : (
              <>
                <FaHandshake /> Send application
              </>
            )}
          </button>
        )}
      </div>

      <p className="sapp-foot-note">
        <FaCheckCircle /> Your application goes straight to the agent's inbox.
      </p>
    </Modal>
  );
}
