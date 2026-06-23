import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FaSearch,
  FaMapMarkerAlt,
  FaCheckCircle,
  FaLock,
  FaSeedling,
  FaHandshake,
  FaBuilding,
  FaArrowRight,
  FaStar,
  FaRegStar,
  FaFilter,
  FaEnvelope,
  FaTimes,
  FaRegBookmark,
  FaBookmark,
  FaGlobe,
  FaPhone,
  FaRegClock,
  FaCheck,
  FaChevronLeft,
  FaChevronRight,
  FaShieldAlt,
  FaUsers,
} from 'react-icons/fa';
import SponsorshipApplicationModal from './SponsorshipApplicationModal';
import FiscalAgentInbox from './FiscalAgentInbox';
import './FiscalAgentDirectory.css';

/*
  MOCKUP — Fiscal Agent Listing (Subscription-Based Charity Profiles)
  -------------------------------------------------------------------
  Frontend-only mock for design feedback. No backend wiring; all actions
  update local state and show toasts so the flows feel real.

  Two paywalled subscriptions are represented:
    1. A charity pays the pay-first Fiscal Agent subscription to APPEAR here
       (the "List your charity" flow + owned listing card).
    2. An organization pays a Directory Access subscription to VIEW the full
       list (the paywall gate). "Subscribe" unlocks it in the mock.

  The "View as" switcher only exists in the mockup so reviewers can flip
  between states without auth/billing.
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

const SORTS = [
  { id: 'rating', label: 'Top rated' },
  { id: 'sponsored', label: 'Most projects' },
  { id: 'feeLow', label: 'Lowest fee' },
  { id: 'name', label: 'Name (A–Z)' },
];

const AGENTS = [
  {
    id: 'a1',
    name: 'Cedar Roots Foundation',
    location: 'Portland, OR',
    region: 'West',
    verified: true,
    rating: 4.9,
    reviews: 34,
    sponsored: 12,
    assetsManaged: '$4.2M',
    feeNum: 7,
    founded: 2014,
    website: 'cedarroots.org',
    email: 'partnerships@cedarroots.org',
    phone: '(503) 555-0142',
    responseTime: '~1 business day',
    accepting: true,
    focus: ['Environment', 'Community', 'Food Security'],
    blurb:
      'Full-service fiscal sponsorship for grassroots environmental and food-justice projects.',
    about:
      'Cedar Roots Foundation has provided comprehensive fiscal sponsorship since 2014, specializing in grassroots environmental and food-justice work across the Pacific Northwest. We handle grants administration, monthly financial reporting, and compliance so project leaders can focus on impact.',
    services: ['Grants administration', 'Monthly reporting', 'Dedicated liaison', 'Compliance & audit support'],
    projects: ['Willamette River Cleanup Coalition', 'Eastside Community Fridges', 'Cascade Seed Library'],
  },
  {
    id: 'a2',
    name: 'Bright Avenue Collective',
    location: 'Austin, TX',
    region: 'South',
    verified: true,
    rating: 4.7,
    reviews: 51,
    sponsored: 28,
    assetsManaged: '$9.8M',
    feeNum: 8,
    founded: 2009,
    website: 'brightavenue.org',
    email: 'hello@brightavenue.org',
    phone: '(512) 555-0188',
    responseTime: '~2 business days',
    accepting: true,
    focus: ['Arts & Culture', 'Youth', 'Education'],
    blurb: 'Established 501(c)(3) sponsoring arts and youth education initiatives across the Southwest.',
    about:
      'Bright Avenue Collective sponsors arts and youth-education initiatives across the Southwest. With onboarding in under two weeks and a hands-on grants team, we are a frequent partner for first-time program leads and established festivals alike.',
    services: ['Fast onboarding (<2 weeks)', 'Payroll for project staff', 'Donor receipting', 'Quarterly reviews'],
    projects: ['South Austin Mural Project', 'Code & Canvas After-School', 'Teen Film Lab'],
  },
  {
    id: 'a3',
    name: 'Northwind Community Trust',
    location: 'Minneapolis, MN',
    region: 'Midwest',
    verified: false,
    rating: 4.5,
    reviews: 12,
    sponsored: 6,
    assetsManaged: '$1.1M',
    feeNum: 6,
    founded: 2019,
    website: 'northwindtrust.org',
    email: 'grants@northwindtrust.org',
    phone: '(612) 555-0119',
    responseTime: '~3 business days',
    accepting: true,
    focus: ['Housing', 'Health', 'Community'],
    blurb: 'Local trust focused on housing stability and community health pilots.',
    about:
      'Northwind Community Trust is a newer, locally focused sponsor supporting housing-stability and community-health pilots in the Twin Cities. We offer hands-on guidance for first-time grant recipients and a low administrative fee.',
    services: ['Low 6% fee', 'First-timer onboarding', 'Local funder intros', 'Basic reporting'],
    projects: ['Phillips Tenant Union', 'Northside Wellness Pop-ups'],
  },
  {
    id: 'a4',
    name: 'Open Harbor Initiative',
    location: 'Boston, MA',
    region: 'Northeast',
    verified: true,
    rating: 4.8,
    reviews: 88,
    sponsored: 41,
    assetsManaged: '$15.3M',
    feeNum: 9,
    founded: 2004,
    website: 'openharbor.org',
    email: 'intake@openharbor.org',
    phone: '(617) 555-0173',
    responseTime: 'Same day',
    accepting: false,
    focus: ['Education', 'Health', 'Youth'],
    blurb: 'Large fiscal sponsor with compliance, payroll, and audit support built in.',
    about:
      'Open Harbor Initiative is one of the largest fiscal sponsors in the Northeast, with full compliance, payroll, and audit infrastructure. Ideal for multi-year, multi-funder programs that need institutional-grade administration.',
    services: ['Full compliance suite', 'Payroll & benefits', 'Annual audit', 'Multi-funder reporting'],
    projects: ['Greater Boston Literacy Network', 'Harborview Youth Clinics', 'STEM Bridges Program'],
  },
  {
    id: 'a5',
    name: 'Prairie Light Fund',
    location: 'Denver, CO',
    region: 'West',
    verified: false,
    rating: 4.4,
    reviews: 9,
    sponsored: 9,
    assetsManaged: '$2.0M',
    feeNum: 7.5,
    founded: 2017,
    website: 'prairielight.org',
    email: 'team@prairielight.org',
    phone: '(303) 555-0150',
    responseTime: '~2 business days',
    accepting: true,
    focus: ['Arts & Culture', 'Environment'],
    blurb: 'Boutique sponsor for emerging arts and conservation work.',
    about:
      'Prairie Light Fund is a boutique sponsor for emerging arts and conservation projects along the Front Range. We offer personalized funder reporting and quarterly check-ins with every sponsored project.',
    services: ['Personalized reporting', 'Quarterly check-ins', 'Grant-writing referrals'],
    projects: ['High Plains Land Trust Pilot', 'RiNo Artist Residency'],
  },
  {
    id: 'a6',
    name: 'Unity Bridge Services',
    location: 'Atlanta, GA',
    region: 'South',
    verified: true,
    rating: 4.6,
    reviews: 27,
    sponsored: 19,
    assetsManaged: '$6.4M',
    feeNum: 8,
    founded: 2012,
    website: 'unitybridge.org',
    email: 'connect@unitybridge.org',
    phone: '(404) 555-0166',
    responseTime: '~1 business day',
    accepting: true,
    focus: ['Community', 'Food Security', 'Housing'],
    blurb: 'Regional sponsor specializing in mutual-aid and food-security networks.',
    about:
      'Unity Bridge Services specializes in mutual-aid and food-security networks across the Southeast. Our bilingual grants-administration team supports community-led programs with culturally responsive reporting.',
    services: ['Bilingual admin team', 'Mutual-aid disbursement', 'Community reporting', 'Rapid intake'],
    projects: ['Westside Food Network', 'Clarkston Newcomer Aid', 'Southside Housing Collective'],
  },
];

const PAGE_SIZE = 4;

// In the mockup the "charity — listing owner" perspective stands in for the
// owner of this one agent listing, so the inbox can be filtered to it.
const OWNER_AGENT_ID = 'a1';

// Seed inquiries so the inbox demos with realistic content. agentIds match
// existing AGENTS; the owner perspective (OWNER_AGENT_ID) only sees its own.
const SAMPLE_INQUIRIES = [
  {
    id: 'inq-1',
    agentId: 'a1',
    status: 'new',
    submittedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    project: {
      name: 'Riverside Pollinator Corridor',
      mission:
        'Restoring native-plant pollinator habitat along three miles of urban riverbank with volunteer crews.',
      focus: 'Environment',
      projectType: 'New project',
      estAnnualBudget: '$25k–$100k',
      fundingSources: 'Individual donors, a pending city micro-grant',
      timeline: 'Within 1 month',
      startDate: '2026-08-01',
    },
    contact: {
      name: 'Maya Okafor',
      email: 'maya@riversidecorridor.org',
      organization: 'Riverside Corridor Project',
      phone: '(503) 555-0110',
    },
    message:
      'We need a fiscal sponsor to receive grant funds and handle reporting while we build out our board. Your environmental focus is a perfect fit.',
  },
  {
    id: 'inq-2',
    agentId: 'a1',
    status: 'reviewing',
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    project: {
      name: 'Eastside Community Fridges',
      mission: 'Operating a network of free, stocked community refrigerators across the east side.',
      focus: 'Food Security',
      projectType: 'Existing program',
      estAnnualBudget: '$100k–$250k',
      fundingSources: 'Recurring donors, in-kind grocery partnerships',
      timeline: 'Ready now',
      startDate: '',
    },
    contact: {
      name: 'Devon Pierce',
      email: 'devon@eastsidefridges.org',
      organization: 'Eastside Mutual Aid',
      phone: '',
    },
    message:
      'We have outgrown our previous sponsor and are looking for a partner who understands mutual-aid disbursement.',
  },
  {
    id: 'inq-3',
    agentId: 'a2',
    status: 'accepted',
    submittedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    project: {
      name: 'Teen Film Lab',
      mission: 'After-school filmmaking workshops for high-school students in underserved districts.',
      focus: 'Youth',
      projectType: 'Ongoing initiative',
      estAnnualBudget: 'Under $25k',
      fundingSources: 'Local arts council grant',
      timeline: '1–3 months',
      startDate: '2026-09-15',
    },
    contact: {
      name: 'Priya Nair',
      email: 'priya@teenfilmlab.org',
      organization: 'Teen Film Lab',
      phone: '(512) 555-0144',
    },
    message: 'Excited to formalize our partnership for the fall cohort.',
  },
];

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function Stars({ rating }) {
  return (
    <span className="fad-rating" aria-label={`${rating} out of 5`}>
      <FaStar /> {rating.toFixed(1)}
    </span>
  );
}

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

function Modal({ onClose, children, labelledBy, wide }) {
  // Close on Escape; lock body scroll while open.
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
        className={`fad-modal ${wide ? 'is-wide' : ''}`}
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

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function AgentCard({ agent, saved, onToggleSave, onOpen, onContact }) {
  return (
    <article className="fad-card">
      <button
        type="button"
        className="fad-save"
        aria-pressed={saved}
        aria-label={saved ? 'Remove from saved' : 'Save agent'}
        onClick={() => onToggleSave(agent.id)}
        title={saved ? 'Saved' : 'Save'}
      >
        {saved ? <FaBookmark /> : <FaRegBookmark />}
      </button>

      <div className="fad-card-head">
        <div className="fad-avatar" aria-hidden="true">
          {agent.name.charAt(0)}
        </div>
        <div className="fad-card-title">
          <h3>
            <button type="button" className="fad-linklike" onClick={() => onOpen(agent)}>
              {agent.name}
            </button>
            {agent.verified && (
              <span className="fad-verified" title="Verified Fiscal Agent">
                <FaCheckCircle />
              </span>
            )}
          </h3>
          <p className="fad-location">
            <FaMapMarkerAlt /> {agent.location}
          </p>
        </div>
        <Stars rating={agent.rating} />
      </div>

      <p className="fad-blurb">{agent.blurb}</p>

      <ul className="fad-tags">
        {agent.focus.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <dl className="fad-stats">
        <div>
          <dt>Sponsored</dt>
          <dd>{agent.sponsored}</dd>
        </div>
        <div>
          <dt>Assets</dt>
          <dd>{agent.assetsManaged}</dd>
        </div>
        <div>
          <dt>Admin fee</dt>
          <dd>{agent.feeNum}%</dd>
        </div>
      </dl>

      <div className="fad-card-meta">
        {agent.accepting ? (
          <span className="fad-badge fad-badge-ok">
            <FaCheck /> Accepting projects
          </span>
        ) : (
          <span className="fad-badge fad-badge-muted">Waitlist only</span>
        )}
        <span className="fad-meta-time">
          <FaRegClock /> {agent.responseTime}
        </span>
      </div>

      <div className="fad-card-foot">
        <button type="button" className="fad-btn fad-btn-ghost" onClick={() => onContact(agent)}>
          <FaEnvelope /> Contact
        </button>
        <button type="button" className="fad-btn fad-btn-primary" onClick={() => onOpen(agent)}>
          View profile <FaArrowRight />
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Profile detail modal                                                */
/* ------------------------------------------------------------------ */

