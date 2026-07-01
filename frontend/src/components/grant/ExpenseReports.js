import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { FEATURE_KEYS, hasFeature } from "../../lib/billing";
import { formatDate } from "../../lib/format";
import { formatExcelDate } from "../../lib/format";
import { useExpenseReports } from "../../hooks/useExpenseReports";
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
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function toDateOnly(value) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMonthKey(value) {
  const date = toDateOnly(value);
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabelFromKey(key) {
  const [year, month] = key.split('-');
  return `${MONTHS[parseInt(month, 10) - 1]}-${year.slice(2)}`;
}

function toSafeSheetName(baseName, usedNames) {
  const sanitized = (baseName || 'Sheet')
    .replace(/[\\/*?:]|\[|\]/g, '-')
    .trim()
    .slice(0, 31) || 'Sheet';

  if (!usedNames.has(sanitized)) {
    usedNames.add(sanitized);
    return sanitized;
  }

  let counter = 2;
  while (counter < 1000) {
    const suffix = `-${counter}`;
    const candidate = `${sanitized.slice(0, 31 - suffix.length)}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }

  const fallback = `Sheet-${Date.now()}`.slice(0, 31);
  usedNames.add(fallback);
  return fallback;
}


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

  function downloadExcel() {
    if (!canExportExcel) {
      navigate('/subscription');
      return;
    }

    if (sortedExpenses.length === 0) {
      alert('No expenses found for export.');
      return;
    }

    const selectedStart = toDateOnly(dateFrom);
    const selectedEnd = toDateOnly(dateTo);

    if (selectedStart && selectedEnd && selectedStart > selectedEnd) {
      alert('Start date must be on or before end date.');
      return;
    }

    const filteredForExport = sortedExpenses.filter(exp => {
      const expDate = toDateOnly(exp.expense_date);
      if (!expDate) return false;
      if (selectedStart && expDate < selectedStart) return false;
      if (selectedEnd && expDate > selectedEnd) return false;
      return true;
    });

    if (filteredForExport.length === 0) {
      alert('No expenses found in the selected date range.');
      return;
    }

    const sortedByDate = [...filteredForExport].sort((a, b) => {
      const aTime = toDateOnly(a.expense_date)?.getTime() || 0;
      const bTime = toDateOnly(b.expense_date)?.getTime() || 0;
      return aTime - bTime;
    });

    const expensesByMonth = new Map();
    sortedByDate.forEach((exp) => {
      const monthKey = toMonthKey(exp.expense_date);
      if (!monthKey) return;
      if (!expensesByMonth.has(monthKey)) expensesByMonth.set(monthKey, []);
      expensesByMonth.get(monthKey).push(exp);
    });

    if (expensesByMonth.size === 0) {
      alert('No expenses found in the selected date range.');
      return;
    }

    const monthKeys = Array.from(expensesByMonth.keys()).sort();
    const grantById = new Map(grants.map(g => [g.id, g]));
    const budgetItemById = new Map(budgetItems.map(bi => [bi.id, bi]));

    const runningTotalByExpenseId = new Map();
    let runningAcrossRange = 0;
    sortedByDate.forEach((exp) => {
      const expAmount = Number(exp.amount_spent || 0);
      runningAcrossRange += expAmount;
      runningTotalByExpenseId.set(exp.id, runningAcrossRange);
    });

    const trailingLabels = [
      'Expense Date',
      'Amount Spent to date for project',
      'Actual expenditure',
      'Total Expenditures',
      'Available Amount / Grant',
      'Budgeted per expenditure',
      'Difference (Budget vs Actual)',
      'Other Expenditures Comment',
    ];
    const trailingStartCol = 9;
    const totalCols = trailingStartCol + trailingLabels.length;

    const headerRow1 = new Array(totalCols).fill('');
    const headerRow2 = new Array(totalCols).fill('');

    headerRow1[0] = 'Funding Source';
    headerRow1[1] = 'Effective Dates';
    headerRow2[1] = 'Start';
    headerRow2[2] = 'End';
    headerRow1[3] = 'Identification';
    headerRow2[3] = 'Project Title';
    headerRow1[4] = 'Total Grant Amount';
    headerRow2[4] = 'Budgeted';
    headerRow2[5] = 'Received';
    headerRow1[6] = 'Balance';
    headerRow2[6] = 'Forwarded from previous year';
    headerRow2[7] = 'Available for Period';
    headerRow1[8] = 'Expenditures';
    headerRow2[8] = 'Expenditures';

    trailingLabels.forEach((label, index) => {
      const col = trailingStartCol + index;
      headerRow1[col] = label;
    });

    const workbook = XLSX.utils.book_new();
    const usedSheetNames = new Set();

    monthKeys.forEach((monthKey) => {
      const monthExpenses = expensesByMonth.get(monthKey) || [];

      const dataRows = monthExpenses.map((exp) => {
        const grant = grantById.get(exp.grant_id);
        const budgetItem = budgetItemById.get(exp.budget_item_id);
        const expAmount = Number(exp.amount_spent || 0);
        const runningTotal = runningTotalByExpenseId.get(exp.id) || 0;
        const budgetAllocated = Number(budgetItem?.budget_allocated || 0);
        const budgetItemSpent = Number(budgetItem?.amount_spent || 0);

        const projectGrantTotal = Number(grant?.grant_amount || 0);
        const projectTotalSpent = Number(grant?.total_spent || 0);
        const projectReceived = Number(grant?.disbursed_funds || 0);
        const periodStart = dateFrom || grant?.start_spend_period || '';
        const periodEnd = dateTo || grant?.end_spend_period || '';

        return [
          grant?.grant_name || `Grant #${exp.grant_id}`,
          formatExcelDate(periodStart),
          formatExcelDate(periodEnd),
          budgetItem?.item_name || grant?.grant_name || `Grant #${exp.grant_id}`,
          projectGrantTotal,
          projectReceived,
          0,
          projectGrantTotal,
          exp.item_name || '',
          formatExcelDate(exp.expense_date),
          runningTotal,
          expAmount,
          projectTotalSpent || runningTotal,
          projectGrantTotal - runningTotal,
          budgetAllocated,
          budgetAllocated - budgetItemSpent,
          budgetItem?.description || '',
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([headerRow1, headerRow2, ...dataRows]);

      const merges = [
        { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
        { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } },
        { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
        { s: { r: 0, c: 4 }, e: { r: 0, c: 5 } },
        { s: { r: 0, c: 6 }, e: { r: 0, c: 7 } },
        { s: { r: 0, c: 8 }, e: { r: 1, c: 8 } },
      ];

      trailingLabels.forEach((_, index) => {
        const c = trailingStartCol + index;
        merges.push({ s: { r: 0, c }, e: { r: 1, c } });
      });

      ws['!merges'] = merges;
      ws['!cols'] = [
        { wch: 24 },
        { wch: 12 },
        { wch: 12 },
        { wch: 28 },
        { wch: 13 },
        { wch: 12 },
        { wch: 16 },
        { wch: 16 },
        { wch: 36 },
        { wch: 12 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 16 },
        { wch: 18 },
        { wch: 22 },
        { wch: 28 },
      ];

      const sheetLabel = monthLabelFromKey(monthKey);
      const sheetName = toSafeSheetName(sheetLabel, usedSheetNames);
      XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    });

    const fileSuffix = [dateFrom || 'all', dateTo || 'all'].join('_to_');
    XLSX.writeFile(workbook, `expense-report-excel_${fileSuffix}.xlsx`);
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
      {items.length > 0 && (() => {
        const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const CHART_COLORS = ['#8c564b','#d62728','#ff7f0e', '#bcbd22','#065F46','#2ca02c','#1f77b4', '#9467bd'];
        const fmtK = v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

        // Monthly spending
        const monthlyMap = {};
        items.forEach(item => {
          if (!item.expense_date) return;
          const [y, m] = item.expense_date.split('-');
          const key = `${y}-${m}`;
          monthlyMap[key] = (monthlyMap[key] || 0) + (item.amount_spent || 0);
        });
        const monthlyData = Object.entries(monthlyMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, total]) => {
            const [y, mo] = key.split('-');
            return { month: `${MONTHS_SHORT[parseInt(mo, 10) - 1]} ${y}`, total };
          });

        // Spending by grant — O(n) pre-aggregation, capped at top 8 + "Other"
        const spendingByGrantId = items.reduce((acc, it) => {
          acc[it.grant_id] = (acc[it.grant_id] || 0) + (it.amount_spent || 0);
          return acc;
        }, {});

        const TOP_N = 8;
        const grantSpending = grants
          .map(g => ({ name: g.grant_name || `Grant #${g.id}`, value: spendingByGrantId[g.id] || 0 }))
          .filter(d => d.value > 0)
          .sort((a, b) => b.value - a.value);

        const byGrantData = grantSpending.length <= TOP_N
          ? grantSpending.map((d, i) => ({ ...d, fill: CHART_COLORS[i % CHART_COLORS.length] }))
          : [
              ...grantSpending.slice(0, TOP_N).map((d, i) => ({ ...d, fill: CHART_COLORS[i % CHART_COLORS.length] })),
              {
                name: `Other (${grantSpending.length - TOP_N})`,
                value: grantSpending.slice(TOP_N).reduce((s, d) => s + d.value, 0),
                fill: '#D1D5DB',
              },
            ];

        return (
          <div className="charts-row">
            <div className="chart-card">
              <p className="chart-card-title">Monthly Spending</p>
              {monthlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthlyData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} tickMargin={10} />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={v => [`$${v.toLocaleString()}`, 'Spent']} />
                    <Bar dataKey="total" fill="#063F1E" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="chart-empty">No dated expenses yet.</p>
              )}
            </div>
            <div className="chart-card">
              <p className="chart-card-title">Spending by Grant</p>
              {byGrantData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={byGrantData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90}>
                      {byGrantData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [`$${v.toLocaleString()}`, name]} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="chart-empty">No expense data yet.</p>
              )}
            </div>
          </div>
        );
      })()}

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
