// src/components/AdminAuditLog.js
import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { FiArrowLeft, FiActivity, FiX, FiChevronRight, FiChevronDown } from 'react-icons/fi';
import ReadOnlyBanner from '../common/ReadOnlyBanner';
import './Admin.css';

const PAGE_SIZE = 50;

const TABLE_LABELS = {
  grant_record: 'Grant',
  budget_items: 'Budget Item',
  expenses:     'Expense',
  users:        'User',
};

const ACTION_STYLES = {
  INSERT: { background: '#D1FAE5', color: '#065F46' },
  UPDATE: { background: '#DBEAFE', color: '#1E40AF' },
  DELETE: { background: '#FEE2E2', color: '#991B1B' },
};

// Fields not worth showing in a diff (always-changing metadata)
const SKIP_FIELDS = new Set(['updated_at']);

function renderValue(v) {
  if (v === null || v === undefined) return <span className="audit-null">null</span>;
  if (typeof v === 'object') return <code className="audit-json">{JSON.stringify(v)}</code>;
  return String(v);
}

function DiffView({ row, diff }) {
  const old_ = diff.old_values || {};
  const new_ = diff.new_values || {};

  let fields;
  if (row.action === 'INSERT') {
    fields = Object.keys(new_).filter(f => !SKIP_FIELDS.has(f));
  } else if (row.action === 'DELETE') {
    fields = Object.keys(old_).filter(f => !SKIP_FIELDS.has(f));
  } else {
    // UPDATE — only changed fields
    const allKeys = new Set([...Object.keys(old_), ...Object.keys(new_)]);
    fields = [...allKeys].filter(f => !SKIP_FIELDS.has(f) && JSON.stringify(old_[f]) !== JSON.stringify(new_[f]));
  }

  if (fields.length === 0) {
    return <p className="audit-diff-empty">No tracked field changes in this record.</p>;
  }

  const showOld = row.action !== 'INSERT';
  const showNew = row.action !== 'DELETE';

  return (
    <table className="audit-diff-table">
      <thead>
        <tr>
          <th className="audit-diff-th-field">Field</th>
          {showOld && <th className="audit-diff-th-old">Old value</th>}
          {showNew && <th className="audit-diff-th-new">New value</th>}
        </tr>
      </thead>
      <tbody>
        {fields.map(f => (
          <tr key={f}>
            <td className="audit-diff-field">{f}</td>
            {showOld && <td className="audit-diff-old">{renderValue(old_[f])}</td>}
            {showNew && <td className="audit-diff-new">{renderValue(new_[f])}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AdminAuditLog({ readOnly = false }) {
  const [rows,         setRows]         = useState([]);
  const [userMap,      setUserMap]      = useState({});
  const [loading,      setLoading]      = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error,        setError]        = useState('');

  const [filterTable,  setFilterTable]  = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterUser,   setFilterUser]   = useState('');
  const [filterFrom,   setFilterFrom]   = useState('');
  const [filterTo,     setFilterTo]     = useState('');

  const [page,       setPage]       = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Diff state
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [diffCache,     setDiffCache]     = useState({});  // { [row.id]: { old_values, new_values } }
  const [diffLoading,   setDiffLoading]   = useState(null); // row.id currently loading

  // Grant link state: maps audit_log row id → grant_record id (for grant_record and expenses rows)
  const [grantIdMap, setGrantIdMap] = useState({});

  const isInitial = useRef(true);

  // Fetch users once
  useEffect(() => {
    supabase
      .from('users')
      .select('user_id, firstname, lastname, role')
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(u => {
          map[u.user_id] = `${u.firstname} ${u.lastname}${u.role === 'admin' ? ' (admin)' : ''}`;
        });
        setUserMap(map);
      });
  }, []);

  // Fetch logs on mount, filter changes, and page changes
  useEffect(() => {
    let cancelled = false;

    async function fetchLogs() {
      if (isInitial.current) {
        setLoading(true);
        isInitial.current = false;
      } else {
        setTableLoading(true);
      }
      setError('');

      try {
        const from = page * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        let q = supabase
          .from('audit_log')
          .select('id, table_name, action, record_id, changed_by, created_at', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(from, to);

        if (filterTable)  q = q.eq('table_name', filterTable);
        if (filterAction) q = q.eq('action', filterAction);
        if (filterUser)   q = q.eq('changed_by', filterUser);
        if (filterFrom) {
          const fromUtc = new Date(filterFrom + 'T00:00:00').toISOString();
          q = q.gte('created_at', fromUtc);
        }
        if (filterTo) {
          const toUtc = new Date(filterTo + 'T23:59:59').toISOString();
          q = q.lte('created_at', toUtc);
        }

        const { data, error: logsErr, count } = await q;
        if (cancelled) return;
        if (logsErr) throw logsErr;
        const auditRows = data || [];
        setRows(auditRows);
        setTotalCount(count || 0);
        setExpandedRowId(null); // collapse any open diff when results change

        // Build grant link map
        const newGrantIdMap = {};

        // grant_record rows: record_id IS the grant id (skip DELETEs — grant no longer exists)
        auditRows
          .filter(r => r.table_name === 'grant_record' && r.action !== 'DELETE')
          .forEach(r => { newGrantIdMap[r.id] = r.record_id; });

        // expenses rows: need to look up grant_id from the expenses table
        const expenseAuditRows = auditRows.filter(r => r.table_name === 'expenses');
        if (expenseAuditRows.length > 0) {
          const expenseRecordIds = [...new Set(expenseAuditRows.map(r => r.record_id))];
          const { data: expData } = await supabase
            .from('expenses')
            .select('id, grant_id')
            .in('id', expenseRecordIds);
          if (!cancelled) {
            const expGrantMap = {};
            (expData || []).forEach(e => { expGrantMap[e.id] = e.grant_id; });
            expenseAuditRows.forEach(r => {
              if (expGrantMap[r.record_id]) newGrantIdMap[r.id] = expGrantMap[r.record_id];
            });
          }
        }

        if (!cancelled) setGrantIdMap(newGrantIdMap);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setTableLoading(false);
        }
      }
    }

    fetchLogs();
    return () => { cancelled = true; };
  }, [filterTable, filterAction, filterUser, filterFrom, filterTo, page]);

  async function handleRowClick(row) {
    // Collapse if already open
    if (expandedRowId === row.id) {
      setExpandedRowId(null);
      return;
    }

    setExpandedRowId(row.id);

    // Use cache if already fetched
    if (diffCache[row.id]) return;

    setDiffLoading(row.id);
    const { data } = await supabase
      .from('audit_log')
      .select('old_values, new_values')
      .eq('id', row.id)
      .single();

    setDiffCache(prev => ({ ...prev, [row.id]: data || {} }));
    setDiffLoading(null);
  }

  function fmtTs(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  const hasFilter = filterTable || filterAction || filterUser || filterFrom || filterTo;

  function clearFilters() {
    setFilterTable('');
    setFilterAction('');
    setFilterUser('');
    setFilterFrom('');
    setFilterTo('');
    setPage(0);
  }

  const totalPages  = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const displayFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const displayTo   = Math.min((page + 1) * PAGE_SIZE, totalCount);

  if (loading) return <div className="admin-page"><p className="admin-loading">Loading audit log…</p></div>;
  if (error)   return <div className="admin-page"><p className="admin-error">{error}</p></div>;

  return (
    <div className="admin-page">
      <ReadOnlyBanner readOnly={readOnly} />
      <div className="admin-header">
        <div>
          <h2 className="admin-title"><FiActivity /> Audit Log</h2>
          <p className="admin-subtitle">
            {totalCount > 0
              ? `Showing ${displayFrom}–${displayTo} of ${totalCount}${hasFilter ? ' filtered' : ''} records`
              : 'No records found'} - click any row to see field changes.
          </p>
        </div>
        <Link to="/admin" className="admin-back-link">
          <FiArrowLeft /> Dashboard
        </Link>
      </div>

      {/* Filter bar */}
      <div className="audit-filter-bar">
        <div className="audit-filter-group">
          <label className="audit-filter-label">Table</label>
          <select
            className="audit-filter-select"
            value={filterTable}
            onChange={e => { setFilterTable(e.target.value); setPage(0); }}
          >
            <option value="">All tables</option>
            <option value="grant_record">Grant</option>
            <option value="budget_items">Budget Item</option>
            <option value="expenses">Expense</option>
            <option value="users">User</option>
          </select>
        </div>

        <div className="audit-filter-group">
          <label className="audit-filter-label">Action</label>
          <select
            className="audit-filter-select"
            value={filterAction}
            onChange={e => { setFilterAction(e.target.value); setPage(0); }}
          >
            <option value="">All actions</option>
            <option value="INSERT">Insert</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
          </select>
        </div>

        <div className="audit-filter-group">
          <label className="audit-filter-label">User</label>
          <select
            className="audit-filter-select"
            value={filterUser}
            onChange={e => { setFilterUser(e.target.value); setPage(0); }}
          >
            <option value="">All users</option>
            {Object.entries(userMap)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([uid, name]) => (
                <option key={uid} value={uid}>{name}</option>
              ))}
          </select>
        </div>

        <div className="audit-filter-group">
          <label className="audit-filter-label">From</label>
          <input
            type="date"
            className="audit-filter-date"
            value={filterFrom}
            onChange={e => { setFilterFrom(e.target.value); setPage(0); }}
            max={filterTo || undefined}
          />
        </div>

        <div className="audit-filter-group">
          <label className="audit-filter-label">To</label>
          <input
            type="date"
            className="audit-filter-date"
            value={filterTo}
            onChange={e => { setFilterTo(e.target.value); setPage(0); }}
            min={filterFrom || undefined}
          />
        </div>

        {hasFilter && (
          <button className="audit-clear-btn" onClick={clearFilters}>
            <FiX /> Clear
          </button>
        )}
      </div>

      {/* Table — dims while fetching, stays visible */}
      <div style={{ opacity: tableLoading ? 0.45 : 1, transition: 'opacity 0.2s', pointerEvents: tableLoading ? 'none' : 'auto' }}>
        {rows.length === 0 ? (
          <p className="admin-empty">
            {hasFilter ? 'No records match the current filters.' : 'No audit records found.'}
          </p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '1.5em' }}></th>
                  <th>Timestamp</th>
                  <th>Table</th>
                  <th>Action</th>
                  <th>Record ID</th>
                  <th>Changed By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const isExpanded = expandedRowId === row.id;
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`audit-row${isExpanded ? ' audit-row-expanded' : ''}`}
                        onClick={() => handleRowClick(row)}
                      >
                        <td className="audit-chevron">
                          {isExpanded ? <FiChevronDown /> : <FiChevronRight />}
                        </td>
                        <td className="audit-ts">{fmtTs(row.created_at)}</td>
                        <td>{TABLE_LABELS[row.table_name] || row.table_name}</td>
                        <td>
                          <span className="audit-action-badge" style={ACTION_STYLES[row.action] || {}}>
                            {row.action}
                          </span>
                        </td>
                        <td className="audit-record-id">
                          #{row.record_id}
                          {grantIdMap[row.id] !== undefined && (
                            <Link
                              to={`/admin/grants/${grantIdMap[row.id]}`}
                              className="audit-grant-link"
                              onClick={e => e.stopPropagation()}
                            >
                              View Grant
                            </Link>
                          )}
                        </td>
                        <td className="audit-user">
                          {row.changed_by
                            ? (userMap[row.changed_by] || <span className="audit-uuid">{row.changed_by}</span>)
                            : <span className="audit-system">—</span>}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="audit-diff-row">
                          <td colSpan={6} className="audit-diff-cell">
                            {diffLoading === row.id ? (
                              <p className="audit-diff-loading">Loading changes…</p>
                            ) : diffCache[row.id] ? (
                              <DiffView row={row} diff={diffCache[row.id]} />
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="audit-pagination">
            <button
              className="audit-page-btn"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
            >
              ← Prev
            </button>
            <span className="audit-page-info">Page {page + 1} of {totalPages}</span>
            <button
              className="audit-page-btn"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminAuditLog;
