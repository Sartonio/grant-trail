// src/components/AdminGrantReview.js
import { useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import {
  FiArrowLeft,
  FiUser,
  FiCalendar,
  FiDollarSign,
  FiFileText,
  FiMessageSquare,
  FiAlertTriangle,
} from 'react-icons/fi';
import StatusBadge from '../common/StatusBadge';
import GrantAttachments from '../grant/GrantAttachments';
import { FiPaperclip } from 'react-icons/fi';
import { useWriteGuard } from '../../lib/useWriteGuard';
import ReadOnlyBanner from '../common/ReadOnlyBanner';
import { formatDateMed, formatCurrency } from '../../lib/format';
import { useGrantReview } from '../../hooks/useGrantReview';
import BudgetExpenseReview from './BudgetExpenseReview';
import ReviewSidebar from './ReviewSidebar';
import './Admin.css';

function AdminGrantReview({ session, readOnly = false }) {
  const { id } = useParams();
  // Route params are strings; convert once here — the hooks/data layer
  // work with numeric grant ids.
  const grantId = Number(id);
  const guardWrite = useWriteGuard(session);

  const {
    grant, grantee, history, comments, budgetItems, expenses, receiptMap,
    loading, error, reload, postComment,
  } = useGrantReview(grantId);

  const formatDate = formatDateMed;
  const fmt = n => formatCurrency(n);

  // -------------------------------------------------------
  //  Render
  // -------------------------------------------------------
  if (loading) return <div className="admin-review-page"><p className="admin-loading">Loading grant…</p></div>;
  if (error)   return <div className="admin-review-page"><p className="admin-error">{error}</p></div>;
  if (!grant)  return null;

  return (
    <div className="admin-review-page">
      <ReadOnlyBanner readOnly={readOnly} />

      {/* Nav bar */}
      <div className="admin-review-nav">
        <Link to="/admin/grants" className="admin-back-link">
          <FiArrowLeft /> All Grants
        </Link>
        <Link to="/admin" className="admin-back-link">
          Dashboard
        </Link>
      </div>

      {/* Green header banner */}
      <div className="admin-review-header">
        <div className="arh-title">
          <h2>{grant.grant_name || `Grant #${grant.id}`}</h2>
          <StatusBadge status={grant.status} />
        </div>
        <div className="arh-grantee">
          {grantee && (
            <>
              <span><FiUser /> {grantee.firstname} {grantee.lastname}</span>
              {grantee.organization_name && <span>🏛 {grantee.organization_name}</span>}
              <span>✉ {grantee.email}</span>
            </>
          )}
          <span><FiCalendar /> Submitted {formatDate(grant.created_at)}</span>
        </div>
      </div>

      {/* Expired grant warning */}
      {grant.end_spend_period && new Date(grant.end_spend_period + 'T23:59:59') < new Date() && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.6em',
          background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)',
          borderLeft: '4px solid #EF4444', borderRadius: 'var(--radius-md)',
          padding: '0.75em 1.25em', marginBottom: '1em', fontSize: '0.9rem', color: '#991b1b',
        }}>
          <FiAlertTriangle size={16} /> This grant's spend period has ended.
        </div>
      )}

      {/* Two-column body */}
      <div className="admin-review-body">

        {/* LEFT — main content */}
        <div className="admin-review-main">

          {/* Grant Details card */}
          <div className="admin-card">
            <h3 className="admin-card-title"><FiDollarSign /> Grant Details</h3>
            <div className="admin-info-grid">
              <div className="admin-info-item">
                <span className="aii-label">Grant Amount</span>
                <span className="aii-value">{fmt(grant.grant_amount)}</span>
              </div>
              <div className="admin-info-item">
                <span className="aii-label">Disbursed Funds</span>
                <span className="aii-value">{fmt(grant.disbursed_funds)}</span>
              </div>
              <div className="admin-info-item">
                <span className="aii-label">Total Spent</span>
                <span className="aii-value spent">{fmt(grant.total_spent)}</span>
              </div>
              <div className="admin-info-item">
                <span className="aii-label">Remaining Balance</span>
                <span className="aii-value remaining">{fmt(grant.remaining_balance)}</span>
              </div>
              <div className="admin-info-item">
                <span className="aii-label">Start Date</span>
                <span className="aii-value">{formatDate(grant.start_spend_period)}</span>
              </div>
              <div className="admin-info-item">
                <span className="aii-label">End Date</span>
                <span className="aii-value">{formatDate(grant.end_spend_period)}</span>
              </div>
              {grant.release_date && (
                <div className="admin-info-item">
                  <span className="aii-label">Release Date</span>
                  <span className="aii-value">{formatDate(grant.release_date)}</span>
                </div>
              )}
              {grant.reviewed_at && (
                <div className="admin-info-item">
                  <span className="aii-label">Last Reviewed</span>
                  <span className="aii-value">{formatDate(grant.reviewed_at)}</span>
                </div>
              )}
            </div>

            {grant.description && (
              <div className="admin-info-full">
                <span className="aii-label"><FiFileText /> Description</span>
                <p className="aii-description">{grant.description}</p>
              </div>
            )}
            {grant.approval_notes && (
              <div className="admin-info-full">
                <span className="aii-label">Review Notes</span>
                <p className="aii-notes">{grant.approval_notes}</p>
              </div>
            )}
          </div>

          {/* Status History */}
          <div className="admin-card">
            <h3 className="admin-card-title"><FiCalendar /> Status History</h3>
            {history.length === 0 ? (
              <p className="admin-empty">No status changes recorded yet.</p>
            ) : (
              <div className="status-timeline">
                {history.map((entry, i) => (
                  <div key={entry.id} className="timeline-entry">
                    <div className="timeline-marker">
                      <div className="timeline-dot" />
                      {i < history.length - 1 && <div className="timeline-line" />}
                    </div>
                    <div className="timeline-content">
                      <div className="timeline-transition">
                        <StatusBadge status={entry.old_status} />
                        <span className="timeline-arrow">→</span>
                        <StatusBadge status={entry.new_status} />
                      </div>
                      <span className="timeline-date">{formatDate(entry.created_at)}</span>
                      {entry.comment && <p className="timeline-comment">{entry.comment}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comments — only shown when non-empty */}
          {comments.length > 0 && (
            <div className="admin-card">
              <h3 className="admin-card-title"><FiMessageSquare /> Comments</h3>
              <div className="comments-list">
                {comments.map(c => (
                  <div key={c.id} className="comment-item">
                    <span className="comment-date">
                      {formatDate(c.created_at)} · Admin
                    </span>
                    <p className="comment-text">{c.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Budget Items & Expense Review — hide section when both approvals off */}
          {(session?.tenantConfig?.require_budget_approval !== false || session?.tenantConfig?.require_expense_approval !== false) && (
            <BudgetExpenseReview
              budgetItems={budgetItems}
              expenses={expenses}
              receiptMap={receiptMap}
              fmt={fmt}
              formatDate={formatDate}
              guardWrite={guardWrite}
              reload={reload}
            />
          )}

          {/* Grant Attachments — read-only for admin */}
          <div className="admin-card">
            <h3 className="admin-card-title"><FiPaperclip /> Grant Documents</h3>
            <GrantAttachments
              grantId={grantId}
              session={session}
              readOnly
            />
          </div>
        </div>

        {/* RIGHT — sticky sidebar */}
        <ReviewSidebar
          grant={grant}
          id={grantId}
          session={session}
          guardWrite={guardWrite}
          reload={reload}
          postComment={postComment}
        />
      </div>
    </div>
  );
}

export default AdminGrantReview;
