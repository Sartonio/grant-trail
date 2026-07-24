import { Link } from 'react-router';
import {
  FaMapMarkerAlt,
  FaCheckCircle,
  FaLock,
  FaSeedling,
  FaHandshake,
  FaArrowRight,
  FaCheck,
  FaEnvelope,
  FaRegBookmark,
  FaBookmark,
  FaGlobe,
  FaPhone,
} from 'react-icons/fa';
import {
  Stars,
  Modal,
  isNewListing,
  NewBadge,
} from './fiscalAgentsShared';

/* ------------------------------------------------------------------ */
/* Profile detail modal (teaser vs full per UX §2.3)                   */
/* ------------------------------------------------------------------ */

export default function ProfileModal({ agent, locked, saved, onToggleSave, onClose, onContact }) {
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
                    <a href={`https://${agent.website}`} target="_blank" rel="noopener noreferrer">
                      <FaGlobe /> {agent.website}
                    </a>
                  )}
                  {agent.email && (
                    <a href={`mailto:${agent.email}`}>
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
                <Link to="/subscription" className="fad-btn fad-btn-primary fad-btn-block">
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
