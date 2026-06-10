// src/components/TenantManagement.js
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import {
  FiGrid, FiPlus, FiX, FiUsers, FiCheckCircle, FiXCircle, FiSearch, FiCopy, FiSave,
} from 'react-icons/fi';
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

  // Create tenant form state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

  // Disable/enable confirm state
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [saving, setSaving] = useState(null);

  // Platform settings state
  const [platformEmail, setPlatformEmail] = useState('');
  const [platformPhone, setPlatformPhone] = useState('');
  const [platformSaving, setPlatformSaving] = useState(false);
  const [platformSuccess, setPlatformSuccess] = useState('');
  const [platformError, setPlatformError] = useState('');
  const [platformOriginal, setPlatformOriginal] = useState({ email: '', phone: '' });

  useEffect(() => {
    fetchTenants();
    fetchPlatformSettings();
  }, []);

  async function fetchTenants() {
    setLoading(true);
    setError('');

    // Fetch tenants
    const { data: tenantData, error: tErr } = await supabase
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (tErr) {
      setError(tErr.message);
      setLoading(false);
      return;
    }

    // Fetch user counts per tenant
    const { data: userData } = await supabase
      .from('users')
      .select('tenant_id');

    const countMap = {};
    (userData || []).forEach(u => {
      countMap[u.tenant_id] = (countMap[u.tenant_id] || 0) + 1;
    });

    // Fetch tenant settings
    const { data: settingsData } = await supabase
      .from('tenant_settings')
      .select('*');

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

  async function handleCreateTenant() {
    if (!newName.trim()) {
      setCreateError('Tenant name is required.');
      return;
    }
    if (!adminEmail.trim()) {
      setCreateError('Admin email is required — the first admin needs an invite to set up the tenant.');
      return;
    }

    // Auto-generate slug from name
    const slug = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    setCreating(true);
    setCreateError('');
    setCreateSuccess('');
    setInviteLink('');

    // Create tenant
    const { data: tenant, error: tErr } = await supabase
      .from('tenants')
      .insert({ name: newName.trim(), slug, tenant_type: 'managed' })
      .select()
      .single();

    if (tErr) {
      setCreateError(
        tErr.message?.includes('tenants_slug_key')
          ? 'A tenant with that name already exists. Please choose a different name.'
          : tErr.message
      );
      setCreating(false);
      return;
    }

    // Create tenant settings with all approvals on
    const { error: sErr } = await supabase
      .from('tenant_settings')
      .insert({
        tenant_id: tenant.id,
        require_grant_approval: true,
        require_budget_approval: true,
        require_expense_approval: true,
      });

    if (sErr) {
      setCreateError(`Tenant created but settings failed: ${sErr.message}`);
      setCreating(false);
      return;
    }

    // Generate admin invite for the new tenant
    const { data: invite, error: iErr } = await supabase
      .from('invites')
      .insert({
        tenant_id: tenant.id,
        role: 'admin',
        email: adminEmail.trim().toLowerCase(),
        created_by: session?.user?.id,
      })
      .select()
      .single();

    if (iErr) {
      setCreateError(`Tenant created but invite failed: ${iErr.message}`);
      setCreating(false);
      return;
    }

    const link = `${window.location.origin}/signup?invite=${invite.token}`;
    setInviteLink(link);
    setCreateSuccess(`Tenant "${newName.trim()}" created. Share the invite link below with the admin.`);
    setCreating(false);
    setNewName('');
    setAdminEmail('');
    setNewSlug('');
    await fetchTenants();
  }

  function handleCloseCreate() {
    setShowCreate(false);
    setNewName('');
    setNewSlug('');
    setAdminEmail('');
    setCreateError('');
    setCreateSuccess('');
    setInviteLink('');
  }

  async function fetchPlatformSettings() {
    const { data } = await supabase
      .from('platform_settings')
      .select('*')
      .single();
    if (data) {
      setPlatformEmail(data.default_support_email || '');
      setPlatformPhone(data.default_support_phone || '');
      setPlatformOriginal({ email: data.default_support_email || '', phone: data.default_support_phone || '' });
    }
  }

  async function handleSavePlatformSettings() {
    setPlatformSaving(true);
    setPlatformError('');
    setPlatformSuccess('');
    const { error: err } = await supabase
      .from('platform_settings')
      .update({
        default_support_email: platformEmail.trim() || 'support@granttrail.org',
        default_support_phone: platformPhone.trim() || '(555) 123-4567',
      })
      .eq('id', 1);
    setPlatformSaving(false);
    if (err) {
      setPlatformError(err.message);
    } else {
      setPlatformSuccess('Platform settings saved.');
      setPlatformOriginal({ email: platformEmail.trim(), phone: platformPhone.trim() });
    }
  }

  const platformHasChanges = platformEmail !== platformOriginal.email || platformPhone !== platformOriginal.phone;

  async function handleToggleTenantActive(t) {
    const newActive = !t.is_active;
    setSaving(t.id);
    const { error: err } = await supabase
      .from('tenants')
      .update({ is_active: newActive })
      .eq('id', t.id);
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
    setSaving(t.id);
    const { error: err } = await supabase
      .from('tenant_settings')
      .update({ require_subscription: newVal })
      .eq('tenant_id', t.id);

    // When switching a self-service tenant back to "Required", clean up manual waiver rows.
    // Only for self-service — managed tenants have per-user waivers set by their admin.
    if (!err && newVal === true && t.tenant_type === 'self_service') {
      const { data: tenantUsers } = await supabase
        .from('users')
        .select('id')
        .eq('tenant_id', t.id);
      if (tenantUsers?.length) {
        await supabase
          .from('user_memberships')
          .delete()
          .eq('source', 'manual')
          .in('user_id', tenantUsers.map(u => u.id));
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

  // Auto-generate slug from name
  function handleNameChange(val) {
    setNewName(val);
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
        <div className="admin-card" style={{ marginBottom: '1.5em' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1em' }}>
            <h3 className="admin-card-title" style={{ margin: 0 }}><FiPlus /> New Tenant</h3>
            <button onClick={handleCloseCreate} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
              <FiX size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1em', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Tenant Name</label>
              <input
                type="text"
                placeholder="e.g. Hope Foundation"
                value={newName}
                onChange={e => handleNameChange(e.target.value)}
                disabled={creating || !!inviteLink}
                style={{ width: '100%', padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Admin Email</label>
              <input
                type="email"
                placeholder="admin@organization.com"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
                disabled={creating || !!inviteLink}
                style={{ width: '100%', padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
              />
            </div>
            {!inviteLink && (
              <button
                className="admin-approve-btn"
                onClick={handleCreateTenant}
                disabled={creating}
                style={{ whiteSpace: 'nowrap' }}
              >
                {creating ? 'Creating…' : 'Create Tenant'}
              </button>
            )}
          </div>

          {createError && (
            <p style={{ color: '#991b1b', fontSize: '0.88rem', marginTop: '0.75em' }}>{createError}</p>
          )}

          {createSuccess && (
            <p style={{ color: 'var(--color-success)', fontSize: '0.88rem', marginTop: '0.75em' }}>{createSuccess}</p>
          )}

          {inviteLink && (
            <div style={{ marginTop: '1em', padding: '0.75em 1em', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.75em' }}>
              <input
                type="text"
                readOnly
                value={inviteLink}
                style={{ flex: 1, padding: '0.4em 0.6em', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'var(--font-body)', background: '#fff' }}
              />
              <button
                onClick={() => { navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3em', padding: '0.4em 0.8em', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'var(--font-body)' }}
              >
                <FiCopy size={14} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>
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
      <div className="admin-card" style={{ maxWidth: '640px', marginTop: '2em' }}>
        <h3 className="admin-card-title" style={{ margin: '0 0 0.5em' }}><FiGrid /> Platform Defaults</h3>
        <p style={{ color: '#6b7280', fontSize: '0.88rem', marginBottom: '1em', lineHeight: 1.6 }}>
          Default support contact shown in the footer for all self-service users and for managed tenants that haven't set their own.
        </p>

        <div style={{ display: 'flex', gap: '1em', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Default Support Email</label>
            <input
              type="email"
              placeholder="support@granttrail.org"
              value={platformEmail}
              onChange={e => setPlatformEmail(e.target.value)}
              style={{ width: '100%', padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Default Support Phone</label>
            <input
              type="tel"
              placeholder="(555) 123-4567"
              value={platformPhone}
              onChange={e => setPlatformPhone(e.target.value)}
              style={{ width: '100%', padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
            />
          </div>
        </div>

        {platformError && <p style={{ color: '#991b1b', fontSize: '0.88rem', marginTop: '0.75em' }}>{platformError}</p>}
        {platformSuccess && <p style={{ color: 'var(--color-success)', fontSize: '0.88rem', marginTop: '0.75em' }}>{platformSuccess}</p>}

        <div style={{ marginTop: '1em' }}>
          <button
            className="admin-approve-btn"
            onClick={handleSavePlatformSettings}
            disabled={platformSaving || !platformHasChanges}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4em', opacity: platformHasChanges ? 1 : 0.5 }}
          >
            <FiSave size={15} /> {platformSaving ? 'Saving…' : 'Save Platform Defaults'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TenantManagement;
