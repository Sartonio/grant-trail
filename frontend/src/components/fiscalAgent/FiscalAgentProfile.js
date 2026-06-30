import React, { useEffect, useState } from 'react';
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
  FaLock,
  FaShieldAlt,
  FaMoneyBillWave,
  FaArrowRight,
} from 'react-icons/fa';
import * as Sentry from '@sentry/react';
import { supabase } from '../../supabaseClient';
import { canViewDirectory } from '../../lib/policy';
import { startCheckoutSession, MEMBERSHIP_TIERS } from '../../lib/billing';
import { mapTeaserListing, mapFullListing } from './fiscalAgents.map';
import { isNewListing, NewBadge } from './fiscalAgentsShared';
import SponsorshipApplicationModal from './SponsorshipApplicationModal';
import { notifyInquirySubmitted } from '../../lib/inquiries';
import './FiscalAgentProfile.css';

/*
  Fiscal Agent public profile PAGE — S3 (teaser) / S4 (full), UX §2.3.
  --------------------------------------------------------------------
  Shareable standalone route /fiscal-agents/:id. The teaser/full split is driven
  by canViewDirectory(session): locked visitors see name, location, verified
  badge, focus, and blurb (from the public view only — contact/fee data is never
  fetched), with a "Subscribe to contact" CTA. Subscribed seekers fetch the full
  row and get working contact lines + the application modal.
*/

function Stars({ rating }) {
  const value = typeof rating === 'number' ? rating : 0;
  return (
    <span className="fad-rating" aria-label={`${value} out of 5`}>
      <FaStar /> {value.toFixed(1)}
    </span>
  );
}