function ProfileModal({ agent, saved, onToggleSave, onClose, onContact }) {
  return (
    <Modal onClose={onClose} labelledBy="fad-profile-name" wide>
      <div className="fad-profile">
        <div className="fad-profile-head">
          <div className="fad-avatar fad-avatar-lg" aria-hidden="true">
            {agent.name.charAt(0)}
          </div>
          <div className="fad-profile-headtext">
            <h2 id="fad-profile-name">
              {agent.name}
              {agent.verified && (
                <span className="fad-verified" title="Verified Fiscal Agent">
                  <FaCheckCircle />
                </span>
              )}
            </h2>
            <p className="fad-location">
              <FaMapMarkerAlt /> {agent.location} · Est. {agent.founded}
            </p>
            <div className="fad-profile-badges">
              <Stars rating={agent.rating} />
              <span className="fad-reviews">{agent.reviews} reviews</span>
              {agent.accepting ? (
                <span className="fad-badge fad-badge-ok">
                  <FaCheck /> Accepting projects
                </span>
              ) : (
                <span className="fad-badge fad-badge-muted">Waitlist only</span>
              )}
            </div>
          </div>
        </div>

        <div className="fad-profile-grid">
          <div className="fad-profile-main">
            <h4>About</h4>
            <p>{agent.about}</p>

            <h4>Services</h4>
            <ul className="fad-checklist">
              {agent.services.map((s) => (
                <li key={s}>
                  <FaCheckCircle /> {s}
                </li>
              ))}
            </ul>

            <h4>Recently sponsored projects</h4>
            <ul className="fad-projects">
              {agent.projects.map((p) => (
                <li key={p}>
                  <FaSeedling /> {p}
                </li>
              ))}
            </ul>

            <ul className="fad-tags">
              {agent.focus.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          <aside className="fad-profile-side">
            <dl className="fad-sidestats">
              <div>
                <dt>Projects sponsored</dt>
                <dd>{agent.sponsored}</dd>
              </div>
              <div>
                <dt>Assets managed</dt>
                <dd>{agent.assetsManaged}</dd>
              </div>
              <div>
                <dt>Admin fee</dt>
                <dd>{agent.feeNum}%</dd>
              </div>
              <div>
                <dt>Typical response</dt>
                <dd>{agent.responseTime}</dd>
              </div>
            </dl>

            <div className="fad-contactlines">
              <a href={`https://${agent.website}`} onClick={(e) => e.preventDefault()}>
                <FaGlobe /> {agent.website}
              </a>
              <a href={`mailto:${agent.email}`} onClick={(e) => e.preventDefault()}>
                <FaEnvelope /> {agent.email}
              </a>
              <span>
                <FaPhone /> {agent.phone}
              </span>
            </div>

            <button type="button" className="fad-btn fad-btn-primary fad-btn-block" onClick={() => onContact(agent)}>
              <FaHandshake /> Request partnership
            </button>
            <button
              type="button"
              className="fad-btn fad-btn-ghost fad-btn-block"
              onClick={() => onToggleSave(agent.id)}
            >
              {saved ? <FaBookmark /> : <FaRegBookmark />} {saved ? 'Saved' : 'Save for later'}
            </button>
          </aside>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* "List your charity" — multi-step flow                               */
/* ------------------------------------------------------------------ */

const LISTING_STEPS = ['Organization', 'Profile', 'Subscribe'];

function ListingFormModal({ onClose, onPublished }) {
  const [step, setStep] = useState(0);
  const [working, setWorking] = useState(false);
  const [data, setData] = useState({
    name: '',
    location: '',
    ein: '',
    focus: [],
    fee: '',
    blurb: '',
    plan: 'monthly',
  });

  function toggleFocus(f) {
    setData((d) => ({
      ...d,
      focus: d.focus.includes(f) ? d.focus.filter((x) => x !== f) : [...d.focus, f],
    }));
  }

  const stepValid =
    step === 0
      ? data.name && data.location && data.ein
      : step === 1
        ? data.focus.length > 0 && data.blurb
        : true;

  function next() {
    if (step < LISTING_STEPS.length - 1) setStep(step + 1);
  }

  function publish() {
    setWorking(true);
    // Simulate pay-first checkout + provisioning.
    setTimeout(() => {
      setWorking(false);
      onPublished(data);
    }, 900);
  }

  return (
    <Modal onClose={onClose} labelledBy="fad-listing-title" wide>
      <h2 id="fad-listing-title" className="fad-modal-title">
        List your charity as a Fiscal Agent
      </h2>

      <ol className="fad-steps">
        {LISTING_STEPS.map((label, i) => (
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
          <p className="fad-hint">
            <FaShieldAlt /> We verify 501(c)(3) status before your listing goes live.
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
            Choose a Fiscal Agent subscription to publish your listing. Pay first — you’ll
            get an admin sign-in link right after checkout.
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
        {step < LISTING_STEPS.length - 1 ? (
          <button type="button" className="fad-btn fad-btn-primary" disabled={!stepValid} onClick={next}>
            Continue <FaChevronRight />
          </button>
        ) : (
          <button type="button" className="fad-btn fad-btn-gold" disabled={working} onClick={publish}>
            {working ? 'Processing…' : 'Pay & publish listing'}
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

function Toast({ toast, onDone }) {
  const timer = useRef(null);
  useEffect(() => {
    if (!toast) return undefined;
    timer.current = setTimeout(onDone, 3200);
    return () => clearTimeout(timer.current);
  }, [toast, onDone]);

  if (!toast) return null;
  return (
    <div className={`fad-toast fad-toast-${toast.kind || 'ok'}`} role="status">
      <FaCheckCircle /> {toast.msg}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function FiscalAgentDirectory() {
  // Mockup-only perspective switcher. 'org' subscribers and 'charity' owners
  // both see the full directory; 'locked' sees the paywall.
  const [viewAs, setViewAs] = useState('locked'); // 'locked' | 'org' | 'charity'

  const [query, setQuery] = useState('');
  const [activeFocus, setActiveFocus] = useState('All');
  const [region, setRegion] = useState('All');
  const [acceptingOnly, setAcceptingOnly] = useState(false);
  const [sort, setSort] = useState('rating');
  const [page, setPage] = useState(1);

  const [saved, setSaved] = useState(() => new Set());
  const [profileAgent, setProfileAgent] = useState(null);
  const [applyAgent, setApplyAgent] = useState(null);
  const [showListing, setShowListing] = useState(false);
  const [myListing, setMyListing] = useState(null);
  const [toast, setToast] = useState(null);

  // In-memory inquiry store — the apply -> inbox loop lives entirely here.
  const [inquiries, setInquiries] = useState(SAMPLE_INQUIRIES);

  const isSubscribed = viewAs !== 'locked';

  const regions = useMemo(() => ['All', ...Array.from(new Set(AGENTS.map((a) => a.region)))], []);

  // Reset pagination whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [query, activeFocus, region, acceptingOnly, sort]);

  const filtered = useMemo(() => {
    const list = AGENTS.filter((a) => {
      const matchesQuery =
        !query ||
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.location.toLowerCase().includes(query.toLowerCase());
      const matchesFocus = activeFocus === 'All' || a.focus.includes(activeFocus);
      const matchesRegion = region === 'All' || a.region === region;
      const matchesAccepting = !acceptingOnly || a.accepting;
      return matchesQuery && matchesFocus && matchesRegion && matchesAccepting;
    });

    const sorted = [...list].sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating;
      if (sort === 'sponsored') return b.sponsored - a.sponsored;
      if (sort === 'feeLow') return a.feeNum - b.feeNum;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [query, activeFocus, region, acceptingOnly, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSave(id) {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setToast({ msg: 'Removed from saved' });
      } else {
        next.add(id);
        setToast({ msg: 'Saved to your shortlist' });
      }
      return next;
    });
  }

  function handleApplicationSubmit(application) {
    const agent = applyAgent;
    const inquiry = {
      id: `inq-${Date.now()}`,
      agentId: agent.id,
      status: 'new',
      submittedAt: new Date().toISOString(),
      ...application,
    };
    setInquiries((prev) => [inquiry, ...prev]);
    setApplyAgent(null);
    setToast({ msg: `Application sent to ${agent.name}` });
  }

  function handleUpdateStatus(inquiryId, nextStatus) {
    setInquiries((prev) =>
      prev.map((q) => (q.id === inquiryId ? { ...q, status: nextStatus } : q)),
    );
  }

  function handleOnboard(inquiry) {
    setToast({ msg: `Onboarding ${inquiry.project.name} as a grantee…` });
  }

  // Inbox for the listing owner — only their agent's applications.
  const ownerInquiries = useMemo(
    () => inquiries.filter((q) => q.agentId === OWNER_AGENT_ID),
    [inquiries],
  );

  function handlePublished(data) {
    setShowListing(false);
    setMyListing(data);
    setViewAs('charity');
    setToast({ msg: 'Your listing is live 🎉' });
  }

  function clearFilters() {
    setQuery('');
    setActiveFocus('All');
    setRegion('All');
    setAcceptingOnly(false);
    setSort('rating');
  }

  const hasFilters =
    query || activeFocus !== 'All' || region !== 'All' || acceptingOnly || sort !== 'rating';

  return (
    <div className="fad-page">
      {/* Mockup banner + perspective switcher (not part of the real product) */}
      <div className="fad-mock-banner">
        <span className="fad-mock-pill">MOCKUP</span>
        <span>Preview perspective:</span>
        <div className="fad-switch">
          <button
            type="button"
            className={viewAs === 'locked' ? 'is-active' : ''}
            onClick={() => setViewAs('locked')}
          >
            Org — not subscribed
          </button>
          <button
            type="button"
            className={viewAs === 'org' ? 'is-active' : ''}
            onClick={() => setViewAs('org')}
          >
            Org — subscribed
          </button>
          <button
            type="button"
            className={viewAs === 'charity' ? 'is-active' : ''}
            onClick={() => setViewAs('charity')}
          >
            Charity — listing owner
          </button>
        </div>
      </div>

      {/* Hero */}
      <section className="fad-hero">
        <span className="fad-hero-topline">
          <FaHandshake /> Fiscal Agent Directory
        </span>
        <h1>Find a charity to act as your Fiscal Agent</h1>
        <p>
          Browse verified 501(c)(3) organizations offering fiscal sponsorship for
          grant-funded projects. Filter by focus area, region, and track record.
        </p>
        <div className="fad-hero-stats">
          <span>
            <strong>{AGENTS.length}</strong> fiscal agents
          </span>
          <span>
            <strong>{AGENTS.filter((a) => a.verified).length}</strong> verified
          </span>
          <span>
            <strong>{AGENTS.reduce((n, a) => n + a.sponsored, 0)}</strong> projects sponsored
          </span>
        </div>
      </section>

      {/* Charity owner banner */}
      {viewAs === 'charity' && (
        <section className="fad-owner-banner">
          <div>
            <strong>{myListing ? myListing.name : 'Your listing'} is live.</strong> Your Fiscal
            Agent subscription keeps you visible to organizations seeking sponsorship.
          </div>
          <button
            type="button"
            className="fad-btn fad-btn-primary"
            onClick={() => setToast({ msg: 'Listing editor would open here' })}
          >
            Edit your listing
          </button>
        </section>
      )}

      {/* Listing owner inbox — receives structured sponsorship applications */}
      {viewAs === 'charity' && (
        <FiscalAgentInbox
          inquiries={ownerInquiries}
          onUpdateStatus={handleUpdateStatus}
          onOnboard={handleOnboard}
        />
      )}

      {/* Toolbar: search + sort */}
      <section className="fad-toolbar">
        <div className="fad-search">
          <FaSearch />
          <input
            type="text"
            placeholder="Search by name or location"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search fiscal agents"
          />
          {query && (
            <button type="button" className="fad-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <FaTimes />
            </button>
          )}
        </div>

        <div className="fad-toolbar-right">
          <label className="fad-select">
            Region
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="fad-select">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`fad-toggle ${acceptingOnly ? 'is-active' : ''}`}
            aria-pressed={acceptingOnly}
            onClick={() => setAcceptingOnly((v) => !v)}
          >
            <FaCheck /> Accepting only
          </button>
        </div>
      </section>

      {/* Focus chips */}
      <section className="fad-chips">
        <span className="fad-chips-label">
          <FaFilter /> Focus
        </span>
        {['All', ...FOCUS_AREAS].map((f) => (
          <button
            key={f}
            type="button"
            className={`fad-chip ${activeFocus === f ? 'is-active' : ''}`}
            onClick={() => setActiveFocus(f)}
          >
            {f}
          </button>
        ))}
      </section>

      <div className="fad-resultbar">
        <p className="fad-count">
          {filtered.length} fiscal {filtered.length === 1 ? 'agent' : 'agents'}
          {activeFocus !== 'All' && ` in ${activeFocus}`}
          {saved.size > 0 && <span className="fad-saved-count"> · {saved.size} saved</span>}
        </p>
        {hasFilters && (
          <button type="button" className="fad-clearlink" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Results — gated for non-subscribers */}
      <div className="fad-results-wrap">
        {visible.length === 0 ? (
          <div className="fad-empty">
            <FaSearch />
            <p>No fiscal agents match your filters.</p>
            <button type="button" className="fad-btn fad-btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <section className={`fad-grid ${!isSubscribed ? 'is-gated' : ''}`} aria-hidden={!isSubscribed}>
            {visible.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                saved={saved.has(a.id)}
                onToggleSave={toggleSave}
                onOpen={setProfileAgent}
                onContact={setApplyAgent}
              />
            ))}
          </section>
        )}

        {!isSubscribed && (
          <div className="fad-paywall" role="dialog" aria-label="Subscription required">
            <div className="fad-paywall-card">
              <span className="fad-paywall-icon">
                <FaLock />
              </span>
              <h2>Subscribe to view the full directory</h2>
              <p>
                Access to the Fiscal Agent directory is included with a Directory Access
                subscription. See contact details, fees, and track records for every verified
                fiscal agent.
              </p>
              <ul className="fad-paywall-list">
                <li>
                  <FaCheckCircle /> Full profiles for {AGENTS.length}+ verified agents
                </li>
                <li>
                  <FaCheckCircle /> Direct contact &amp; partnership requests
                </li>
                <li>
                  <FaCheckCircle /> Filter by focus area, region &amp; fee
                </li>
              </ul>
              <button
                type="button"
                className="fad-btn fad-btn-primary fad-btn-lg"
                onClick={() => {
                  setViewAs('org');
                  setToast({ msg: 'Directory Access unlocked' });
                }}
              >
                Subscribe for access <FaArrowRight />
              </button>
              <p className="fad-paywall-fine">
                Cancel anytime · Billed monthly · <Link to="/subscription">See plans</Link>
              </p>
            </div>
          </div>
        )}

        {/* Pagination (only meaningful when unlocked) */}
        {isSubscribed && filtered.length > PAGE_SIZE && (
          <nav className="fad-pager" aria-label="Pagination">
            <button
              type="button"
              className="fad-btn fad-btn-ghost"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <FaChevronLeft /> Prev
            </button>
            <span className="fad-pager-info">
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              className="fad-btn fad-btn-ghost"
              disabled={page === pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Next <FaChevronRight />
            </button>
          </nav>
        )}
      </div>

      {/* Charity acquisition CTA */}
      {viewAs !== 'charity' && (
        <section className="fad-list-cta">
          <div className="fad-list-cta-inner">
            <span className="fad-list-cta-icon">
              <FaSeedling />
            </span>
            <div className="fad-list-cta-copy">
              <h2>Are you a charity acting as a Fiscal Agent?</h2>
              <p>
                List your organization so funders and projects seeking a fiscal sponsor can find
                you. Subscribe to publish your profile.
              </p>
            </div>
            <button
              type="button"
              className="fad-btn fad-btn-gold fad-btn-lg"
              onClick={() => setShowListing(true)}
            >
              <FaBuilding /> List your charity
            </button>
          </div>
        </section>
      )}

      {/* Trust strip */}
      <section className="fad-trust">
        <div>
          <FaShieldAlt />
          <h3>Verified 501(c)(3)s</h3>
          <p>Every verified badge means we confirmed tax-exempt status.</p>
        </div>
        <div>
          <FaUsers />
          <h3>Real track records</h3>
          <p>Projects sponsored and assets managed are shown up front.</p>
        </div>
        <div>
          <FaHandshake />
          <h3>Direct partnerships</h3>
          <p>Message fiscal agents and start a sponsorship conversation.</p>
        </div>
      </section>

      {/* Modals */}
      {profileAgent && (
        <ProfileModal
          agent={profileAgent}
          saved={saved.has(profileAgent.id)}
          onToggleSave={toggleSave}
          onClose={() => setProfileAgent(null)}
          onContact={(a) => {
            setProfileAgent(null);
            setApplyAgent(a);
          }}
        />
      )}
      {applyAgent && (
        <SponsorshipApplicationModal
          agent={applyAgent}
          onClose={() => setApplyAgent(null)}
          onSubmit={handleApplicationSubmit}
        />
      )}
      {showListing && (
        <ListingFormModal onClose={() => setShowListing(false)} onPublished={handlePublished} />
      )}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
