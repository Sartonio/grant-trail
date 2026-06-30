import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FaSearch,
  FaMapMarkerAlt,
  FaCheckCircle,
  FaLock,
  FaSeedling,
  FaHandshake,
  FaBuilding,
  FaArrowRight,
  FaCheck,
  FaFilter,
  FaEnvelope,
  FaTimes,
  FaRegBookmark,
  FaBookmark,
  FaGlobe,
  FaPhone,
  FaChevronLeft,
  FaChevronRight,
  FaShieldAlt,
  FaUsers,
} from 'react-icons/fa';
import * as Sentry from '@sentry/react';
import { supabase } from '../../supabaseClient';
import { canViewDirectory, isAuthenticated } from '../../lib/policy';
import { startCheckoutSession, MEMBERSHIP_TIERS } from '../../lib/billing';
import { mapTeaserListing, mapFullListing } from './fiscalAgents.map';
import {
  FOCUS_AREAS,
  SORTS,
  PAGE_SIZE,
  Stars,
  Modal,
  AgentCard,
  Toast,
  isNewListing,
  NewBadge,
} from './fiscalAgentsShared';
import SponsorshipApplicationModal from './SponsorshipApplicationModal';
import { notifyInquirySubmitted } from '../../lib/inquiries';
import './FiscalAgentDirectory.css';

/*
  Fiscal Agent Directory — production seeker surface
  --------------------------------------------------
  Subscription-gated charity directory. The paywall is driven by the real
  session via `canViewDirectory(session)` (single source of truth in
  lib/policy.js); it is UX only — RLS on the backend is the real gate.

    - Always fetch the teaser from `fiscal_agent_listings_public` so locked
      visitors never receive contact/fee data client-side.
    - When the seeker can view the directory, additionally fetch full rows from
      `fiscal_agent_listings` (RLS returns them only to entitled callers).
    - "Subscribe for access" -> Basic checkout.
    - "List your charity" -> the pay-first Fiscal Agent intake (/fiscal-agents/list).
*/

/* ------------------------------------------------------------------ */
/* Profile detail modal (teaser vs full per UX §2.3)                   */
/* ------------------------------------------------------------------ */

