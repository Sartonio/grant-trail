import React, { useState } from 'react';
import { Link } from 'react-router';
import {
  FaSearch,
  FaLock,
  FaSeedling,
  FaHandshake,
  FaBuilding,
  FaArrowRight,
  FaCheck,
  FaCheckCircle,
  FaFilter,
  FaTimes,
  FaChevronLeft,
  FaChevronRight,
  FaShieldAlt,
  FaUsers,
} from 'react-icons/fa';
import * as Sentry from '@sentry/react';
import { insertInquiry } from '../../lib/data/inquiries';
import { isAuthenticated } from '../../lib/policy';
import { startCheckoutSession, MEMBERSHIP_TIERS } from '../../lib/billing';
import {
  FOCUS_AREAS,
  SORTS,
  PAGE_SIZE,
  AgentCard,
  Toast,
} from './fiscalAgentsShared';
import SponsorshipApplicationModal from './SponsorshipApplicationModal';
import ProfileModal from './ProfileModal';
import { useFiscalAgentDirectory } from './useFiscalAgentDirectory';
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

export default function FiscalAgentDirectory({ session }) {
  const {
    subscribed, loading, loadError, regions, filtered, visible, pageCount,
    heroStats, hasFilters, clearFilters,
    query, setQuery,
    activeFocus, setActiveFocus,
    region, setRegion,
    acceptingOnly, setAcceptingOnly,
    sort, setSort,
    page, setPage,
  } = useFiscalAgentDirectory(session);

  const [saved, setSaved] = useState(() => new Set());
  const [profileAgent, setProfileAgent] = useState(null);
  const [applyAgent, setApplyAgent] = useState(null);
  const [toast, setToast] = useState(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

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
    const { data, error } = await insertInquiry({
      listing_id: Number(agent.id),
      project: application.project,
      contact: application.contact,
      message: application.message,
    });
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

      {/* Toolbar, chips, and result count are only useful once unlocked — hiding
          them for locked visitors keeps the paywall the single focus. */}
      {subscribed && (
      <>
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
      </>
      )}

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
              <React.Fragment key={a.id}>
                <AgentCard
                  agent={a}
                  saved={saved.has(a.id)}
                  onToggleSave={toggleSave}
                  onOpen={setProfileAgent}
                  onContact={setApplyAgent}
                />
              </React.Fragment>
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

      {/* Charity acquisition CTA — pay-first Fiscal Agent intake. Logged-out only:
          onboarding provisions a fresh tenant + admin, so it's broken for any
          signed-in user (grantee pays for nothing; admin double-creates an org).
          Placed below the trust strip so it doesn't compete with the subscribe
          paywall as a second "primary" ask right above it. */}
      {!isAuthenticated(session) && (
      <section className="fad-list-cta">
        <div className="fad-list-cta-inner">
          <span className="fad-list-cta-icon">
            <FaSeedling />
          </span>
          <div className="fad-list-cta-copy">
            <h2>Run a charity? List it as a Fiscal Agent</h2>
            <p>
              Get found by funders and projects seeking a fiscal sponsor — set up your
              organization&rsquo;s public profile in minutes.
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
