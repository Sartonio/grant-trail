import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  FaMapMarkerAlt,
  FaCheckCircle,
  FaSeedling,
  FaHandshake,
  FaArrowLeft,
  FaStar,
  FaEnvelope,
  FaGlobe,
  FaPhone,
  FaRegClock,
  FaRegBookmark,
  FaBookmark,
  FaLayerGroup,
  FaShieldAlt,
  FaMoneyBillWave,
  FaMapSigns,
} from 'react-icons/fa';
import { getAgentById } from './fiscalAgents.data';
import './FiscalAgentProfile.css';

/*
  MOCKUP — Fiscal Agent public profile PAGE
  -----------------------------------------
  Frontend-only, shareable standalone page for route /fiscal-agents/:id.
  No backend wiring; the CTA buttons are no-ops that show an inline
  confirmation so the flow feels real.

  Reuses the directory's `fad-` design language for shared elements
  (avatar, badges, checklist, tags, contact lines) and adds page-layout
  styles under the `fap-` prefix.
*/

function Stars({ rating }) {
  return (
    <span className="fad-rating" aria-label={`${rating} out of 5`}>
      <FaStar /> {rating.toFixed(1)}
    </span>
  );
}

export default function FiscalAgentProfile() {
  const { id } = useParams();
  const agent = getAgentById(id);

  // Local-only mock state: a "Save" toggle and an inline confirmation banner
  // shown after Apply/Save. No network calls.
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState(null);

  // Friendly not-found state for unknown / mistyped ids.
  if (!agent) {
    return (
      <div className="fap-page">
        <div className="fap-notfound">
          <h1>Agent not found</h1>
          <p>
            We couldn’t find a fiscal agent with that link. It may have been
            removed, or the address may be mistyped.
          </p>
          <Link to="/fiscal-agents" className="fad-btn fad-btn-primary">
            <FaArrowLeft /> Back to the directory
          </Link>
        </div>
      </div>
    );
  }

  function handleApply() {
    // TODO: this will open the <SponsorshipApplicationModal /> from a parallel
    // PR. For now it's a no-op that surfaces an inline confirmation.
    setNotice({
      kind: 'apply',
      msg: `Sponsorship application for ${agent.name} would open here.`,
    });
  }

  function handleSave() {
    setSaved((prev) => !prev);
    setNotice({
      kind: 'save',
      msg: saved ? 'Removed from saved.' : `Saved ${agent.name} to your shortlist.`,
    });
  }

  const { eligibility, feeStructure } = agent;

  return (
    <div className="fap-page">
      <div className="fap-topbar">
        <Link to="/fiscal-agents" className="fap-back">
          <FaArrowLeft /> Back to all fiscal agents
        </Link>
        <span className="fap-mock-pill">MOCKUP</span>
      </div>

      {/* Header */}
      <header className="fap-header">
        <div className="fad-avatar fad-avatar-lg" aria-hidden="true">
          {agent.name.charAt(0)}
        </div>
        <div className="fap-header-text">
          <h1>
            {agent.name}
            {agent.verified && (
              <span className="fad-verified" title="Verified Fiscal Agent">
                <FaCheckCircle />
              </span>
            )}
          </h1>
          <p className="fad-location">
            <FaMapMarkerAlt /> {agent.location} · Est. {agent.founded}
          </p>
          <div className="fad-profile-badges">
            <Stars rating={agent.rating} />
            <span className="fad-reviews">{agent.reviews} reviews</span>
            {agent.accepting ? (
              <span className="fad-badge fad-badge-ok">
                <FaCheckCircle /> Accepting projects
              </span>
            ) : (
              <span className="fad-badge fad-badge-muted">Waitlist only</span>
            )}
          </div>
        </div>
      </header>

      <div className="fap-layout">
        <main className="fap-main">
          <section className="fap-section">
            <h2>About</h2>
            <p className="fap-prose">{agent.about}</p>
          </section>

          {/* Decision fields — surfaced prominently for sponsorship seekers */}
          <section className="fap-section">
            <h2>How sponsorship works here</h2>
            <div className="fap-decision-grid">
              <div className="fap-decision-card">
                <span className="fap-decision-icon">
                  <FaLayerGroup />
                </span>
                <h3>Sponsorship model</h3>
                <p className="fap-decision-value">{agent.model}</p>
                <p className="fap-decision-note">
                  {agent.model.startsWith('Model A')
                    ? 'Your project operates under the sponsor’s 501(c)(3); they handle administration, payroll, and compliance directly.'
                    : 'Your project stays a separate legal entity and receives regranted funds against an approved budget.'}
                </p>
              </div>

              <div className="fap-decision-card">
                <span className="fap-decision-icon">
                  <FaMoneyBillWave />
                </span>
                <h3>Fee structure</h3>
                <dl className="fap-fee">
                  <div>
                    <dt>Admin fee</dt>
                    <dd>{feeStructure.adminPct}%</dd>
                  </div>
                  <div>
                    <dt>Setup fee</dt>
                    <dd>{feeStructure.setupFee}</dd>
                  </div>
                  <div>
                    <dt>Annual minimum</dt>
                    <dd>{feeStructure.minimumAnnual}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section className="fap-section">
            <h2>Eligibility</h2>
            <div className="fap-elig-grid">
              <div className="fap-elig-block">
                <h3>
                  <FaMapSigns /> Geographies served
                </h3>
                <ul className="fad-tags">
                  {eligibility.geographies.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
              <div className="fap-elig-block">
                <h3>
                  <FaSeedling /> Project types
                </h3>
                <ul className="fad-tags">
                  {eligibility.projectTypes.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="fap-elig-501c3">
              <FaShieldAlt />{' '}
              {eligibility.requires501c3
                ? 'Requires your project to have its own 501(c)(3) status.'
                : 'No 501(c)(3) of your own required — sponsorship covers your tax-exempt status.'}
            </p>
            {eligibility.notes && <p className="fap-prose fap-elig-notes">{eligibility.notes}</p>}
          </section>

          <section className="fap-section">
            <h2>Services</h2>
            <ul className="fad-checklist">
              {agent.services.map((s) => (
                <li key={s}>
                  <FaCheckCircle /> {s}
                </li>
              ))}
            </ul>
          </section>

          <section className="fap-section">
            <h2>Recently sponsored projects</h2>
            <ul className="fad-projects">
              {agent.projects.map((p) => (
                <li key={p}>
                  <FaSeedling /> {p}
                </li>
              ))}
            </ul>
          </section>

          <section className="fap-section">
            <h2>Focus areas</h2>
            <ul className="fad-tags">
              {agent.focus.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        </main>

        {/* Sticky CTA / quick facts sidebar */}
        <aside className="fap-side">
          <div className="fap-side-sticky">
            {notice && (
              <div className={`fap-notice fap-notice-${notice.kind}`} role="status">
                <FaCheckCircle /> {notice.msg}
              </div>
            )}

            <dl className="fad-sidestats">
              <div>
                <dt>Model</dt>
                <dd>{agent.model.startsWith('Model A') ? 'Model A' : 'Model C'}</dd>
              </div>
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
              <span>
                <FaRegClock /> {agent.responseTime}
              </span>
            </div>

            <button
              type="button"
              className="fad-btn fad-btn-primary fad-btn-block"
              onClick={handleApply}
            >
              <FaHandshake /> Apply for fiscal sponsorship
            </button>
            <button
              type="button"
              className="fad-btn fad-btn-ghost fad-btn-block"
              aria-pressed={saved}
              onClick={handleSave}
            >
              {saved ? <FaBookmark /> : <FaRegBookmark />} {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
