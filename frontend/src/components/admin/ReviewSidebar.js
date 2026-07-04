import { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import {
  FiDollarSign,
  FiMessageSquare,
  FiCheckCircle,
  FiAlertTriangle,
  FiXCircle,
} from 'react-icons/fi';
import { updateGrant } from '../../lib/data/grants';

const ACTION_LABEL = {
  approve: 'Approve',
  changes: 'Request Changes',
  reject:  'Reject',
};

/**
 * Right-hand review sidebar: decision panel, disbursed-funds control, and the
 * add-comment form. Owns its own form state; mutations route through the
 * passed-in write guard, reload, and postComment from useGrantReview.
 *
 * @param {Object} props
 * @param {Object} props.grant
 * @param {string|number} props.id
 * @param {Object} props.session
 * @param {() => boolean} props.guardWrite
 * @param {(force?: boolean) => Promise<void>} props.reload
 * @param {(text: string, userId: string) => Promise<void>} props.postComment
 */
export default function ReviewSidebar({ grant, id, session, guardWrite, reload, postComment }) {
  // Action panel state
  const [selectedAction,  setSelectedAction]  = useState('');
  const [notes,           setNotes]           = useState('');
  const [actionLoading,   setActionLoading]   = useState(false);
  const [actionError,     setActionError]     = useState('');
  const [actionSuccess,   setActionSuccess]   = useState('');

  // Standalone disbursed funds state
  const [disbursedInput,   setDisbursedInput]   = useState('');
  const [disbursedLoading, setDisbursedLoading] = useState(false);
  const [disbursedError,   setDisbursedError]   = useState('');
  const [disbursedSuccess, setDisbursedSuccess] = useState('');

  // Comment form state
  const [commentText,    setCommentText]    = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentSuccess, setCommentSuccess] = useState('');

  // Keep the disbursed-funds input in sync with the loaded/reloaded grant.
  useEffect(() => {
    setDisbursedInput(grant?.disbursed_funds != null ? grant.disbursed_funds.toString() : '');
  }, [grant]);

  function toggleAction(action) {
    setSelectedAction(prev => prev === action ? '' : action);
    setActionError('');
    setActionSuccess('');
  }

  async function handleSubmitAction() {
    if (!selectedAction) return;
    if (!guardWrite()) return;
    setActionLoading(true);
    setActionError('');

    try {
      const statusMap = { approve: 'approved', changes: 'needs_changes', reject: 'rejected' };
      const newStatus = statusMap[selectedAction];

      const updates = {
        status:         newStatus,
        reviewed_at:    new Date().toISOString(),
        approval_notes: notes.trim() || null,
      };

      const { error: updateErr } = await updateGrant(Number(id), updates);
      if (updateErr) throw updateErr;
      // Note: grant_status_history is written automatically by the DB trigger
      // trg_grant_status_tracking when grant_record.status changes.

      const successMsg =
        newStatus === 'needs_changes' ? 'Grant returned for changes.' :
        newStatus === 'approved'      ? 'Grant approved.' :
        'Grant rejected.';
      setActionSuccess(successMsg);
      setSelectedAction('');
      setNotes('');
      await reload(true);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAddComment() {
    if (!commentText.trim()) return;
    if (!guardWrite()) return;
    setCommentLoading(true);
    setCommentSuccess('');
    try {
      await postComment(commentText.trim(), session?.user?.id);
      setCommentText('');
      setCommentSuccess('Comment posted successfully.');
      setTimeout(() => setCommentSuccess(''), 8000);
    } catch (err) {
      console.error('Comment error:', err);
      Sentry.captureException(err);
    } finally {
      setCommentLoading(false);
    }
  }

  async function handleUpdateDisbursedFunds() {
    if (!guardWrite()) return;
    setDisbursedLoading(true);
    setDisbursedError('');
    setDisbursedSuccess('');
    try {
      const value = disbursedInput === '' ? null : parseFloat(disbursedInput);
      const { error: updateErr } = await updateGrant(Number(id), { disbursed_funds: value });
      if (updateErr) throw updateErr;
      setDisbursedSuccess('Disbursed funds updated.');
      await reload(true);
    } catch (err) {
      setDisbursedError(err.message);
    } finally {
      setDisbursedLoading(false);
    }
  }

  const notesRequired = selectedAction !== 'approve';
  const submitDisabled =
    actionLoading || (notesRequired && !notes.trim());

  return (
    <div className="admin-review-sidebar">

      {/* Action panel */}
      <div className="admin-card">
        <h3 className="admin-card-title">Review Decision</h3>

        {actionSuccess && (
          <p style={{ color: 'var(--color-success)', fontSize: '0.9rem', marginBottom: '0.75em' }}>
            ✓ {actionSuccess}
          </p>
        )}

        <div className="action-btn-group">
          <button
            className={`action-btn approve${selectedAction === 'approve' ? ' selected' : ''}`}
            onClick={() => toggleAction('approve')}
          >
            <FiCheckCircle /> Approve
          </button>
          <button
            className={`action-btn changes${selectedAction === 'changes' ? ' selected' : ''}`}
            onClick={() => toggleAction('changes')}
          >
            <FiAlertTriangle /> Request Changes
          </button>
          <button
            className={`action-btn reject${selectedAction === 'reject' ? ' selected' : ''}`}
            onClick={() => toggleAction('reject')}
          >
            <FiXCircle /> Reject
          </button>
        </div>

        {selectedAction && (
          <div className="action-form">
            <div className="action-field">
              <label>Notes {notesRequired ? '(required)' : '(optional)'}</label>
              <textarea
                rows={3}
                placeholder={
                  selectedAction === 'approve'
                    ? 'Add approval notes…'
                    : 'Explain what needs to change or why the grant is being rejected…'
                }
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            {actionError && <p className="action-error">{actionError}</p>}

            <button
              className={`action-submit-btn ${selectedAction === 'changes' ? 'needs_changes' : selectedAction}`}
              onClick={handleSubmitAction}
              disabled={submitDisabled}
            >
              {actionLoading ? 'Saving…' : `Confirm: ${ACTION_LABEL[selectedAction]}`}
            </button>
          </div>
        )}
      </div>

      {/* Disbursed funds tip — shown while grant is not yet approved */}
      {grant.status !== 'approved' && (
        <p className="admin-sidebar-tip">
          💡 A <strong>Disbursed Funds</strong> control will appear here once the grant is approved.
        </p>
      )}

      {/* Standalone disbursed funds card — shown for approved grants */}
      {grant.status === 'approved' && (
        <div className="admin-card">
          <h3 className="admin-card-title"><FiDollarSign /> Disbursed Funds</h3>
          <div className="action-field">
            <label>Amount released to grantee</label>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: '0.75em', top: '50%', transform: 'translateY(-50%)',
                color: 'var(--color-gray-400)', fontSize: '0.9rem', pointerEvents: 'none',
              }}>$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={disbursedInput}
                onChange={e => { setDisbursedInput(e.target.value); setDisbursedError(''); setDisbursedSuccess(''); }}
                disabled={disbursedLoading}
              />
            </div>
          </div>
          {disbursedError   && <p className="action-error"  style={{ marginTop: '0.4em' }}>{disbursedError}</p>}
          {disbursedSuccess && <p className="action-success" style={{ marginTop: '0.4em' }}>✓ {disbursedSuccess}</p>}
          <button
            className="admin-primary-btn full-width"
            onClick={handleUpdateDisbursedFunds}
            disabled={disbursedLoading}
            style={{ marginTop: '0.6em' }}
          >
            {disbursedLoading ? 'Saving…' : 'Update Disbursed Funds'}
          </button>
        </div>
      )}

      {/* Add comment */}
      <div className="admin-card">
        <h3 className="admin-card-title"><FiMessageSquare /> Add Comment</h3>
        <textarea
          className="comment-textarea"
          rows={3}
          placeholder="Leave a note visible to the grantee…"
          value={commentText}
          onChange={e => setCommentText(e.target.value)}
        />
        <button
          className="admin-primary-btn full-width"
          onClick={handleAddComment}
          disabled={commentLoading || !commentText.trim()}
        >
          {commentLoading ? 'Posting…' : 'Post Comment'}
        </button>
        {commentSuccess && (
          <p style={{ color: 'var(--color-success)', fontSize: '0.85rem', marginTop: '0.5em' }}>
            {commentSuccess}
          </p>
        )}
      </div>

    </div>
  );
}