function ProfileModal({ agent, locked, saved, onToggleSave, onClose, onContact }) {
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
            <p className="fad-blurb">{agent.blurb}</p>

            {!locked && agent.about && (
              <>
                <h4>About</h4>
                <p>{agent.about}</p>
              </>
            )}

            {!locked && agent.services && agent.services.length > 0 && (
              <>
                <h4>Services</h4>
                <ul className="fad-checklist">
                  {agent.services.map((s) => (
                    <li key={s}>
                      <FaCheckCircle /> {s}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {!locked && agent.projects && agent.projects.length > 0 && (
              <>
                <h4>Recently sponsored projects</h4>
                <ul className="fad-projects">
                  {agent.projects.map((p) => (
                    <li key={p}>
                      <FaSeedling /> {p}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <ul className="fad-tags">
              {(agent.focus || []).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          <aside className="fad-profile-side">
            {!locked ? (
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
                </div>

                <button
                  type="button"
                  className="fad-btn fad-btn-primary fad-btn-block"
                  onClick={() => onContact(agent)}
                >
                  <FaHandshake /> Request partnership
                </button>
                <button
                  type="button"
                  className="fad-btn fad-btn-ghost fad-btn-block"
                  onClick={() => onToggleSave(agent.id)}
                >
                  {saved ? <FaBookmark /> : <FaRegBookmark />} {saved ? 'Saved' : 'Save for later'}
                </button>
              </>
            ) : (
              <div className="fad-paywall-card fad-paywall-card-inline">
                <span className="fad-paywall-icon">
                  <FaLock />
                </span>
                <h2>Subscribe to contact</h2>
                <p>
                  Contact details, fees, and eligibility for this fiscal agent are part of a
                  Basic subscription.
                </p>
                <Link to="/fiscal-agents" className="fad-btn fad-btn-primary fad-btn-block">
                  See plans <FaArrowRight />
                </Link>
              </div>
            )}
          </aside>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function FiscalAgentDirectory({ session }) {
  const navigate = useNavigate();
  const subscribed = canViewDirectory(session);

  const [query, setQuery] = useState('');
  const [activeFocus, setActiveFocus] = useState('All');
  const [region, setRegion] = useState('All');
  const [acceptingOnly, setAcceptingOnly] = useState(false);
  const [sort, setSort] = useState('rating');
  const [page, setPage] = useState(1);

  const [saved, setSaved] = useState(() => new Set());
  const [profileAgent, setProfileAgent] = useState(null);
  const [applyAgent, setApplyAgent] = useState(null);
  const [toast, setToast] = useState(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Fetch listings. Always read the public teaser view; when entitled, read the
  // full table too (RLS returns full rows only to subscribers/owners/super
  // admins). Subscribed sessions render full rows; locked sessions only ever
  // hold teaser data so contact info is never fetched client-side.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        if (subscribed) {
          const { data, error } = await supabase
            .from('fiscal_agent_listings')
            .select('*')
            .eq('status', 'published')
            .eq('verification', 'verified');
          if (error) throw error;
          if (!cancelled) setAgents((data || []).map(mapFullListing));
        } else {
          const { data, error } = await supabase
            .from('fiscal_agent_listings_public')
            .select('*');
          if (error) throw error;
          if (!cancelled) setAgents((data || []).map(mapTeaserListing));
        }
      } catch (err) {
        Sentry.captureException(err);
        if (!cancelled) {
          setLoadError(true);
          setAgents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [subscribed]);

  const regions = useMemo(
    () => ['All', ...Array.from(new Set(agents.map((a) => a.region).filter(Boolean)))],
    [agents],
  );

  // Reset pagination whenever filters change.
  useEffect(() => {
    setPage(1);
  }, [query, activeFocus, region, acceptingOnly, sort]);

  const filtered = useMemo(() => {
    const list = agents.filter((a) => {
      const matchesQuery =
        !query ||
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.location.toLowerCase().includes(query.toLowerCase());
      const matchesFocus = activeFocus === 'All' || (a.focus || []).includes(activeFocus);
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
  }, [agents, query, activeFocus, region, acceptingOnly, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const heroStats = useMemo(
    () => ({
      total: agents.length,
      verified: agents.filter((a) => a.verified).length,
      sponsored: agents.reduce((n, a) => n + (a.sponsored || 0), 0),
    }),
    [agents],
  );

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

  // Throws on insert failure so the modal can surface an inline error and let the
  // seeker retry; on success the modal shows its own confirmation panel (it stays
  // open until the seeker dismisses it), so we don't clear applyAgent here.
  async function handleApplicationSubmit(application) {
    const agent = applyAgent;
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
      setToast({ kind: 'error', msg: 'Billing is temporarily unavailable — please try again later.' });
    }
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
            <strong>{heroStats.total}</strong> fiscal agents
          </span>
          <span>
            <strong>{heroStats.verified}</strong> verified
          </span>
          <span>
            <strong>{heroStats.sponsored}</strong> projects sponsored
          </span>
        </div>
      </section>

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
            disabled={!subscribed}
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
            <select value={region} onChange={(e) => setRegion(e.target.value)} disabled={!subscribed}>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="fad-select">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)} disabled={!subscribed}>
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
            disabled={!subscribed}
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
            disabled={!subscribed}
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
        {hasFilters && subscribed && (
          <button type="button" className="fad-clearlink" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Results — gated for non-subscribers */}
      <div className="fad-results-wrap">
        {loading ? (
          <div className="fad-empty">
            <FaSearch />
            <p>Loading fiscal agents…</p>
          </div>
        ) : loadError ? (
          <div className="fad-empty">
            <FaSearch />
            <p>We couldn’t load the directory. Please try again.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="fad-empty">
            <FaSearch />
            <p>No fiscal agents match your filters.</p>
            {hasFilters && subscribed && (
              <button type="button" className="fad-btn fad-btn-ghost" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <section className={`fad-grid ${!subscribed ? 'is-gated' : ''}`} aria-hidden={!subscribed}>
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

        {!subscribed && (
          <div className="fad-paywall" role="dialog" aria-label="Subscription required">
            <div className="fad-paywall-card">
              <span className="fad-paywall-icon">
                <FaLock />
              </span>
              <h2>Subscribe to view the full directory</h2>
              <p>
                Access to the Fiscal Agent directory is included with a Basic
                subscription. See contact details, fees, and track records for every verified
                fiscal agent.
              </p>
              <ul className="fad-paywall-list">
                <li>
                  <FaCheckCircle /> Full profiles for every verified agent
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
                onClick={handleSubscribe}
                disabled={checkoutBusy}
              >
                {checkoutBusy ? 'Opening checkout…' : 'Subscribe for access'} <FaArrowRight />
              </button>
              <p className="fad-paywall-fine">
                Cancel anytime · Billed monthly · <Link to="/subscription">See plans</Link>
              </p>
            </div>
          </div>
        )}

        {/* Pagination (only meaningful when unlocked) */}
        {subscribed && filtered.length > PAGE_SIZE && (
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

      {/* Charity acquisition CTA — pay-first Fiscal Agent intake. Logged-out only:
          onboarding provisions a fresh tenant + admin, so it's broken for any
          signed-in user (grantee pays for nothing; admin double-creates an org). */}
      {!isAuthenticated(session) && (
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
          <Link
            to="/fiscal-agents/list"
            className="fad-btn fad-btn-gold fad-btn-lg"
          >
            <FaBuilding /> List your charity
          </Link>
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
          locked={!subscribed}
          saved={saved.has(profileAgent.id)}
          onToggleSave={toggleSave}
          onClose={() => setProfileAgent(null)}
          onContact={(a) => {
            setProfileAgent(null);
            setApplyAgent(a);
          }}
        />
      )}
      {applyAgent && subscribed && (
        <SponsorshipApplicationModal
          agent={applyAgent}
          onClose={() => setApplyAgent(null)}
          onSubmit={handleApplicationSubmit}
        />
      )}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
