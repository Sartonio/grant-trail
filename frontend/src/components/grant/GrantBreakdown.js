import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import AddExpenseModal from "./AddExpenseModal";
import BudgetItemModal from "./BudgetItemModal";
import ConfirmDialog from "../common/ConfirmDialog";
import StatusBadge from "../common/StatusBadge";
import {
  FaArrowLeft,
  FaPlusCircle,
  FaFileInvoiceDollar,
  FaDollarSign,
  FaChartPie,
  FaMoneyBillWave,
  FaEdit,
  FaTrash,
  FaChevronDown,
  FaChevronRight,
  FaLayerGroup,
  FaReceipt,
  FaExternalLinkAlt,
  FaClock,
} from 'react-icons/fa';
import './GrantBreakdown.css';
import { getReceiptSignedUrl } from "../../lib/storage";
import { deleteExpense } from "../../lib/data/expenses";
import { deleteBudgetItem } from "../../lib/data/budgetItems";
import { useGrantBreakdown } from "../../hooks/useGrantBreakdown";
import { formatExcelDate } from "../../lib/format";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

function GrantBreakdown({ session }) {
  const { id } = useParams();
  const { grant, budgetItems, expenses, receiptMap, error, reload: fetchData } =
    useGrantBreakdown(id, session?.userRecord?.id);
  const [expanded, setExpanded] = useState({});

  // Budget item modal state
  const [showBudgetItemModal, setShowBudgetItemModal] = useState(false);
  const [editingBudgetItem, setEditingBudgetItem] = useState(null);

  // Expense modal state
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [activeBudgetItemId, setActiveBudgetItemId] = useState(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState(null); // { title, message, onConfirm }

  const toggleExpanded = (biId) => {
    setExpanded(prev => ({ ...prev, [biId]: !prev[biId] }));
  };

  const handleDeleteBudgetItem = (biId, biName) => {
    setConfirmDialog({
      title: 'Delete Budget Item',
      message: `Delete "${biName}"? All expenses under this budget item will also be permanently deleted.`,
      onConfirm: async () => {
        await deleteBudgetItem(biId);
        setConfirmDialog(null);
        fetchData();
      }
    });
  };

  const handleDeleteExpense = (expId, expName) => {
    setConfirmDialog({
      title: 'Delete Expense',
      message: `Delete "${expName}"?`,
      onConfirm: async () => {
        await deleteExpense(expId);
        setConfirmDialog(null);
        fetchData();
      }
    });
  };

  const handleViewReceipt = async (storagePath) => {
    const signedUrl = await getReceiptSignedUrl(storagePath);
    if (!signedUrl) {
      alert('Could not open receipt. Please try again.');
      return;
    }
    window.open(signedUrl, '_blank');
  };

  if (error) return <div className="detail-error" style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-error)' }}>{error}</div>;
  if (!grant) return <p>Loading grant details...</p>;

  // Grant-level totals — computed from freshly-fetched budgetItems so they
  // update immediately after an expense is added without waiting on stored columns.
  // bi.amount_spent counts only approved expenses (DB trigger filters by status='approved').
  const totalAllocated = budgetItems.reduce((sum, bi) => sum + (bi.budget_allocated || 0), 0);
  const totalSpent = budgetItems.reduce((sum, bi) => sum + (bi.amount_spent || 0), 0);
  const totalPending = expenses
    .filter(e => e.status === 'pending')
    .reduce((sum, e) => sum + (e.amount_spent || 0), 0);
  const totalRemaining = (grant.grant_amount || 0) - totalSpent;
  const percentUsed = grant.grant_amount
    ? Math.min(Math.round((totalSpent / grant.grant_amount) * 100), 100)
    : 0;

  const isFullyAllocated = totalAllocated >= grant.grant_amount;
  const allocatedCardClass = isFullyAllocated ? 'fully-allocated' : '';

  return (
    <div className="grant-breakdown-page">
      {/* Header */}
      <div className="breakdown-header">
        <Link to={`/grants/${id}`} className="back-link">
          <FaArrowLeft /> Back to Grant Details
        </Link>
        <div className="header-title">
          <FaFileInvoiceDollar className="page-icon" />
          <div>
            <h2>{grant.grant_name || `Grant #${grant.id}`} — Breakdown</h2>
            <span className={`status-badge status-${grant.status}`}>
              {grant.status}
            </span>
          </div>
          <div className="header-budget">
            <span className="budget-label">Total Budget</span>
            <span className="budget-amount">${grant.grant_amount?.toLocaleString() || 0}</span>
          </div>
        </div>
      </div>

      {/* Expired grant warning */}
      {grant.end_spend_period && new Date(grant.end_spend_period + 'T23:59:59') < new Date() && (
        <div className="expired-grant-banner">
          <FaClock /> This grant's spend period has ended. You can still add receipts and update records.
        </div>
      )}

      {/* Summary Cards */}
      <div className="breakdown-summary">
        <div className={`summary-card ${allocatedCardClass}`}>
          <div className="card-icon allocated"><FaDollarSign /></div>
          <div className="card-content">
            <span className="card-label">Allocated</span>
            <span className="card-value">${totalAllocated.toLocaleString()}</span>
          </div>
        </div>
        <div className="summary-card">
          <div className="card-icon spent"><FaMoneyBillWave /></div>
          <div className="card-content">
            <span className="card-label">Spent</span>
            <span className="card-value">${totalSpent.toLocaleString()}</span>
            {totalPending > 0 && (
              <span className="card-sub">+ ${totalPending.toLocaleString()} pending</span>
            )}
          </div>
        </div>
        <div className="summary-card">
          <div className="card-icon remaining"><FaChartPie /></div>
          <div className="card-content">
            <span className="card-label">Remaining</span>
            <span className="card-value">${totalRemaining.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="progress-section">
        <div className="progress-header">
          <span>Budget Usage</span>
          <span className="progress-percentage">{percentUsed}%</span>
        </div>
        <div className="progress-bar">
          <div className="fill" style={{ width: `${percentUsed}%` }}></div>
        </div>
      </div>

      {/* Charts */}
      {budgetItems.length > 0 && (() => {
        const CHART_COLORS = ['#9CA3AF','#6B7280','#4B5563','#374151','#1F2937','#D1D5DB'];
        const fmtK = v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

        const budgetPieData = budgetItems
          .map((bi, i) => ({ name: bi.item_name, value: bi.budget_allocated || 0, fill: CHART_COLORS[i % CHART_COLORS.length] }))
          .filter(d => d.value > 0);

        const budgetBarData = budgetItems.map(bi => {
          const spent = expenses
            .filter(e => e.budget_item_id === bi.id && e.status === 'approved')
            .reduce((s, e) => s + (e.amount_spent || 0), 0);
          const pending = expenses
            .filter(e => e.budget_item_id === bi.id && e.status === 'pending')
            .reduce((s, e) => s + (e.amount_spent || 0), 0);
          return { name: bi.item_name, Allocated: bi.budget_allocated || 0, Spent: spent, Pending: pending };
        });

        const barHeight = Math.max(budgetItems.length * 55 + 60, 180);

        return (
          <div className="charts-row">
            <div className="chart-card">
              <p className="chart-card-title">Budget Allocation</p>
              {budgetPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={budgetPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85}>
                      {budgetPieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [`$${v.toLocaleString()}`, name]} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="chart-empty">No allocated amounts yet.</p>
              )}
            </div>
            <div className="chart-card">
              <p className="chart-card-title">Budgeted vs Spent</p>
              <ResponsiveContainer width="100%" height={barHeight}>
                <BarChart data={budgetBarData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v, name) => [`$${v.toLocaleString()}`, name]} />
                  <Legend />
                  <Bar dataKey="Allocated" fill="#065F46" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Spent"     fill="#6B7280" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Pending"   fill="#D89F01" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Budget Items Section */}
      <div className="expense-items-section">
        <div className="section-header">
          <h3><FaLayerGroup /> Budget Items ({budgetItems.length})</h3>
          <button
            className="add-expense-btn"
            onClick={() => { setEditingBudgetItem(null); setShowBudgetItemModal(true); }}
          >
            <FaPlusCircle /> Add Budget Item
          </button>
        </div>

        {budgetItems.length === 0 ? (
          <div className="no-items-message">
            <FaLayerGroup className="empty-icon" />
            <p>No budget items yet. Add one to start tracking expenses.</p>
            <button
              className="add-first-btn"
              onClick={() => { setEditingBudgetItem(null); setShowBudgetItemModal(true); }}
            >
              <FaPlusCircle /> Add Your First Budget Item
            </button>
          </div>
        ) : (
          <div className="budget-items-list">
            {budgetItems.map(bi => {
              const biExpenses = expenses.filter(e => e.budget_item_id === bi.id);
              const isOpen = !!expanded[bi.id];
              const biRemaining = (bi.budget_allocated || 0) - (bi.amount_spent || 0);

              return (
                <div key={bi.id} className="budget-item-block">
                  {/* Budget Item Header Row */}
                  <div className="budget-item-header">
                    <button
                      className="budget-item-toggle"
                      onClick={() => toggleExpanded(bi.id)}
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                    >
                      {isOpen ? <FaChevronDown /> : <FaChevronRight />}
                    </button>

                    <div className="budget-item-info">
                      <div className="budget-item-name-row">
                        {session?.tenantConfig?.type !== 'self_service' && <StatusBadge status={bi.status} iconOnly />}
                        <span className="budget-item-name">{bi.item_name}</span>
                        {session?.tenantConfig?.type !== 'self_service' && (() => {
                          const pendingCount = biExpenses.filter(e => e.status === 'pending').length;
                          const rejectedCount = biExpenses.filter(e => e.status === 'rejected').length;
                          return (
                            <>
                              {pendingCount > 0 && (
                                <span className="bi-expense-indicator pending" title={`${pendingCount} pending expense${pendingCount > 1 ? 's' : ''}`}>
                                  {pendingCount} pending
                                </span>
                              )}
                              {rejectedCount > 0 && (
                                <span className="bi-expense-indicator rejected" title={`${rejectedCount} rejected expense${rejectedCount > 1 ? 's' : ''}`}>
                                  {rejectedCount} rejected
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      {bi.description && (
                        <span className="budget-item-desc" title={bi.description}>
                          {bi.description.length > 45 ? bi.description.slice(0, 45) + '…' : bi.description}
                        </span>
                      )}
                    </div>

                    <div className="budget-item-totals">
                      <span className="bi-stat">
                        <span className="bi-stat-label">Budget</span>
                        <span className="bi-stat-value">${(bi.budget_allocated || 0).toLocaleString()}</span>
                      </span>
                      <span className="bi-stat">
                        <span className="bi-stat-label">Spent</span>
                        <span className="bi-stat-value">${(bi.amount_spent || 0).toLocaleString()}</span>
                      </span>
                      {(() => {
                        const biPending = biExpenses
                          .filter(e => e.status === 'pending')
                          .reduce((s, e) => s + (e.amount_spent || 0), 0);
                        return (
                          <span className="bi-stat" style={{ visibility: biPending > 0 ? 'visible' : 'hidden' }}>
                            <span className="bi-stat-label">Pending</span>
                            <span className="bi-stat-value pending-amount">${biPending.toLocaleString()}</span>
                          </span>
                        );
                      })()}
                      <span className="bi-stat">
                        <span className="bi-stat-label">Remaining</span>
                        <span className={`bi-stat-value ${biRemaining < 0 ? 'over-budget' : ''}`}>
                          ${biRemaining.toLocaleString()}
                        </span>
                      </span>
                      <span className="bi-stat">
                        <span className="bi-stat-label">Expenses</span>
                        <span className="bi-stat-value">{biExpenses.length}</span>
                      </span>
                    </div>

                    <div className="budget-item-actions">
                      <button
                        className="edit-btn"
                        onClick={() => { setEditingBudgetItem(bi); setShowBudgetItemModal(true); }}
                        title="Edit budget item"
                      >
                        <FaEdit />
                      </button>
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteBudgetItem(bi.id, bi.item_name)}
                        title="Delete budget item"
                      >
                        <FaTrash />
                      </button>
                    </div>
                  </div>

                  {/* Expenses (collapsible) */}
                  {isOpen && (
                    <div className="budget-item-body">
                      {biExpenses.length > 0 ? (
                        <div className="expense-table-wrapper">
                          <table className="expense-items-table">
                            <thead>
                              <tr>
                                <th>Item Name</th>
                                <th>Amount Spent</th>
                                <th>Date</th>
                                {session?.tenantConfig?.type !== 'self_service' && <th>Status</th>}
                                <th>Receipt</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {biExpenses.map(exp => {
                                const receipt = receiptMap[exp.id];
                                return (
                                  <tr key={exp.id}>
                                    <td className="item-name">{exp.item_name}</td>
                                    <td className="amount">${(exp.amount_spent || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="date">{formatExcelDate(exp.expense_date)}</td>
                                    {session?.tenantConfig?.type !== 'self_service' && <td className="status-cell"><StatusBadge status={exp.status} iconOnly /></td>}
                                    <td className="receipt-cell">
                                      {receipt ? (
                                        <button
                                          className="receipt-btn"
                                          onClick={() => handleViewReceipt(receipt.path)}
                                          title={receipt.name}
                                        >
                                          <FaReceipt /> <FaExternalLinkAlt className="receipt-ext-icon" />
                                        </button>
                                      ) : (
                                        <span className="no-receipt">—</span>
                                      )}
                                    </td>
                                    <td className="actions">
                                      <button
                                        className="edit-btn"
                                        onClick={() => {
                                          setEditingExpense(exp);
                                          setActiveBudgetItemId(bi.id);
                                          setShowExpenseModal(true);
                                        }}
                                        title="Edit expense"
                                      >
                                        <FaEdit />
                                      </button>
                                      <button
                                        className="delete-btn inline"
                                        onClick={() => handleDeleteExpense(exp.id, exp.item_name)}
                                        title="Delete expense"
                                      >
                                        <FaTrash />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="no-expenses-msg">No expenses yet for this budget item.</p>
                      )}

                      <div className="add-expense-row">
                        <button
                          className="add-expense-btn small"
                          onClick={() => {
                            setEditingExpense(null);
                            setActiveBudgetItemId(bi.id);
                            setShowExpenseModal(true);
                          }}
                        >
                          <FaPlusCircle /> Add Expense
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Budget Item Modal */}
      {showBudgetItemModal && (
        <BudgetItemModal
          grantId={parseInt(id)}
          budgetItem={editingBudgetItem}
          grantAmount={grant.grant_amount || 0}
          totalAllocated={totalAllocated}
          onClose={() => { setShowBudgetItemModal(false); setEditingBudgetItem(null); }}
          onSuccess={fetchData}
          session={session}
        />
      )}

      {/* Confirm Delete Dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Add/Edit Expense Modal */}
      {showExpenseModal && (
        <AddExpenseModal
          grantId={parseInt(id)}
          budgetItemId={activeBudgetItemId}
          budgetItem={budgetItems.find(bi => bi.id === activeBudgetItemId)}
          grantStartDate={grant.start_spend_period}
          grantEndDate={grant.end_spend_period}
          expenseItem={editingExpense}
          existingReceipt={editingExpense ? (receiptMap[editingExpense.id] || null) : null}
          onClose={() => {
            setShowExpenseModal(false);
            setEditingExpense(null);
            setActiveBudgetItemId(null);
          }}
          onSuccess={fetchData}
          session={session}
        />
      )}
    </div>
  );
}

export default GrantBreakdown;
