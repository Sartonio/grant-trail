// src/components/TenantManagement.js
import React, { useState, useEffect } from 'react';
import {
  FiGrid, FiPlus, FiUsers, FiCheckCircle, FiXCircle, FiSearch,
} from 'react-icons/fi';
import { fmtDate } from '../../lib/format';
import {
  listTenants, listAllUserTenantIds, listAllTenantSettings,
  setTenantActive, setTenantRequireSubscription,
  listTenantUserIds, deleteManualMembershipsForUsers,
} from '../../lib/data/tenants';
import CreateTenantForm from './CreateTenantForm';
import PlatformSettingsCard from './PlatformSettingsCard';
import './Admin.css';

function TenantManagement({ session }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const [showCreate, setShowCreate] = useState(false);

  // Disable/enable confirm state
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    fetchTenants();
  }, []);

  async function fetchTenants() {
    // No setLoading(true) here: the full-page loader would unmount
    // CreateTenantForm on refetch, wiping the invite link mid-flow.
    // `loading` starts true, so the initial load still shows the loader.
    setError('');

    // Fetch tenants
    const { data: tenantData, error: tErr } = await listTenants();

    if (tErr) {
      setError(tErr.message);
      setLoading(false);
      return;
    }

    // Fetch user counts per tenant
    const { data: userData } = await listAllUserTenantIds();

    const countMap = {};
    (userData || []).forEach(u => {
      countMap[u.tenant_id] = (countMap[u.tenant_id] || 0) + 1;
    });

    // Fetch tenant settings
    const { data: settingsData } = await listAllTenantSettings();

    const settingsMap = {};
    (settingsData || []).forEach(s => {
      settingsMap[s.tenant_id] = s;
    });

    setTenants((tenantData || []).map(t => ({
      ...t,
      userCount: countMap[t.id] || 0,
      settings: settingsMap[t.id] || null,
    })));
    setLoading(false);
  }

  async function handleToggleTenantActive(t) {
    const newActive = !t.is_active;
    setSaving(t.id);
    const { error: err } = await setTenantActive(t.id, newActive);
    setSaving(null);
    if (err) {
      alert('Error updating tenant: ' + err.message);
      return;
    }
    setTenants(prev => prev.map(x => x.id === t.id ? { ...x, is_active: newActive } : x));
    setConfirmDisable(null);
  }

  async function handleToggleSubscription(t) {
    const newVal = t.settings?.require_subscription === false ? true : false;
    if (newVal === true && t.tenant_type === 'self_service') {
      if (!window.confirm(`Require subscriptions for ${t.name}? This will remove all manual subscription waivers for users in this tenant.`)) return;
    }
    setSaving(t.id);
    const { error: err } = await setTenantRequireSubscription(t.id, newVal);

    // When switching a self-service tenant back to "Required", clean up manual waiver rows.
    // Only for self-service — managed tenants have per-user waivers set by their admin.
    if (!err && newVal === true && t.tenant_type === 'self_service') {
      const { data: tenantUsers } = await listTenantUserIds(t.id);
      if (tenantUsers?.length) {
        await deleteManualMembershipsForUsers(tenantUsers.map(u => u.id));
      }
    }

    setSaving(null);
    if (err) {
      alert('Error updating subscription setting: ' + err.message);
      return;
    }
    setTenants(prev => prev.map(x =>
      x.id === t.id
        ? { ...x, settings: { ...x.settings, require_subscription: newVal } }
        : x
    ));
  }

  const q = search.toLowerCase();
  const filtered = tenants.filter(t => {
    if (q && !t.name.toLowerCase().includes(q) && !t.slug.toLowerCase().includes(q)) return false;
    if (filterType && t.tenant_type !== filterType) return false;
    if (filterStatus === 'active' && t.is_active === false) return false;
    if (filterStatus === 'disabled' && t.is_active !== false) return false;
    if (filterFrom && t.created_at) {
      const localDate = new Date(t.created_at).toLocaleDateString('en-CA'); // YYYY-MM-DD
      if (localDate < filterFrom) return false;
    }
    if (filterTo && t.created_at) {
      const localDate = new Date(t.created_at).toLocaleDateString('en-CA');
      if (localDate > filterTo) return false;
    }
    return true;
  });

  if (loading) return <div className="admin-page"><p className="admin-loading">Loading tenants…</p></div>;
  if (error) return <div className="admin-page"><p className="admin-error">{error}</p></div>;

  return (
    <div className="admin-page">
      {/* Page header */}
      <div className="admin-header">
        <div>
          <h2 className="admin-title"><FiGrid /> Tenant Management</h2>
          <p className="admin-subtitle">
            {filtered.length} tenant{filtered.length !== 1 ? 's' : ''}
            {search ? ' matching search' : ''}
          </p>
        </div>
        <button
          className="admin-approve-btn"
          onClick={() => setShowCreate(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4em' }}
        >
          <FiPlus size={15} /> Create Tenant
        </button>
      </div>

      {/* Create tenant form */}
      {showCreate && (
        <CreateTenantForm
          session={session}
          onClose={() => setShowCreate(false)}
          onCreated={fetchTenants}
        />
      )}

      {/* Search and filters */}
      <div className="admin-toolbar">
        <div className="admin-search-box">
          <FiSearch className="admin-search-icon" />
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="audit-filter-select"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          style={{ padding: '0.55em 1em', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)', fontFamily: 'var(--font-body)', fontSize: '0.9rem', height: '2.5em' }}
        >
          <option value="">All Types</option>
          <option value="managed">Managed</option>
          <option value="self_service">Self-service</option>
        </select>
        <select
          className="audit-filter-select"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '0.55em 1em', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)', fontFamily: 'var(--font-body)', fontSize: '0.9rem', height: '2.5em' }}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <input
          type="date"
          value={filterFrom}
          onChange={e => setFilterFrom(e.target.value)}
          max={filterTo || undefined}
          title="Created from"
          style={{ padding: '0.55em 0.5em', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)', fontFamily: 'var(--font-body)', fontSize: '0.9rem', height: '2.5em' }}
        />
        <span style={{ color: '#9ca3af', alignSelf: 'center' }}>to</span>
        <input
          type="date"
          value={filterTo}
          onChange={e => setFilterTo(e.target.value)}
          min={filterFrom || undefined}
          title="Created to"
          style={{ padding: '0.55em 0.5em', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)', fontFamily: 'var(--font-body)', fontSize: '0.9rem', height: '2.5em' }}
        />
      </div>

      {/* Stat cards */}
      <div className="admin-stat-grid" style={{ marginBottom: '1.5em' }}>
        <div className="admin-stat-card">
          <div className="asc-icon" style={{ background: 'linear-gradient(135deg,#065F46,#059669)' }}>
            <FiGrid size={22} color="#fff" />
          </div>
          <div className="asc-body">
            <span className="asc-value">{tenants.length}</span>
            <span className="asc-label">Total Tenants</span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="asc-icon" style={{ background: 'linear-gradient(135deg,#374151,#6B7280)' }}>
            <FiUsers size={22} color="#fff" />
          </div>
          <div className="asc-body">
            <span className="asc-value">{tenants.reduce((sum, t) => sum + t.userCount, 0)}</span>
            <span className="asc-label">Total Users</span>
          </div>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="admin-empty">
          {search ? 'No tenants match the search.' : 'No tenants found.'}
        </p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Users</th>
                <th>Grants</th>
                <th>Budgets</th>
                <th>Expenses</th>
                <th>Subscription</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className={t.is_active === false ? 'user-row-disabled' : ''}>
                  <td className="grant-name-cell" style={{ fontWeight: 600 }} title={t.name}>{t.name}</td>
                  <td>
                    <span className={`user-role-pill ${t.tenant_type === 'managed' ? 'role-admin' : 'role-grantee'}`}>
                      {t.tenant_type === 'managed' ? 'Managed' : 'Self-service'}
                    </span>
                  </td>
                  <td>{t.userCount}</td>
                  <td>
                    {t.settings?.require_grant_approval ? (
                      <span style={{ color: '#059669' }}><FiCheckCircle size={14} /> Required</span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}><FiXCircle size={14} /> Off</span>
                    )}
                  </td>
                  <td>
                    {t.settings?.require_budget_approval ? (
                      <span style={{ color: '#059669' }}><FiCheckCircle size={14} /> Required</span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}><FiXCircle size={14} /> Off</span>
                    )}
                  </td>
                  <td>
                    {t.settings?.require_expense_approval ? (
                      <span style={{ color: '#059669' }}><FiCheckCircle size={14} /> Required</span>
                    ) : (
                      <span style={{ color: '#9ca3af' }}><FiXCircle size={14} /> Off</span>
                    )}
                  </td>
                  <td>
                    <button
                      className={`user-action-btn ${t.settings?.require_subscription !== false ? 'disable' : 'enable'}`}
                      style={{ fontSize: '0.8rem', padding: '0.2em 0.6em' }}
                      title={t.settings?.require_subscription !== false ? 'Click to exempt this tenant from subscription' : 'Click to require subscription'}
                      onClick={() => handleToggleSubscription(t)}
                      disabled={saving === t.id}
                    >
                      {t.settings?.require_subscription !== false ? (
                        <><FiCheckCircle size={13} /> Required</>
                      ) : (
                        <><FiXCircle size={13} /> Exempt</>
                      )}
                    </button>
                  </td>
                  <td>
                    <span className={`user-status-pill ${t.is_active === false ? 'status-disabled' : 'status-active'}`}>
                      {t.is_active === false ? <><FiXCircle size={11} /> Disabled</> : <><FiCheckCircle size={11} /> Active</>}
                    </span>
                  </td>
                  <td className="date-cell">{fmtDate(t.created_at)}</td>
                  <td className="user-actions-cell">
                    {confirmDisable === t.id ? (
                      <span className="user-confirm-group">
                        <span className="user-confirm-label">{t.is_active === false ? 'Enable' : 'Disable'}?</span>
                        <button className="user-action-btn confirm" disabled={saving === t.id} onClick={() => handleToggleTenantActive(t)}>Yes</button>
                        <button className="user-action-btn cancel" onClick={() => setConfirmDisable(null)}>No</button>
                      </span>
                    ) : (
                      <button
                        className={`user-action-btn ${t.is_active === false ? 'enable' : 'disable'}`}
                        onClick={() => setConfirmDisable(t.id)}
                        disabled={saving === t.id}
                      >
                        {t.is_active === false ? <><FiCheckCircle size={13} /> Enable</> : <><FiXCircle size={13} /> Disable</>}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Platform Settings */}
      <PlatformSettingsCard />
    </div>
  );
}

export default TenantManagement;
