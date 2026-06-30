// src/components/AdminGrantReview.js
import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { supabase } from '../../supabaseClient';
import {
  FiArrowLeft,
  FiUser,
  FiCalendar,
  FiDollarSign,
  FiFileText,
  FiMessageSquare,
  FiCheckCircle,
  FiAlertTriangle,
  FiXCircle,
  FiList,
  FiExternalLink,
} from 'react-icons/fi';
import StatusBadge from '../common/StatusBadge';
import GrantAttachments from '../grant/GrantAttachments';
import { FiPaperclip } from 'react-icons/fi';
import { useWriteGuard } from '../../lib/useWriteGuard';
import ReadOnlyBanner from '../common/ReadOnlyBanner';
import './Admin.css';

const ACTION_LABEL = {
  approve: 'Approve',
  changes: 'Request Changes',
  reject:  'Reject',
};

function AdminGrantReview({ session, readOnly = false }) {
  const { id } = useParams();
  const guardWrite = useWriteGuard(session);

  const [grant,   setGrant]   = useState(null);
  const [grantee, setGrantee] = useState(null);
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // Action sidebar state
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

  // Budget items & expense review state
  const [budgetItems,    setBudgetItems]    = useState([]);
  const [expenses,       setExpenses]       = useState([]);
  const [receiptMap,     setReceiptMap]     = useState({});
  const [approvalLoading, setApprovalLoading] = useState(null); // 'bi-{id}' or 'exp-{id}'
  const [approvalError,   setApprovalError]   = useState('');

  // -------------------------------------------------------
  //  Helpers
  // -------------------------------------------------------
  const formatDate = iso => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('T')[0].split('-');
    return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  const fmt = n =>
    n == null
      ? '—'
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

  // -------------------------------------------------------
  //  Data fetching
  // -------------------------------------------------------
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      // Grant
      const { data: g, error: gErr } = await supabase
        .from('grant_record')
        .select('*')
        .eq('id', id)
        .single();
      if (gErr || !g) throw gErr || new Error('Grant not found.');
      setGrant(g);
      setDisbursedInput(g.disbursed_funds != null ? g.disbursed_funds.toString() : '');

      // Grantee (users.id = grant_record.user_id)
      const { data: u } = await supabase
        .from('users')
        .select('firstname, lastname, organization_name, email')
        .eq('id', g.user_id)
        .single();
      setGrantee(u);

      // Status history
      const { data: hist } = await supabase
        .from('grant_status_history')
        .select('*')
        .eq('grant_id', id)
        .order('created_at', { ascending: true });
      setHistory(hist || []);

      // Comments
      const { data: comms } = await supabase
        .from('grant_comments')
        .select('*')
        .eq('grant_id', id)
        .order('created_at', { ascending: true });
      setComments(comms || []);

      // Budget items
      const { data: biData } = await supabase
        .from('budget_items')
        .select('*')
        .eq('grant_id', id)
        .order('id');
      setBudgetItems(biData || []);

      // Expenses
      const { data: expData } = await supabase
        .from('expenses')
        .select('*')
        .eq('grant_id', id);
      setExpenses(expData || []);

      // Receipts — build map: expense_id → first file object
      const { data: recData } = await supabase
        .from('receipts')
        .select('expense_id, receipt_files')
        .eq('grant_id', id);
      const rMap = {};
      (recData || []).forEach(r => {
        if (r.receipt_files?.length > 0) rMap[r.expense_id] = r.receipt_files[0];
      });
      setReceiptMap(rMap);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // -------------------------------------------------------
  //  Action handlers
  // -------------------------------------------------------
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

      const { error: updateErr } = await supabase
        .from('grant_record')
        .update(updates)
        .eq('id', id);
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
      await load(true);
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
      const { error: cErr } = await supabase
        .from('grant_comments')
        .insert({
          grant_id: parseInt(id),
          comment:  commentText.trim(),
          user_id:  session?.user?.id,
        });
      if (cErr) throw cErr;
      setCommentText('');
      setCommentSuccess('Comment posted successfully.');
      setTimeout(() => setCommentSuccess(''), 8000);

      const { data } = await supabase
        .from('grant_comments')
        .select('*')
        .eq('grant_id', id)
        .order('created_at', { ascending: true });
      setComments(data || []);
    } catch (err) {
      console.error('Comment error:', err);
      Sentry.captureException(err);
    } finally {
      setCommentLoading(false);
    }
  }

  // -------------------------------------------------------
  //  Disbursed funds handler
  // -------------------------------------------------------
  async function handleUpdateDisbursedFunds() {
    if (!guardWrite()) return;
    setDisbursedLoading(true);
    setDisbursedError('');
    setDisbursedSuccess('');
    try {
      const value = disbursedInput === '' ? null : parseFloat(disbursedInput);
      const { error: updateErr } = await supabase
        .from('grant_record')
        .update({ disbursed_funds: value })
        .eq('id', id);
      if (updateErr) throw updateErr;
      setDisbursedSuccess('Disbursed funds updated.');
      await load(true);
    } catch (err) {
      setDisbursedError(err.message);
    } finally {
      setDisbursedLoading(false);
    }
  }

  // -------------------------------------------------------
  //  Budget item & expense approval handlers
  // -------------------------------------------------------
  const handleApproveBudgetItem = async (item) => {
    if (!guardWrite()) return;
    setApprovalLoading(`bi-${item.id}`);
    setApprovalError('');
    try {
      const { data, error: err } = await supabase.from('budget_items').update({ status: 'approved' }).eq('id', item.id).select();
      if (err) throw err;
      if (!data || data.length === 0) throw new Error('Update was not applied — check RLS policies for budget_items.');
      await load(true);
    } catch (err) {
      setApprovalError(`Failed to approve budget item: ${err.message}`);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleRejectBudgetItem = async (item) => {
    if (!guardWrite()) return;
    setApprovalLoading(`bi-${item.id}`);
    setApprovalError('');
    try {
      const { data, error: err } = await supabase.from('budget_items').update({ status: 'rejected' }).eq('id', item.id).select();
      if (err) throw err;
      if (!data || data.length === 0) throw new Error('Update was not applied — check RLS policies for budget_items.');
      // Cascade: reset all linked expenses to pending so admin can handle them individually
      await supabase.from('expenses').update({ status: 'pending' }).eq('budget_item_id', item.id);
      await load(true);
    } catch (err) {
      setApprovalError(`Failed to reject budget item: ${err.message}`);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleApproveExpense = async (exp) => {
    if (!guardWrite()) return;
    setApprovalLoading(`exp-${exp.id}`);
    setApprovalError('');
    try {
      const { data, error: err } = await supabase.from('expenses').update({ status: 'approved' }).eq('id', exp.id).select();
      if (err) throw err;
      if (!data || data.length === 0) throw new Error('Update was not applied — check RLS policies for expenses.');
      await load(true);
    } catch (err) {
      setApprovalError(`Failed to approve expense: ${err.message}`);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleRejectExpense = async (exp) => {
    if (!guardWrite()) return;
    setApprovalLoading(`exp-${exp.id}`);
    setApprovalError('');
    try {
      const { data, error: err } = await supabase.from('expenses').update({ status: 'rejected' }).eq('id', exp.id).select();
      if (err) throw err;
      if (!data || data.length === 0) throw new Error('Update was not applied — check RLS policies for expenses.');
      await load(true);
    } catch (err) {
      setApprovalError(`Failed to reject expense: ${err.message}`);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleViewReceipt = async (storagePath) => {
    const { data, error: urlErr } = await supabase.storage
      .from('receipts')
      .createSignedUrl(storagePath, 60);
    if (urlErr || !data?.signedUrl) {
      alert('Could not open receipt. Please try again.');
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  // -------------------------------------------------------
  //  Render
  // -------------------------------------------------------
  if (loading) return <div className="admin-review-page"><p className="admin-loading">Loading grant…</p></div>;
  if (error)   return <div className="admin-review-page"><p className="admin-error">{error}</p></div>;
  if (!grant)  return null;

  const notesRequired = selectedAction !== 'approve';
  const submitDisabled =
    actionLoading || (notesRequired && !notes.trim());

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
          <div className="admin-card">
            <h3 className="admin-card-title"><FiList /> Budget Items &amp; Expense Review</h3>
            {approvalError && (
              <p style={{ color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.75em 1em', fontSize: '0.9rem', marginBottom: '1em' }}>
                {approvalError}
              </p>
            )}
            {budgetItems.length === 0 ? (
              <p className="admin-empty">No budget items submitted yet.</p>
            ) : (
              <div className="admin-budget-review">
                {budgetItems.map(bi => {
                  const biExpenses = expenses.filter(e => e.budget_item_id === bi.id);
                  const isBiLoading = approvalLoading === `bi-${bi.id}`;
                  return (
                    <div key={bi.id} className="admin-bi-block">
                      <div className="admin-bi-header">
                        <div className="admin-bi-info">
                          <StatusBadge status={bi.status} />
                          <span className="admin-bi-name">{bi.item_name}</span>
                          {bi.description && (
                            <span className="admin-bi-desc">{bi.description}</span>
                          )}
                        </div>
                        <div className="admin-bi-amounts">
                          <span>Allocated: {fmt(bi.budget_allocated)}</span>
                          <span>Approved Spent: {fmt(bi.amount_spent)}</span>
                        </div>
                        <div
                          className="admin-item-actions"
                          style={{ visibility: bi.status === 'pending' ? 'visible' : 'hidden' }}
                        >
                          <button
                            className="admin-approve-btn"
                            onClick={() => handleApproveBudgetItem(bi)}
                            disabled={isBiLoading}
                          >
                            <FiCheckCircle /> {isBiLoading ? 'Saving…' : 'Approve'}
                          </button>
                          <button
                            className="admin-reject-btn"
                            onClick={() => handleRejectBudgetItem(bi)}
                            disabled={isBiLoading}
                          >
                            <FiXCircle /> Reject
                          </button>
                        </div>
                      </div>

                      {biExpenses.length > 0 && (
                        <div className="admin-expense-table-wrapper">
                          <table className="admin-expense-table">
                            <thead>
                              <tr>
                                <th>Description</th>
                                <th>Amount</th>
                                <th>Date</th>
                                <th>Status</th>
                                <th>Receipt</th>
                              </tr>
                            </thead>
                            <tbody>
                              {biExpenses.map(exp => {
                                const receipt = receiptMap[exp.id];
                                const isExpLoading = approvalLoading === `exp-${exp.id}`;
                                return (
                                  <tr key={exp.id}>
                                    <td>{exp.item_name || '—'}</td>
                                    <td>{fmt(exp.amount_spent)}</td>
                                    <td>{formatDate(exp.expense_date)}</td>
                                    <td>
                                      <div className="admin-exp-status-cell">
                                        <StatusBadge status={exp.status} />
                                        {exp.status === 'pending' && (
                                          <div className="admin-item-actions">
                                            <button
                                              className="admin-approve-btn small"
                                              onClick={() => handleApproveExpense(exp)}
                                              disabled={isExpLoading}
                                            >
                                              <FiCheckCircle /> {isExpLoading ? '…' : 'Approve'}
                                            </button>
                                            <button
                                              className="admin-reject-btn small"
                                              onClick={() => handleRejectExpense(exp)}
                                              disabled={isExpLoading}
                                            >
                                              <FiXCircle /> Reject
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    <td>
                                      {receipt ? (
                                        <button
                                          className="admin-receipt-btn"
                                          onClick={() => handleViewReceipt(receipt.path)}
                                          title={receipt.name}
                                        >
                                          <FiExternalLink /> View
                                        </button>
                                      ) : <span className="admin-no-receipt">—</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* Grant Attachments — read-only for admin */}
          <div className="admin-card">
            <h3 className="admin-card-title"><FiPaperclip /> Grant Documents</h3>
            <GrantAttachments
              grantId={parseInt(id)}
              session={session}
              readOnly
            />
          </div>
        </div>

        {/* RIGHT — sticky sidebar */}
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
      </div>
    </div>
  );
}

export default AdminGrantReview;
