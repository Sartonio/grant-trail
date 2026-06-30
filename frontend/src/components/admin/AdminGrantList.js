// src/components/AdminGrantList.js
import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { FiSearch, FiArrowRight, FiArrowLeft, FiClock, FiArrowUp, FiArrowDown, FiDownload } from 'react-icons/fi';
import StatusBadge from '../common/StatusBadge';
import ReadOnlyBanner from '../common/ReadOnlyBanner';
import { formatDateMed, formatCurrency } from '../../lib/format';
import './Admin.css';

const TABS = [
  { key: 'all',           label: 'All' },
  { key: 'approved',      label: 'Approved' },
  { key: 'pending',       label: 'Pending' },
  { key: 'needs_changes', label: 'Needs Changes' },
  { key: 'rejected',      label: 'Rejected' },
];

function AdminGrantList({ readOnly = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [grants, setGrants]   = useState([]);
  const [pendingBiCounts, setPendingBiCounts] = useState({});
  const [pendingExpCounts, setPendingExpCounts] = useState({});
  const [pendingFilter, setPendingFilter] = useState(searchParams.get('pending') || ''); // '', 'budgets', 'expenses', 'all'
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [sortBy, setSortBy]   = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hideExpired, setHideExpired] = useState(false);

  const activeTab = searchParams.get('status') || 'all';

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data, error: err } = await supabase
          .from('grant_record')
          .select('id, grant_name, grant_amount, status, created_at, end_spend_period, user_id, users(firstname, lastname, organization_name)')
          .order('created_at', { ascending: false });

        if (err) throw err;
        setGrants(data || []);

        const grantIds = (data || []).map(g => g.id);
        if (grantIds.length > 0) {
          const [{ data: pendingBi }, { data: pendingExp }] = await Promise.all([
            supabase.from('budget_items').select('grant_id').in('grant_id', grantIds).eq('status', 'pending'),
            supabase.from('expenses').select('grant_id').in('grant_id', grantIds).neq('status', 'approved'),
          ]);
          const biMap = {};
          (pendingBi || []).forEach(r => { biMap[r.grant_id] = (biMap[r.grant_id] || 0) + 1; });
          setPendingBiCounts(biMap);

          const expMap = {};
          (pendingExp || []).forEach(r => { expMap[r.grant_id] = (expMap[r.grant_id] || 0) + 1; });
          setPendingExpCounts(expMap);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Count per status for tab badges
  const counts = grants.reduce((acc, g) => {
    acc[g.status] = (acc[g.status] || 0) + 1;
    return acc;
  }, {});

  const filtered = grants.filter(g => {
    if (activeTab !== 'all' && g.status !== activeTab) return false;
    if (pendingFilter === 'budgets' && !pendingBiCounts[g.id]) return false;
    if (pendingFilter === 'expenses' && !pendingExpCounts[g.id]) return false;
    if (pendingFilter === 'all' && !pendingBiCounts[g.id] && !pendingExpCounts[g.id]) return false;
    if (search) {
      const q = search.toLowerCase();
      const name    = (g.grant_name || '').toLowerCase();
      const org     = (g.users?.organization_name || '').toLowerCase();
      const grantee = `${g.users?.firstname || ''} ${g.users?.lastname || ''}`.toLowerCase();
      if (!name.includes(q) && !org.includes(q) && !grantee.includes(q)) return false;
    }
    if (dateFrom && g.created_at) {
      const localDate = new Date(g.created_at).toLocaleDateString('en-CA');
      if (localDate < dateFrom) return false;
    }
    if (dateTo && g.created_at) {
      const localDate = new Date(g.created_at).toLocaleDateString('en-CA');
      if (localDate > dateTo) return false;
    }
    if (hideExpired && g.end_spend_period && new Date(g.end_spend_period + 'T23:59:59') < new Date()) return false;
    return true;
  });

  const fmt = n => formatCurrency(n, 0);

  const formatDate = formatDateMed;

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

  function handleSort(col) {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  }

  function SortIcon({ col }) {
    if (sortBy !== col) return null;
    return sortDir === 'asc' ? <FiArrowUp className="sort-arrow" /> : <FiArrowDown className="sort-arrow" />;
  }

  const sorted = [...filtered].sort((a, b) => {
    let aVal, bVal;
    switch (sortBy) {
      case 'grant_name':
        aVal = (a.grant_name || '').toLowerCase();
        bVal = (b.grant_name || '').toLowerCase();
        break;
      case 'grantee':
        aVal = `${a.users?.firstname || ''} ${a.users?.lastname || ''}`.toLowerCase();
        bVal = `${b.users?.firstname || ''} ${b.users?.lastname || ''}`.toLowerCase();
        break;
      case 'organization':
        aVal = (a.users?.organization_name || '').toLowerCase();
        bVal = (b.users?.organization_name || '').toLowerCase();
        break;
      case 'grant_amount':
        aVal = a.grant_amount || 0;
        bVal = b.grant_amount || 0;
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      case 'status':
        aVal = a.status || '';
        bVal = b.status || '';
        break;
      case 'end_spend_period':
        aVal = a.end_spend_period || '';
        bVal = b.end_spend_period || '';
        break;
      case 'created_at':
      default:
        aVal = a.created_at || '';
        bVal = b.created_at || '';
        break;
    }
    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  function downloadCSV() {
    const header = 'Grant Name,Grantee,Organization,Amount,Status,Submitted,Total Spent,Remaining\n';
    const rows = sorted.map(g => {
      const name = (g.grant_name || '').replace(/,/g, ' ');
      const grantee = `${g.users?.firstname || ''} ${g.users?.lastname || ''}`.trim().replace(/,/g, ' ');
      const org = (g.users?.organization_name || '').replace(/,/g, ' ');
      const amount = g.grant_amount || 0;
      const status = g.status || '';
      const submitted = g.submitted_at ? new Date(g.submitted_at).toLocaleDateString() : '';
      const spent = g.total_spent || 0;
      const remaining = g.remaining_balance || 0;
      return `${name},${grantee},${org},${amount},${status},${submitted},${spent},${remaining}`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `grants-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleTabClick(key) {
    if (key === 'all') {
      searchParams.delete('status');
      setSearchParams(searchParams);
    } else {
      setSearchParams({ status: key });
    }
  }

  return (
    <div className="admin-page">
      <ReadOnlyBanner readOnly={readOnly} />
      <div className="admin-header">
        <div>
          <h2 className="admin-title">All Grants</h2>
          <p className="admin-subtitle">Review and manage all grant applications</p>
        </div>
        <div style={{ display: 'flex', gap: '1em', alignItems: 'center' }}>
          {sorted.length > 0 && (
            <button
              onClick={downloadCSV}
              className="admin-approve-btn"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4em', fontSize: '0.85rem' }}
            >
              <FiDownload size={14} /> Export CSV
            </button>
          )}
          <Link to="/admin" className="admin-back-link">
            <FiArrowLeft /> Dashboard
          </Link>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-search-box">
          <FiSearch className="admin-search-icon" />
          <input
            type="text"
            placeholder="Search grants…"
            title="Search by grant name, grantee, or organization"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <button
          className={`admin-pending-filter-btn${pendingFilter === 'budgets' ? ' active' : ''}`}
          onClick={() => setPendingFilter(v => v === 'budgets' ? '' : 'budgets')}
          title="Show only grants with pending budget items"
        >
          <FiClock /> Pending Budgets
          {Object.keys(pendingBiCounts).length > 0 && (
            <span className="tab-count">{Object.keys(pendingBiCounts).length}</span>
          )}
        </button>
        <button
          className={`admin-pending-filter-btn${pendingFilter === 'expenses' ? ' active' : ''}`}
          onClick={() => setPendingFilter(v => v === 'expenses' ? '' : 'expenses')}
          title="Show only grants with pending expenses"
        >
          <FiClock /> Pending Expenses
          {Object.keys(pendingExpCounts).length > 0 && (
            <span className="tab-count">{Object.keys(pendingExpCounts).length}</span>
          )}
        </button>

        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          max={dateTo || undefined}
          title="Submitted from"
          style={{ padding: '0.55em 0.5em', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)', fontFamily: 'var(--font-body)', fontSize: '0.85rem', height: '2.2em' }}
        />
        <span style={{ color: '#9ca3af', alignSelf: 'center', fontSize: '0.85rem' }}>to</span>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          min={dateFrom || undefined}
          title="Submitted to"
          style={{ padding: '0.55em 0.5em', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)', fontFamily: 'var(--font-body)', fontSize: '0.85rem', height: '2.2em' }}
        />


        <div className="admin-tabs">
          {TABS.map(t => {
            const count = t.key === 'all' ? grants.length : (counts[t.key] || 0);
            return (
              <button
                key={t.key}
                className={`admin-tab${activeTab === t.key ? ' active' : ''}`}
                onClick={() => handleTabClick(t.key)}
              >
                {t.label}
                {count > 0 && <span className="tab-count">{count}</span>}
              </button>
            );
          })}
          <button
            className={`admin-pending-filter-btn${hideExpired ? ' active' : ''}`}
            onClick={() => setHideExpired(v => !v)}
            title="Hide grants whose spend period has ended"
          >
            {hideExpired ? 'Show Expired' : 'Hide Expired'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="admin-loading">Loading grants…</p>
      ) : error ? (
        <p className="admin-error">{error}</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort('grant_name')}>Grant Name <SortIcon col="grant_name" /></th>
                <th className="sortable" onClick={() => handleSort('grantee')}>Grantee <SortIcon col="grantee" /></th>
                <th className="sortable" onClick={() => handleSort('organization')}>Organization <SortIcon col="organization" /></th>
                <th className="sortable agl-th-right" onClick={() => handleSort('grant_amount')}>Amount <SortIcon col="grant_amount" /></th>
                <th className="sortable" onClick={() => handleSort('status')}>Status <SortIcon col="status" /></th>
                <th className="sortable" onClick={() => handleSort('created_at')}>Submitted <SortIcon col="created_at" /></th>
                <th className="sortable" onClick={() => handleSort('end_spend_period')}>Time Left <SortIcon col="end_spend_period" /></th>
                <th className="agl-th-center" title="Pending items">Pending</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{ textAlign: 'center', color: 'var(--color-gray-400)', fontStyle: 'italic', padding: '2.5em 1em' }}
                  >
                    No grants found.
                  </td>
                </tr>
              ) : (
                sorted.map(g => {
                  const { display: timeDisplay, cls: timeCls } = timeRemaining(g.end_spend_period);
                  return (
                    <tr key={g.id}>
                      <td className="grant-name-cell">{g.grant_name || `Grant #${g.id}`}</td>
                      <td>{g.users ? `${g.users.firstname} ${g.users.lastname}` : '—'}</td>
                      <td>{g.users?.organization_name || '—'}</td>
                      <td className="amount-cell agl-td-right">{fmt(g.grant_amount)}</td>
                      <td><StatusBadge status={g.status} /></td>
                      <td className="date-cell">{formatDate(g.created_at)}</td>
                      <td className={`agl-time-cell${timeCls ? ` ${timeCls}` : ''}`}>{timeDisplay}</td>
                      <td className="agl-pending-count-cell">
                        {pendingBiCounts[g.id] > 0 && (
                          <span className="agl-pending-count" title="Pending budget items" style={{ marginRight: '0.3em' }}>
                            {pendingBiCounts[g.id]}B
                          </span>
                        )}
                        {pendingExpCounts[g.id] > 0 && (
                          <span className="agl-pending-count" title="Pending expenses">
                            {pendingExpCounts[g.id]}E
                          </span>
                        )}
                      </td>
                      <td>
                        <Link to={`/admin/grants/${g.id}`} className="admin-review-btn icon-only" title="Review grant">
                          <FiArrowRight />
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
    </div>
  );
}

export default AdminGrantList;
