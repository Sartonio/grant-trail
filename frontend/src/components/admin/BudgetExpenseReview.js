import { useState } from 'react';
import {
  FiList,
  FiCheckCircle,
  FiXCircle,
  FiExternalLink,
} from 'react-icons/fi';
import StatusBadge from '../common/StatusBadge';
import { getReceiptSignedUrl } from '../../lib/storage';
import { setExpenseStatus } from '../../lib/data/expenses';
import { setBudgetItemStatus } from '../../lib/data/budgetItems';

/**
 * "Budget Items & Expense Review" admin card. Owns its own approval loading/error
 * state; mutations route through the passed-in write guard and reload.
 *
 * @param {Object} props
 * @param {Array<Object>} props.budgetItems
 * @param {Array<Object>} props.expenses
 * @param {Object} props.receiptMap
 * @param {(n: number) => string} props.fmt
 * @param {(d: string) => string} props.formatDate
 * @param {() => boolean} props.guardWrite
 * @param {(force?: boolean) => Promise<void>} props.reload
 */
export default function BudgetExpenseReview({
  budgetItems, expenses, receiptMap, fmt, formatDate, guardWrite, reload,
}) {
  const [approvalLoading, setApprovalLoading] = useState(null); // 'bi-{id}' or 'exp-{id}'
  const [approvalError,   setApprovalError]   = useState('');

  const handleApproveBudgetItem = async (item) => {
    if (!guardWrite()) return;
    setApprovalLoading(`bi-${item.id}`);
    setApprovalError('');
    try {
      await setBudgetItemStatus(item.id, 'approved');
      await reload(true);
    } catch (err) {
      setApprovalError(`Failed to approve budget item: ${err.message}`);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleDeclineBudgetItem = async (item) => {
    if (!guardWrite()) return;
    if (!window.confirm('Decline this budget item? All linked expenses will be reset to pending.')) return;
    setApprovalLoading(`bi-${item.id}`);
    setApprovalError('');
    try {
      // Decline + cascade (linked expenses → pending) lives in setBudgetItemStatus.
      await setBudgetItemStatus(item.id, 'declined');
      await reload(true);
    } catch (err) {
      setApprovalError(`Failed to decline budget item: ${err.message}`);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleApproveExpense = async (exp) => {
    if (!guardWrite()) return;
    setApprovalLoading(`exp-${exp.id}`);
    setApprovalError('');
    try {
      await setExpenseStatus(exp.id, 'approved');
      await reload(true);
    } catch (err) {
      setApprovalError(`Failed to approve expense: ${err.message}`);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleDeclineExpense = async (exp) => {
    if (!guardWrite()) return;
    setApprovalLoading(`exp-${exp.id}`);
    setApprovalError('');
    try {
      await setExpenseStatus(exp.id, 'declined');
      await reload(true);
    } catch (err) {
      setApprovalError(`Failed to decline expense: ${err.message}`);
    } finally {
      setApprovalLoading(null);
    }
  };

  const handleViewReceipt = async (storagePath) => {
    const signedUrl = await getReceiptSignedUrl(storagePath);
    if (!signedUrl) {
      setApprovalError('Could not open receipt. Please try again.');
      return;
    }
    setApprovalError('');
    window.open(signedUrl, '_blank');
  };

  return (
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
                      className="admin-decline-btn"
                      onClick={() => handleDeclineBudgetItem(bi)}
                      disabled={isBiLoading}
                    >
                      <FiXCircle /> Decline
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
                                        className="admin-decline-btn small"
                                        onClick={() => handleDeclineExpense(exp)}
                                        disabled={isExpLoading}
                                      >
                                        <FiXCircle /> Decline
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
  );
}