export default function FiscalAgentProfile({ session }) {
  const { id } = useParams();
  const subscribed = canViewDirectory(session);

  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        if (subscribed) {
          const { data, error } = await supabase
            .from('fiscal_agent_listings')
            .select('*')
            .eq('id', Number(id))
            .maybeSingle();
          if (error) throw error;
          if (!cancelled) setAgent(data ? mapFullListing(data) : null);
        } else {
          const { data, error } = await supabase
            .from('fiscal_agent_listings_public')
            .select('*')
            .eq('id', Number(id))
            .maybeSingle();
          if (error) throw error;
          if (!cancelled) setAgent(data ? mapTeaserListing(data) : null);
        }
      } catch (err) {
        Sentry.captureException(err);
        if (!cancelled) setAgent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, subscribed]);

  async function handleSubscribe() {
    setCheckoutBusy(true);
    try {
      const { url } = await startCheckoutSession({
        membershipTier: MEMBERSHIP_TIERS.BASIC,
        returnPath: '/fiscal-agents/checkout/return',
      });
      window.location.assign(url);
    } catch (err) {
      Sentry.captureException(err);
      setCheckoutBusy(false);
      setNotice({ kind: 'apply', msg: 'Billing is temporarily unavailable — please try again later.' });
    }
  }

  // Throws on insert failure so the modal can surface an inline error and let the
  // seeker retry; on success the modal shows its own confirmation panel and stays
  // open until dismissed, so we don't close it here.
  async function handleApplicationSubmit(application) {
    const { data, error } = await supabase
      .from('sponsorship_inquiries')
      .insert({
        listing_id: Number(agent.id),
        project: application.project,
        contact: application.contact,
        message: application.message,
      })
      .select('id')
      .single();
    if (error) {
      Sentry.captureException(error);
      throw error;
    }
    // Notify the charity by email — best effort. The inquiry is already saved, so
    // a notification failure must never block the seeker's confirmation.
    notifyInquirySubmitted(data.id).catch((err) => Sentry.captureException(err));
  }

  function handleSave() {
    setSaved((prev) => !prev);
    setNotice({
      kind: 'save',
      msg: saved ? 'Removed from saved.' : `Saved ${agent.name} to your shortlist.`,
    });
  }

  if (loading) {
    return (
      <div className="fap-page">
        <p>Loading…</p>
      </div>
    );
  }

  // Friendly not-found state (also covers a listing pulled for lapse/verification).
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

  return (
    <div className="fap-page">
      <div className="fap-topbar">
        <Link to="/fiscal-agents" className="fap-back">
          <FaArrowLeft /> Back to all fiscal agents
        </Link>
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
            <FaMapMarkerAlt /> {agent.location}
          </p>
          <div className="fad-profile-badges">
            {isNewListing(agent) ? (
              <NewBadge />
            ) : (
              <>
                <Stars rating={agent.rating} />
                <span className="fad-reviews">{agent.reviews} reviews</span>
              </>
            )}
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
            <h2>Overview</h2>
            <p className="fap-prose">{agent.blurb}</p>
          </section>

          {subscribed ? (
            <>
              {agent.about && (
                <section className="fap-section">
                  <h2>About</h2>
                  <p className="fap-prose">{agent.about}</p>
                </section>
              )}

              <section className="fap-section">
                <h2>How sponsorship works here</h2>
                <div className="fap-decision-grid">
                  <div className="fap-decision-card">
                    <span className="fap-decision-icon">
                      <FaMoneyBillWave />
                    </span>
                    <h3>Fee structure</h3>
                    <dl className="fap-fee">
                      <div>
                        <dt>Admin fee</dt>
                        <dd>{agent.feeNum ? `${agent.feeNum}%` : '—'}</dd>
                      </div>
                      <div>
                        <dt>Typical response</dt>
                        <dd>{agent.responseTime || '—'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </section>

              {agent.services && agent.services.length > 0 && (
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
              )}

              {agent.projects && agent.projects.length > 0 && (
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
              )}
            </>
          ) : (
            <section className="fap-section">
              <div className="fap-locked-note">
                <FaShieldAlt /> About, fee structure, eligibility, services, and contact details are
                part of a Basic subscription.
              </div>
            </section>
          )}

          <section className="fap-section">
            <h2>Focus areas</h2>
            <ul className="fad-tags">
              {(agent.focus || []).map((f) => (
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

            {subscribed ? (
              <>
                <dl className="fad-sidestats">
                  {!isNewListing(agent) && (
                    <div>
                      <dt>Projects sponsored</dt>
                      <dd>{agent.sponsored}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Assets managed</dt>
                    <dd>{agent.assetsManaged}</dd>
                  </div>
                  <div>
                    <dt>Admin fee</dt>
                    <dd>{agent.feeNum ? `${agent.feeNum}%` : '—'}</dd>
                  </div>
                  <div>
                    <dt>Typical response</dt>
                    <dd>{agent.responseTime || '—'}</dd>
                  </div>
                </dl>

                <div className="fad-contactlines">
                  {agent.website && (
                    <a href={`https://${agent.website}`} onClick={(e) => e.preventDefault()}>
                      <FaGlobe /> {agent.website}
                    </a>
                  )}
                  {agent.email && (
                    <a href={`mailto:${agent.email}`} onClick={(e) => e.preventDefault()}>
                      <FaEnvelope /> {agent.email}
                    </a>
                  )}
                  {agent.phone && (
                    <span>
                      <FaPhone /> {agent.phone}
                    </span>
                  )}
                  {agent.responseTime && (
                    <span>
                      <FaRegClock /> {agent.responseTime}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  className="fad-btn fad-btn-primary fad-btn-block"
                  onClick={() => setApplyOpen(true)}
                >
                  <FaHandshake /> Apply for sponsorship
                </button>
                <button
                  type="button"
                  className="fad-btn fad-btn-ghost fad-btn-block"
                  aria-pressed={saved}
                  onClick={handleSave}
                >
                  {saved ? <FaBookmark /> : <FaRegBookmark />} {saved ? 'Saved' : 'Save'}
                </button>
              </>
            ) : (
              <div className="fap-paywall">
                <span className="fap-paywall-icon">
                  <FaLock />
                </span>
                <h3>Subscribe to contact</h3>
                <p>
                  Get this fiscal agent’s contact details, fees, and eligibility — plus the full
                  directory — with a Basic subscription.
                </p>
                <button
                  type="button"
                  className="fad-btn fad-btn-primary fad-btn-block"
                  onClick={handleSubscribe}
                  disabled={checkoutBusy}
                >
                  {checkoutBusy ? 'Opening checkout…' : 'Subscribe to contact'} <FaArrowRight />
                </button>
                <p className="fap-paywall-fine">
                  <Link to="/subscription">See all plans</Link>
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {applyOpen && subscribed && (
        <SponsorshipApplicationModal
          agent={agent}
          onClose={() => setApplyOpen(false)}
          onSubmit={handleApplicationSubmit}
        />
      )}
    </div>
  );
}
