import React, { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { filterSortGrants } from "../../utils/grantsList";
import { formatDate } from "../../lib/format";
import {
  FaFileAlt,
  FaClock,
  FaCheckCircle,
  FaDollarSign,
  FaSearch,
  FaPlus,
  FaCalendarAlt,
  FaInfoCircle,
  FaExclamationTriangle,
  FaTimesCircle,
  FaTh,
  FaList,
  FaChartBar,
} from 'react-icons/fa';
import './Grants.css';


function timeRemaining(endDateStr) {
  if (!endDateStr) return { display: '—', cls: '' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(endDateStr + 'T00:00:00');
  const days = Math.round((end - today) / 86400000);
  if (days < 0)  return { display: 'Expired', cls: 'expired' };
  if (days === 0) return { display: 'Last day!', cls: 'warning' };
  if (days < 30)  return { display: `${days}d left`, cls: 'warning' };
  const months = Math.floor(days / 30);
  const rem = days % 30;
  const display = rem > 0 ? `${months}mo ${rem}d left` : `${months}mo left`;
  return { display, cls: days < 90 ? 'warning' : '' };
}

function Grants({ session }) {
  const [searchParams] = useSearchParams();
  const [grants, setGrants] = useState([]);
  const [grantsWithPendingItems, setGrantsWithPendingItems] = useState(new Set());
  const [filter, setFilter] = useState(searchParams.get('status') || 'all');
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("start_spend_period");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState("table");
  const [hideExpired, setHideExpired] = useState(false);
  const grantsPerPage = viewMode === 'card' ? 6 : 10;
  const sectionRef = useRef(null);

  useEffect(() => {
    async function fetchGrants() {
      if (!session?.userRecord) return;

      const { data, error } = await supabase
        .from("grant_record")
        .select("*")
        .eq("user_id", session.userRecord.id);

      if (!error && data) {
        setGrants(data);
        const grantIds = data.map(g => g.id);
        if (grantIds.length > 0) {
          const [{ data: pendingBi }, { data: pendingExp }] = await Promise.all([
            supabase.from('budget_items').select('grant_id').in('grant_id', grantIds).neq('status', 'approved'),
            supabase.from('expenses').select('grant_id').in('grant_id', grantIds).neq('status', 'approved'),
          ]);
          setGrantsWithPendingItems(new Set([
            ...(pendingBi || []).map(r => r.grant_id),
            ...(pendingExp || []).map(r => r.grant_id),
          ]));
        }
      }
    }

    fetchGrants();
  }, [session]);

  // Filter (status tab + expired toggle), search, and sort — see grantsList util.
  const sortedGrants = filterSortGrants(grants, { filter, searchTerm, sortBy, hideExpired });

  // Pagination
  const indexOfLastGrant = currentPage * grantsPerPage;
  const indexOfFirstGrant = indexOfLastGrant - grantsPerPage;
  const currentGrants = sortedGrants.slice(indexOfFirstGrant, indexOfLastGrant);
  const totalPages = Math.ceil(sortedGrants.length / grantsPerPage);

  // Calculate summary statistics
  const stats = {
    totalGrants: grants.length,
    activeGrants: grants.filter(g => g.status?.toLowerCase() === 'approved').length,
    totalFunding: grants.reduce((sum, g) => sum + (g.grant_amount || 0), 0),
    totalSpent: grants.reduce((sum, g) => sum + (g.total_spent || 0), 0),
    pendingGrants: grants.filter(g => g.status?.toLowerCase() === 'pending').length,
    needsChangesGrants: grants.filter(g => g.status?.toLowerCase() === 'needs_changes').length,
    rejectedGrants: grants.filter(g => g.status?.toLowerCase() === 'rejected').length,
  };

  return (
    <div className="grants-page">
      <div className="grants-page-header">
        <h2 className="grants-page-title">My Grant Applications</h2>
      </div>

      {/* Summary strip */}
      <div className="grants-stat-strip">
        <div className="stat-chip">
          <FaFileAlt className="chip-icon" />
          <span className="chip-value">{stats.totalGrants}</span>
          <span className="chip-label">grants</span>
        </div>
        <span className="chip-divider" />
        <div className="stat-chip">
          <FaCheckCircle className="chip-icon active" />
          <span className="chip-value">{stats.activeGrants}</span>
          <span className="chip-label">approved</span>
        </div>
        {stats.pendingGrants > 0 && (
          <>
            <span className="chip-divider" />
            <div className="stat-chip">
              <FaClock className="chip-icon pending" />
              <span className="chip-value">{stats.pendingGrants}</span>
              <span className="chip-label">pending</span>
            </div>
          </>
        )}
        {stats.needsChangesGrants > 0 && (
          <>
            <span className="chip-divider" />
            <div className="stat-chip">
              <FaExclamationTriangle className="chip-icon needs-changes" />
              <span className="chip-value">{stats.needsChangesGrants}</span>
              <span className="chip-label">needs changes</span>
            </div>
          </>
        )}
        {stats.rejectedGrants > 0 && (
          <>
            <span className="chip-divider" />
            <div className="stat-chip">
              <FaTimesCircle className="chip-icon rejected" />
              <span className="chip-value">{stats.rejectedGrants}</span>
              <span className="chip-label">rejected</span>
            </div>
          </>
        )}
        <span className="chip-divider" />
        <div className="stat-chip">
          <FaDollarSign className="chip-icon" />
          <span className="chip-value">${stats.totalFunding.toLocaleString()}</span>
          <span className="chip-label">total funding</span>
        </div>
        <span className="chip-divider" />
        <div className="stat-chip">
          <FaDollarSign className="chip-icon" />
          <span className="chip-value">${stats.totalSpent.toLocaleString()}</span>
          <span className="chip-label">spent</span>
        </div>
      </div>

      <section ref={sectionRef}>
        {/* Toolbar */}
        <div className="grants-toolbar">
          <div className="left-tools">
            <div className="search-box">
              <FaSearch className="search-icon" />
              <input
                type="text"
                placeholder="Search grants..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="start_spend_period">Sort by Start Date</option>
              <option value="grant_amount">Sort by Amount</option>
              <option value="status">Sort by Status</option>
            </select>
          </div>
          <div className="right-tools">
            <div className="view-toggle-btns">
              <button
                className={`view-toggle-btn${hideExpired ? ' active' : ''}`}
                onClick={() => { setHideExpired(v => !v); setCurrentPage(1); }}
                title="Hide expired grants"
                style={{ fontSize: '0.8rem', padding: '0.4em 0.8em', whiteSpace: 'nowrap' }}
              >
                {hideExpired ? 'Show Expired' : 'Hide Expired'}
              </button>
              <button
                className={`view-toggle-btn${viewMode === 'card' ? ' active' : ''}`}
                onClick={() => { setViewMode('card'); setCurrentPage(1); }}
                title="Card view"
              >
                <FaTh />
              </button>
              <button
                className={`view-toggle-btn${viewMode === 'table' ? ' active' : ''}`}
                onClick={() => { setViewMode('table'); setCurrentPage(1); }}
                title="Table view"
              >
                <FaList />
              </button>
            </div>
            <Link to="/grants/new" className="new-grant-btn">
              <FaPlus /> New Grant
            </Link>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="tabs">
          {(session?.tenantConfig?.type === 'self_service'
            ? ["all", "approved"]
            : ["all", "pending", "approved", "needs_changes", "rejected"]
          ).map((status) => (
            <button
              key={status}
              onClick={() => {
                setFilter(status);
                setCurrentPage(1);
              }}
              className={filter === status ? "active-tab" : ""}
            >
              {status === 'needs_changes' ? 'Needs Changes' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Grant Cards */}
        {viewMode === 'card' ? (
          <div className="grants-grid">
            {currentGrants.map((grant) => {
              const percentUsed = grant.grant_amount
                ? Math.round(((grant.disbursed_funds || 0) / grant.grant_amount) * 100)
                : 0;
              const { display: timeDisplay, cls: timeCls } = timeRemaining(grant.end_spend_period);

              return (
                <div key={grant.id} className="grant-card grants-grant-card">
                  <div className="grant-card-header">
                    <div className="grant-icon">
                      <FaFileAlt />
                    </div>
                    <div className="grant-title-section">
                      <Link to={`/grants/${grant.id}`} className="grant-title-link">
                        {grant.grant_name || `Grant #${grant.id}`}
                      </Link>
                      <span className={`status-badge status-${grant.status?.toLowerCase()}`}>
                        {grant.status === 'needs_changes' ? 'Needs Changes' : grant.status}
                      </span>
                      {grantsWithPendingItems.has(grant.id) && (
                        <span className="grant-pending-flag" title="Has budget items or expenses pending admin approval">
                          <FaClock />
                        </span>
                      )}
                    </div>
                    <div className="card-header-actions">
                      <Link
                        to={`/grants/${grant.id}`}
                        className="grant-expand-toggle"
                        title="View grant details"
                      >
                        <FaInfoCircle />
                      </Link>
                      <Link
                        to={`/grants/${grant.id}/breakdown`}
                        className="grant-expand-toggle"
                        title="View expenses"
                      >
                        <FaChartBar />
                      </Link>
                    </div>
                  </div>

                  <div className="grant-card-body">
                    <div className="grant-info-row">
                      <span className="info-label">Grant Amount</span>
                      <span className="info-value">${grant.grant_amount?.toLocaleString()}</span>
                    </div>
                    <div className="grant-info-row">
                      <span className="info-label">Disbursed</span>
                      <span className="info-value spent">${(grant.disbursed_funds || 0).toLocaleString()}</span>
                    </div>
                    <div className="grant-info-row">
                      <span className="info-label">Total Spent</span>
                      <span className="info-value spent">${(grant.total_spent || 0).toLocaleString()}</span>
                    </div>
                    <div className="grant-info-row">
                      <span className="info-label">Remaining</span>
                      <span className="info-value remaining">${(grant.remaining_balance || 0).toLocaleString()}</span>
                    </div>

                    <div className="grant-dates">
                      <div className="date-item">
                        <FaCalendarAlt className="date-icon" />
                        <div>
                          <span className="date-label">Start</span>
                          <span className="date-value">
                            {grant.start_spend_period ? formatDate(grant.start_spend_period) : 'N/A'}
                          </span>
                        </div>
                      </div>
                      <div className="date-item">
                        <FaCalendarAlt className="date-icon" />
                        <div>
                          <span className="date-label">End</span>
                          <span className="date-value">
                            {grant.end_spend_period ? formatDate(grant.end_spend_period) : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="progress-section">
                      <div className="progress-row">
                        <div className="progress-half">
                          <p className="progress-half-label">Disbursed</p>
                          <div className="progress-bar">
                            <div className="fill" style={{ width: `${percentUsed}%` }}></div>
                          </div>
                          <p className="progress-text">{percentUsed}%</p>
                        </div>
                        <div className="progress-half time-half">
                          <p className="progress-half-label">Time Remaining</p>
                          <p className={`time-stat${timeCls ? ` ${timeCls}` : ''}`}>{timeDisplay}</p>
                        </div>
                      </div>
                    </div>

                  </div>

                </div>
              );
            })}
          </div>
        ) : (
          /* Table view */
          <div className="grants-table-wrapper">
            <table className="grants-table">
              <thead>
                <tr>
                  <th>Grant Name</th>
                  <th>Status</th>
                  <th className="gt-th-right">Amount</th>
                  <th className="gt-th-right">Disbursed</th>
                  <th className="gt-th-right">Spent</th>
                  <th className="gt-th-right">Remaining</th>
                  <th>Spend Period</th>
                  <th>Time Left</th>
                  <th title="Items pending admin approval"></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {currentGrants.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="gt-empty-cell">No grants found.</td>
                  </tr>
                ) : (
                  currentGrants.map((grant) => {
                    const { display: timeDisplay, cls: timeCls } = timeRemaining(grant.end_spend_period);
                    return (
                      <tr key={grant.id}>
                        <td className="gt-name-cell">
                          <Link to={`/grants/${grant.id}`} className="gt-name-link">
                            {grant.grant_name || `Grant #${grant.id}`}
                          </Link>
                        </td>
                        <td>
                          <span className={`status-badge status-${grant.status?.toLowerCase()}`}>
                            {grant.status === 'needs_changes' ? 'Needs Changes' : grant.status}
                          </span>
                        </td>
                        <td className="gt-amount-cell">${(grant.grant_amount || 0).toLocaleString()}</td>
                        <td className="gt-amount-cell">${(grant.disbursed_funds || 0).toLocaleString()}</td>
                        <td className="gt-amount-cell">${(grant.total_spent || 0).toLocaleString()}</td>
                        <td className="gt-remaining-cell">${(grant.remaining_balance || 0).toLocaleString()}</td>
                        <td className="gt-period-cell">
                          {formatDate(grant.start_spend_period)} – {formatDate(grant.end_spend_period)}
                        </td>
                        <td className={`gt-time-cell${timeCls ? ` ${timeCls}` : ''}`}>{timeDisplay}</td>
                        <td className="gt-pending-cell">
                          {grantsWithPendingItems.has(grant.id) && (
                            <span className="grant-pending-flag" title="Has budget items or expenses pending admin approval">
                              <FaClock />
                            </span>
                          )}
                        </td>
                        <td className="gt-actions-cell">
                          <Link to={`/grants/${grant.id}`} className="gt-action-btn detail" title="Grant details">
                            <FaInfoCircle />
                          </Link>
                          <Link to={`/grants/${grant.id}/breakdown`} className="gt-action-btn expenses" title="View expenses">
                            <FaChartBar />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="pagination">
          <button
            onClick={() => {
              setCurrentPage((prev) => Math.max(prev - 1, 1));
              sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            disabled={currentPage === 1}
          >
            Previous
          </button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => {
              setCurrentPage((prev) => Math.min(prev + 1, totalPages));
              sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            disabled={currentPage === totalPages}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}


export default Grants;