import React, { useMemo, useState } from 'react';
import {
  FaInbox,
  FaRegEnvelope,
  FaEnvelopeOpenText,
  FaCheckCircle,
  FaTimesCircle,
  FaClock,
  FaRegClock,
  FaUserTie,
  FaBuilding,
  FaPhone,
  FaEnvelope,
  FaSeedling,
  FaArrowRight,
} from 'react-icons/fa';
import './FiscalAgentInbox.css';

/*
  MOCKUP — Fiscal Agent inbox
  ---------------------------
  The listing-owner side of the apply -> inbox loop. Structured sponsorship
  applications submitted from SponsorshipApplicationModal land here. Master/
  detail layout: a filterable list on the left, the full structured
  application on the right. All actions are local-state only:
    - onUpdateStatus(inquiryId, nextStatus) moves an application through the
      pipeline (new -> reviewing -> accepted/declined/waitlisted).
    - onOnboard(inquiry) is the funnel-into-GrantTrail bridge stub, shown once
      an application is accepted.
*/

const STATUS_META = {
  new: { label: 'New', cls: 'inbox-pill-new' },
  reviewing: { label: 'Reviewing', cls: 'inbox-pill-reviewing' },
  accepted: { label: 'Accepted', cls: 'inbox-pill-accepted' },
  declined: { label: 'Declined', cls: 'inbox-pill-declined' },
  waitlisted: { label: 'Waitlisted', cls: 'inbox-pill-waitlisted' },
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'waitlisted', label: 'Waitlisted' },
];

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.new;
  return <span className={`inbox-pill ${meta.cls}`}>{meta.label}</span>;
}

function DetailRow({ label, children }) {
  return (
    <div className="inbox-detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function FiscalAgentInbox({ inquiries, onUpdateStatus, onOnboard }) {
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const counts = useMemo(() => {
    const c = { all: inquiries.length, new: 0, reviewing: 0, accepted: 0, declined: 0, waitlisted: 0 };
    inquiries.forEach((q) => {
      if (c[q.status] !== undefined) c[q.status] += 1;
    });
    return c;
  }, [inquiries]);

  // Newest first.
  const sorted = useMemo(
    () =>
      [...inquiries].sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
      ),
    [inquiries],
  );

  const visible = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((q) => q.status === filter)),
    [sorted, filter],
  );

  // Resolve the selected inquiry against the live list; fall back to the first
  // visible one so the detail pane is never empty when applications exist.
  const selected =
    inquiries.find((q) => q.id === selectedId) || visible[0] || null;

  return (
    <section className="inbox-wrap" aria-label="Sponsorship application inbox">
      <header className="inbox-head">
        <h2>
          <FaInbox /> Sponsorship inbox
        </h2>
        <p>Applications from projects seeking you as their fiscal sponsor.</p>
      </header>

      <div className="inbox-tabs" role="tablist" aria-label="Filter applications by status">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`inbox-tab ${filter === f.id ? 'is-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="inbox-tab-count">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {inquiries.length === 0 ? (
        <div className="inbox-empty">
          <FaRegEnvelope />
          <p>No applications yet.</p>
          <span>When a project applies for sponsorship, it will appear here.</span>
        </div>
      ) : (
        <div className="inbox-body">
          {/* Master list */}
          <ul className="inbox-list">
            {visible.length === 0 ? (
              <li className="inbox-list-empty">No {filter} applications.</li>
            ) : (
              visible.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    className={`inbox-item ${selected && selected.id === q.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedId(q.id)}
                  >
                    <span className="inbox-item-top">
                      <span className="inbox-item-name">{q.contact.name}</span>
                      <StatusPill status={q.status} />
                    </span>
                    <span className="inbox-item-project">{q.project.name}</span>
                    <span className="inbox-item-time">
                      <FaRegClock /> {relativeTime(q.submittedAt)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {/* Detail pane */}
          <div className="inbox-detail">
            {!selected ? (
              <div className="inbox-detail-empty">
                <FaEnvelopeOpenText />
                <p>Select an application to view details.</p>
              </div>
            ) : (
              <>
                <div className="inbox-detail-head">
                  <div>
                    <h3>{selected.project.name}</h3>
                    <p className="inbox-detail-sub">
                      from {selected.contact.name}
                      {selected.contact.organization ? ` · ${selected.contact.organization}` : ''} ·{' '}
                      {relativeTime(selected.submittedAt)}
                    </p>
                  </div>
                  <StatusPill status={selected.status} />
                </div>

                <dl className="inbox-detail-grid">
                  <DetailRow label="Mission">{selected.project.mission}</DetailRow>
                  <DetailRow label="Focus">{selected.project.focus}</DetailRow>
                  <DetailRow label="Project type">{selected.project.projectType}</DetailRow>
                  <DetailRow label="Est. annual budget">{selected.project.estAnnualBudget}</DetailRow>
                  {selected.project.fundingSources && (
                    <DetailRow label="Funding sources">{selected.project.fundingSources}</DetailRow>
                  )}
                  <DetailRow label="Timeline">{selected.project.timeline}</DetailRow>
                  {selected.project.startDate && (
                    <DetailRow label="Target start">{selected.project.startDate}</DetailRow>
                  )}
                </dl>

                <h4 className="inbox-detail-section">Contact</h4>
                <ul className="inbox-contactlines">
                  <li>
                    <FaUserTie /> {selected.contact.name}
                  </li>
                  <li>
                    <FaEnvelope /> {selected.contact.email}
                  </li>
                  {selected.contact.organization && (
                    <li>
                      <FaBuilding /> {selected.contact.organization}
                    </li>
                  )}
                  {selected.contact.phone && (
                    <li>
                      <FaPhone /> {selected.contact.phone}
                    </li>
                  )}
                </ul>

                {selected.message && (
                  <>
                    <h4 className="inbox-detail-section">Message</h4>
                    <p className="inbox-message">{selected.message}</p>
                  </>
                )}

                <div className="inbox-actions">
                  <button
                    type="button"
                    className="inbox-action inbox-action-reviewing"
                    disabled={selected.status === 'reviewing'}
                    onClick={() => onUpdateStatus(selected.id, 'reviewing')}
                  >
                    <FaClock /> Mark reviewing
                  </button>
                  <button
                    type="button"
                    className="inbox-action inbox-action-accept"
                    disabled={selected.status === 'accepted'}
                    onClick={() => onUpdateStatus(selected.id, 'accepted')}
                  >
                    <FaCheckCircle /> Accept
                  </button>
                  <button
                    type="button"
                    className="inbox-action inbox-action-waitlist"
                    disabled={selected.status === 'waitlisted'}
                    onClick={() => onUpdateStatus(selected.id, 'waitlisted')}
                  >
                    <FaRegClock /> Waitlist
                  </button>
                  <button
                    type="button"
                    className="inbox-action inbox-action-decline"
                    disabled={selected.status === 'declined'}
                    onClick={() => onUpdateStatus(selected.id, 'declined')}
                  >
                    <FaTimesCircle /> Decline
                  </button>
                </div>

                {selected.status === 'accepted' && (
                  <button
                    type="button"
                    className="fad-btn fad-btn-primary fad-btn-block inbox-onboard"
                    onClick={() => onOnboard(selected)}
                  >
                    <FaSeedling /> Onboard as grantee <FaArrowRight />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
