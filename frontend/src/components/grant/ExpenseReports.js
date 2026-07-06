import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FEATURE_KEYS, hasFeature } from "../../lib/billing";
import { formatDate } from "../../lib/format";
import { useExpenseReports } from "../../hooks/useExpenseReports";
import { exportExpensesExcel } from "./expenseExcel";
import ExpenseCharts from "./ExpenseCharts";
import {
  FaWallet,
  FaMoneyBillWave,
  FaCoins,
  FaFilter,
  FaSort,
  FaSortUp,
  FaSortDown,
  FaCalendarAlt,
  FaSearch,
  FaTimes,
  FaClock,
  FaTimesCircle,
  FaChartBar,
  FaDownload,
  FaFileExcel,
} from 'react-icons/fa';
import './ExpenseReports.css';

function ExpenseReports({ session }) {
  const navigate = useNavigate();
  const { grants, items, budgetItems } = useExpenseReports(session);
  const [selectedGrantFilter, setSelectedGrantFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("expense_date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [exportError, setExportError] = useState("");
  const canExportExcel = hasFeature(session, FEATURE_KEYS.EXCEL_EXPORT);

  // Sorting
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
  };

  const getSortIcon = (column) => {
    if (sortBy !== column) return <FaSort className="sort-icon inactive" />;
    return sortOrder === "asc"
      ? <FaSortUp className="sort-icon active" />
      : <FaSortDown className="sort-icon active" />;
  };

  // Date presets
  const setThisMonth = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(y, today.getMonth() + 1, 0).getDate();
    setDateFrom(`${y}-${m}-01`);
    setDateTo(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
  };

  const setThisQuarter = () => {
    const today = new Date();
    const y = today.getFullYear();
    const q = Math.floor(today.getMonth() / 3);
    const startM = q * 3 + 1;
    const endM = startM + 2;
    const lastDay = new Date(y, endM, 0).getDate();
    setDateFrom(`${y}-${String(startM).padStart(2, '0')}-01`);
    setDateTo(`${y}-${String(endM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`);
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSearchTerm("");
    setSelectedGrantFilter("all");
    setStatusFilter("all");
  };

  // Filtering
  const filteredExpenses = items.filter(item => {
    if (selectedGrantFilter !== "all" && item.grant_id !== parseInt(selectedGrantFilter)) return false;
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (dateFrom && item.expense_date && item.expense_date < dateFrom) return false;
    if (dateTo && item.expense_date && item.expense_date > dateTo) return false;
    if (searchTerm) {
      const name = (item.item_name || "").toLowerCase();
      const grantName = (grants.find(g => g.id === item.grant_id)?.grant_name || "").toLowerCase();
      if (!name.includes(searchTerm.toLowerCase()) && !grantName.includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  });

  // Sorting
  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    switch (sortBy) {
      case "grant_id": {
        const aName = grants.find(g => g.id === a.grant_id)?.grant_name || "";
        const bName = grants.find(g => g.id === b.grant_id)?.grant_name || "";
        return sortOrder === "asc" ? aName.localeCompare(bName) : bName.localeCompare(aName);
      }
      case "item_name": {
        const aVal = (a.item_name || "").toLowerCase();
        const bVal = (b.item_name || "").toLowerCase();
        return sortOrder === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      case "amount_spent":
        return sortOrder === "asc"
          ? (a.amount_spent || 0) - (b.amount_spent || 0)
          : (b.amount_spent || 0) - (a.amount_spent || 0);
      case "expense_date": {
        const aDate = a.expense_date || "";
        const bDate = b.expense_date || "";
        return sortOrder === "asc" ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
      }
      default:
        return 0;
    }
  });

  const hasActiveFilters = dateFrom || dateTo || searchTerm || selectedGrantFilter !== "all" || statusFilter !== "all";
  const isFiltered = sortedExpenses.length !== items.length;

  // Summary stats — approved-only, within the current filtered view (labels say "approved")
  const approvedFiltered = filteredExpenses.filter(i => i.status === 'approved');
  const totalExpenses = approvedFiltered.length;
  const totalSpent = approvedFiltered.reduce((sum, i) => sum + (i.amount_spent || 0), 0);
  const grantsWithExpenses = new Set(approvedFiltered.map(i => i.grant_id)).size;

  function downloadCSV() {
    const header = 'Grant,Expense Item,Amount,Date,Status\n';
    const rows = sortedExpenses.map(item => {
      const grantName = (grants.find(g => g.id === item.grant_id)?.grant_name || '').replace(/,/g, ' ');
      const name = (item.item_name || '').replace(/,/g, ' ');
      const amount = item.amount_spent || 0;
      const date = item.expense_date || '';
      const status = item.status || '';
      return `${grantName},${name},${amount},${date},${status}`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expense-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadExcel() {
    if (!canExportExcel) {
      navigate('/subscription');
      return;
    }
    const result = await exportExpensesExcel({ sortedExpenses, grants, budgetItems, dateFrom, dateTo });
    setExportError(result?.error || "");
  }

  return (
    <section className="expenses-landing">
      <h2 className="page-title">Expense Reports</h2>

      {/* Summary strip — reflects current filter */}
      <div className="grants-stat-strip">
        {hasActiveFilters && (
          <span className="chip-filter-note">Filtered view</span>
        )}
        <div className="stat-chip">
          <FaMoneyBillWave className="chip-icon" />
          <span className="chip-value">{totalExpenses}</span>
          <span className="chip-label">approved expenses</span>
        </div>
        <span className="chip-divider" />
        <div className="stat-chip">
          <FaCoins className="chip-icon" />
          <span className="chip-value">${totalSpent.toLocaleString()}</span>
          <span className="chip-label">total spent (approved)</span>
        </div>
        <span className="chip-divider" />
        <div className="stat-chip">
          <FaWallet className="chip-icon" />
          <span className="chip-value">{grantsWithExpenses}</span>
          <span className="chip-label">grants with approved expenses</span>
        </div>
      </div>

      {/* Charts */}
      {items.length > 0 && <ExpenseCharts items={items} grants={grants} />}

      {/* Filter bar */}
      <div className="expense-filters-bar">

        {/* Search */}
        <div className="ef-search-box">
          <FaSearch className="ef-search-icon" />
          <input
            type="text"
            placeholder="Search by item or grant..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Grant filter */}
        <div className="ef-group">
          <FaFilter className="ef-group-icon" />
          <select
            value={selectedGrantFilter}
            onChange={e => setSelectedGrantFilter(e.target.value)}
          >
            <option value="all">All Grants</option>
            {[...grants].sort((a, b) => (a.grant_name || '').localeCompare(b.grant_name || '')).map(grant => (
              <option key={grant.id} value={grant.id}>
                {grant.grant_name || `Grant #${grant.id}`}
              </option>
            ))}
          </select>
        </div>

        {/* Status filter */}
        <div className="ef-group">
          <FaFilter className="ef-group-icon" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {/* Date range */}
        <div className="ef-group">
          <FaCalendarAlt className="ef-group-icon" />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            title="From date"
          />
          <span className="ef-date-sep">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            title="To date"
          />
        </div>

        {/* Quick presets */}
        <div className="ef-presets">
          <button className="ef-preset-btn" onClick={setThisMonth}>This Month</button>
          <button className="ef-preset-btn" onClick={setThisQuarter}>This Quarter</button>
          {hasActiveFilters && (
            <button className="ef-preset-btn ef-clear-btn" onClick={clearFilters}>
              <FaTimes /> Clear
            </button>
          )}
        </div>

      </div>

      {/* Table */}
      <div className="expense-first-view">
        <div className="expenses-list">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>
              Expense Items ({sortedExpenses.length}
              {isFiltered ? ` of ${items.length}` : ''})
            </h3>
            {sortedExpenses.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {canExportExcel ? (
                  <button
                    onClick={downloadExcel}
                    className="admin-approve-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4em', fontSize: '0.85rem' }}
                  >
                    <FaFileExcel size={13} /> Export Excel
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('/subscription')}
                    className="admin-approve-btn"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4em', fontSize: '0.85rem', opacity: 0.95 }}
                  >
                    <FaFileExcel size={13} /> View Subscription
                  </button>
                )}
                <button
                  onClick={downloadCSV}
                  className="admin-approve-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4em', fontSize: '0.85rem' }}
                >
                  <FaDownload size={13} /> Export CSV
                </button>
              </div>
            )}
          </div>
          {exportError && (
            <p style={{ color: 'var(--color-error)', fontSize: '0.85rem', margin: '0.5em 0 0', textAlign: 'right' }}>
              {exportError}
            </p>
          )}
          {sortedExpenses.length > 0 ? (
            <table className="expenses-table-main">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort("grant_id")}>
                    Grant {getSortIcon("grant_id")}
                  </th>
                  <th className="sortable" onClick={() => handleSort("item_name")}>
                    Expense {getSortIcon("item_name")}
                  </th>
                  <th className="sortable" onClick={() => handleSort("amount_spent")}>
                    Amount Spent {getSortIcon("amount_spent")}
                  </th>
                  <th className="sortable" onClick={() => handleSort("expense_date")} style={{ textAlign: 'right' }}>
                    Date {getSortIcon("expense_date")}
                  </th>
                  <th title="Items pending admin approval"></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedExpenses.map(item => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/grants/${item.grant_id}/breakdown`} className="grant-badge-link">
                        <span className="grant-badge" title={grants.find(g => g.id === item.grant_id)?.grant_name || ''}>
                          {grants.find(g => g.id === item.grant_id)?.grant_name || `Grant #${item.grant_id}`}
                        </span>
                      </Link>
                    </td>
                    <td className="item-name">{item.item_name || '—'}</td>
                    <td className="amount">${(item.amount_spent || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="date">{formatDate(item.expense_date)}</td>
                    <td className="er-status-cell">
                      {item.status === 'pending' && (
                        <span className="status-icon status-icon-pending" title="Has budget items or expenses pending admin approval">
                          <FaClock />
                        </span>
                      )}
                      {item.status === 'rejected' && (
                        <span className="status-icon status-icon-rejected" title="Rejected">
                          <FaTimesCircle />
                        </span>
                      )}
                    </td>
                    <td className="er-action-cell">
                      <Link to={`/grants/${item.grant_id}/breakdown`} className="er-action-btn" title="View in breakdown">
                        <FaChartBar />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="no-expenses">
              {items.length === 0
                ? 'No expenses recorded yet.'
                : 'No expenses match the current filters.'}
            </p>
          )}
        </div>
      </div>

    </section>
  );
}

export default ExpenseReports;
