// src/components/fiscalAgentsShared.js
//
// Presentational primitives shared across the Fiscal Agent / Charity Directory
// surfaces (directory grid, owner dashboard, listing editor). Extracted from the
// original mockup so the production directory, owner panel, and editor reuse the
// same `.fad-*` look without duplicating markup. Pure UI — no data fetching.

import React, { useEffect, useRef } from 'react';
import {
  FaStar,
  FaTimes,
  FaMapMarkerAlt,
  FaCheckCircle,
  FaCheck,
  FaRegClock,
  FaEnvelope,
  FaArrowRight,
  FaRegBookmark,
  FaBookmark,
  FaPen,
} from 'react-icons/fa';

export const FOCUS_AREAS = [
  'Education',
  'Arts & Culture',
  'Environment',
  'Health',
  'Youth',
  'Food Security',
  'Housing',
  'Community',
];

export const SORTS = [
  { id: 'rating', label: 'Top rated' },
  { id: 'sponsored', label: 'Most projects' },
  { id: 'feeLow', label: 'Lowest fee' },
  { id: 'name', label: 'Name (A–Z)' },
];

export const RESPONSE_TIMES = [
  'Same day',
  '~1 business day',
  '~2 business days',
  '~3 business days',
];

export const PAGE_SIZE = 6;

export function Stars({ rating }) {
  const value = typeof rating === 'number' ? rating : 0;
  return (
    <span className="fad-rating" aria-label={`${value} out of 5`}>
      <FaStar /> {value.toFixed(1)}
    </span>
  );
}

// A listing is "new" when it has no real engagement yet: rating, reviews, and
// sponsored count are all zero or null. Such listings hide their zero-state
// metrics and show a New badge instead (#A4).
export function isNewListing(agent) {
  return !agent.rating && !agent.reviews && !agent.sponsored;
}

export function NewBadge() {
  return <span className="fad-badge fad-badge-new">New</span>;
}

export function Field({ label, children, required = false }) {
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

export function Modal({ onClose, children, labelledBy, wide }) {
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

export function AgentCard({ agent, saved, onToggleSave, onOpen, onContact }) {
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
        {isNewListing(agent) ? <NewBadge /> : <Stars rating={agent.rating} />}
      </div>

      <p className="fad-blurb">{agent.blurb}</p>

      <ul className="fad-tags">
        {(agent.focus || []).map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <dl className="fad-stats">
        {!isNewListing(agent) && (
          <div>
            <dt>Sponsored</dt>
            <dd>{agent.sponsored}</dd>
          </div>
        )}
        <div>
          <dt>Assets</dt>
          <dd>{agent.assetsManaged}</dd>
        </div>
        <div>
          <dt>Admin fee</dt>
          <dd>{agent.feeNum ? `${agent.feeNum}%` : '—'}</dd>
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
        {agent.responseTime && (
          <span className="fad-meta-time">
            <FaRegClock /> {agent.responseTime}
          </span>
        )}
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

export function Toast({ toast, onDone }) {
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

// Owner's public-preview + completeness panel (S11). `readOnly` disables the
// mutating affordances for a lapsed Fiscal Agent (#40 read-only degrade).
export function OwnerListingPanel({ listing, completeness, status, onEdit, onToggleAccepting, readOnly }) {
  // A listing is only publicly live when published AND 501(c)(3)-verified — the
  // public directory view gates on both (status='published' AND verification='verified').
  // Published-but-unverified is verification-pending, not live.
  const isLive = status === 'published' && listing.verification === 'verified';
  const isPendingVerification = status === 'published' && listing.verification !== 'verified';
  return (
    <section className="fad-owner-panel">
      <div className="fad-owner-panel-head">
        <h2>Your listing</h2>
        {isLive ? (
          <span className="fad-badge fad-badge-ok">
            <FaCheckCircle /> Live
          </span>
        ) : (
          <span className="fad-badge fad-badge-muted">
            {isPendingVerification
              ? (listing.verification === 'rejected' ? 'Verification rejected' : 'Verification pending')
              : status === 'hidden' ? 'Hidden' : status === 'unlisted' ? 'Unlisted' : 'Draft'}
          </span>
        )}
        <button
          type="button"
          className="fad-btn fad-btn-primary fad-owner-edit"
          onClick={onEdit}
          disabled={readOnly}
        >
          <FaPen /> Edit listing
        </button>
      </div>

      <div className="fad-owner-panel-body">
        <div className="fad-listing-preview">
          <span className="fad-preview-tag">Public preview</span>
          <div className="fad-card-head">
            <div className="fad-avatar" aria-hidden="true">
              {listing.name.charAt(0)}
            </div>
            <div className="fad-card-title">
              <h3>
                {listing.name}
                {listing.verified && (
                  <span className="fad-verified" title="Verified Fiscal Agent">
                    <FaCheckCircle />
                  </span>
                )}
              </h3>
              <p className="fad-location">
                <FaMapMarkerAlt /> {listing.location}
              </p>
            </div>
            <Stars rating={listing.rating} />
          </div>
          <p className="fad-blurb">{listing.blurb}</p>
          <ul className="fad-tags">
            {(listing.focus || []).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className="fad-card-meta">
            {listing.accepting ? (
              <span className="fad-badge fad-badge-ok">
                <FaCheck /> Accepting projects
              </span>
            ) : (
              <span className="fad-badge fad-badge-muted">Waitlist only</span>
            )}
            {listing.responseTime && (
              <span className="fad-meta-time">
                <FaRegClock /> {listing.responseTime}
              </span>
            )}
          </div>
        </div>

        <aside className="fad-owner-side">
          <div className="fad-completeness">
            <div className="fad-completeness-top">
              <span>Profile completeness</span>
              <strong>{completeness}%</strong>
            </div>
            <div className="fad-completeness-bar">
              <span style={{ width: `${completeness}%` }} />
            </div>
            {completeness < 100 && (
              <p className="fad-hint">A complete profile ranks higher with seekers.</p>
            )}
          </div>

          <button
            type="button"
            className={`fad-toggle ${listing.accepting ? 'is-active' : ''}`}
            aria-pressed={listing.accepting}
            onClick={onToggleAccepting}
            disabled={readOnly}
          >
            <FaCheck /> {listing.accepting ? 'Accepting projects' : 'Waitlist only'}
          </button>
        </aside>
      </div>
    </section>
  );
}

// Weight the fields seekers actually look at, so the completeness meter nudges
// owners toward a useful profile rather than a merely non-empty one.
export function listingCompleteness(l) {
  const checks = [
    !!l.name,
    !!l.location,
    !!l.blurb,
    !!l.about,
    l.focus && l.focus.length > 0,
    l.services && l.services.length > 0,
    !!l.website,
    !!l.email,
    !!l.phone,
    !!l.feeNum,
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}
