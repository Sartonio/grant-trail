// src/components/AdminUserList.js
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import {
  FiArrowLeft, FiUsers, FiSearch, FiShield, FiUser,
  FiCheckCircle, FiXCircle, FiLink, FiAlertCircle,
  FiUserPlus, FiCopy, FiX,
} from 'react-icons/fi';
import './Admin.css';

function AdminUserList({ session }) {
  const [users,          setUsers]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [search,         setSearch]         = useState('');
  const [confirmRole,    setConfirmRole]    = useState(null); // user.id pending role confirm
  const [confirmDisable, setConfirmDisable] = useState(null); // user.id pending enable/disable confirm
  const [saving,         setSaving]         = useState(null); // user.id currently being saved
  const [memberships,    setMemberships]    = useState({});   // user.id → membership row

  const myUid = session?.user?.id; // auth UUID of the logged-in admin

  // Invite state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteRole, setInviteRole] = useState('grantee');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchUsers() {
      setLoading(true);
      setError('');
      const { data, error: err } = await supabase
        .from('users')
        .select('id, firstname, lastname, email, organization_name, phone_number, role, user_id, is_active, created_at')
        .order('created_at', { ascending: false });
      if (err) setError(err.message);
      else {
        setUsers(data || []);
        // Fetch active memberships for all users in this tenant
        const { data: mData } = await supabase
          .from('user_memberships')
          .select('*')
          .eq('is_active', true);
        if (mData) {
          const map = {};
          mData.forEach(m => { map[m.user_id] = m; });
          setMemberships(map);
        }
      }
      setLoading(false);
    }
    fetchUsers();
  }, []);

  // --- Handlers ---

  async function handleRoleToggle(u) {
    const newRole = u.role === 'admin' ? 'grantee' : 'admin';
    setSaving(u.id);
    const { error: err } = await supabase
      .from('users')
      .update({ role: newRole })
      .eq('id', u.id);
    setSaving(null);
    if (err) { alert('Error updating role: ' + err.message); return; }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x));
    setConfirmRole(null);
  }

  async function handleToggleActive(u) {
    const newActive = !u.is_active;
    setSaving(u.id);
    const { error: err } = await supabase
      .from('users')
      .update({ is_active: newActive })
      .eq('id', u.id);
    setSaving(null);
    if (err) { alert('Error updating status: ' + err.message); return; }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: newActive } : x));
    setConfirmDisable(null);
  }

  async function handleWaiveSubscription(u) {
    const waiverTier = u.role === 'admin' ? 'premium' : 'basic';
    setSaving(u.id);
    const { data, error: err } = await supabase
      .from('user_memberships')
      .upsert({
        user_id: u.id,
        membership_tier: waiverTier,
        is_active: true,
        source: 'manual',
      }, { onConflict: 'user_id' })
      .select()
      .single();
    setSaving(null);
    if (err) { alert('Error waiving subscription: ' + err.message); return; }
    setMemberships(prev => ({ ...prev, [u.id]: data }));
  }

  async function handleRemoveWaiver(u) {
    setSaving(u.id);
    const { error: err } = await supabase
      .from('user_memberships')
      .delete()
      .eq('user_id', u.id);
    setSaving(null);
    if (err) { alert('Error removing waiver: ' + err.message); return; }
    setMemberships(prev => { const next = { ...prev }; delete next[u.id]; return next; });
  }

  async function handleCreateInvite() {
    setInviteLoading(true);
    setInviteError('');
    setInviteLink('');
    setCopied(false);

    const tenantId = session?.userRecord?.tenant_id;
    const { data, error: err } = await supabase
      .from('invites')
      .insert({
        tenant_id: tenantId,
        role: inviteRole,
        email: inviteEmail.trim() || null,
        created_by: session?.user?.id,
      })
      .select()
      .single();

    setInviteLoading(false);
    if (err) {
      setInviteError(err.message);
      return;
    }

    const link = `${window.location.origin}/signup?invite=${data.token}`;
    setInviteLink(link);
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCloseInviteForm() {
    setShowInviteForm(false);
    setInviteRole('grantee');
    setInviteEmail('');
    setInviteLink('');
    setInviteError('');
    setCopied(false);
  }

  // --- Derived data ---

  const q = search.toLowerCase();
  const filtered = users.filter(u => {
    if (!q) return true;
    const name = `${u.firstname} ${u.lastname}`.toLowerCase();
    return (
      name.includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.organization_name || '').toLowerCase().includes(q)
    );
  });

  const totalCount    = users.length;
  const adminCount    = users.filter(u => u.role === 'admin').length;
  const granteeCount  = users.filter(u => u.role === 'grantee').length;
  const disabledCount = users.filter(u => !u.is_active).length;
  const isTfacTenant = (session?.tenantConfig?.name || '').toLowerCase() === 'the family advocates canada';

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (loading) return <div className="admin-page"><p className="admin-loading">Loading users…</p></div>;
  if (error)   return <div className="admin-page"><p className="admin-error">{error}</p></div>;

  return (
    <div className="admin-page">
      {/* Page header */}
      <div className="admin-header">
        <div>
          <h2 className="admin-title"><FiUsers /> User Management</h2>
          <p className="admin-subtitle">
            {filtered.length} of {totalCount} user{totalCount !== 1 ? 's' : ''}
            {search ? ' matching search' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1em', alignItems: 'center' }}>
          <button
            className="admin-approve-btn"
            onClick={() => setShowInviteForm(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4em' }}
          >
            <FiUserPlus size={15} /> Invite User
          </button>
          <Link to="/admin" className="admin-back-link">
            <FiArrowLeft /> Dashboard
          </Link>
        </div>
      </div>

      {/* Invite Form */}
      {showInviteForm && (
        <div className="admin-card" style={{ marginBottom: '1.5em' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1em' }}>
            <h3 className="admin-card-title" style={{ margin: 0 }}><FiUserPlus /> Invite New User</h3>
            <button onClick={handleCloseInviteForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
              <FiX size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1em', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                disabled={inviteLoading}
                style={{ padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
              >
                <option value="grantee">Grantee</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Email (optional)</label>
              <input
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                disabled={inviteLoading}
                style={{ width: '100%', padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
              />
            </div>
            <button
              className="admin-approve-btn"
              onClick={handleCreateInvite}
              disabled={inviteLoading}
              style={{ whiteSpace: 'nowrap' }}
            >
              {inviteLoading ? 'Creating…' : 'Generate Invite Link'}
            </button>
          </div>

          {inviteError && (
            <p style={{ color: '#991b1b', fontSize: '0.88rem', marginTop: '0.75em' }}>{inviteError}</p>
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
                onClick={handleCopyLink}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3em', padding: '0.4em 0.8em', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'var(--font-body)' }}
              >
                <FiCopy size={14} /> {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="asc-icon" style={{ background: 'linear-gradient(135deg,#065F46,#059669)' }}>
            <FiUsers size={22} color="#fff" />
          </div>
          <div className="asc-body">
            <span className="asc-value">{totalCount}</span>
            <span className="asc-label">Total Users</span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="asc-icon" style={{ background: 'linear-gradient(135deg,#1E40AF,#3B82F6)' }}>
            <FiShield size={22} color="#fff" />
          </div>
          <div className="asc-body">
            <span className="asc-value">{adminCount}</span>
            <span className="asc-label">Admins</span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="asc-icon" style={{ background: 'linear-gradient(135deg,#374151,#6B7280)' }}>
            <FiUser size={22} color="#fff" />
          </div>
          <div className="asc-body">
            <span className="asc-value">{granteeCount}</span>
            <span className="asc-label">Grantees</span>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="asc-icon" style={{ background: 'linear-gradient(135deg,#991B1B,#EF4444)' }}>
            <FiXCircle size={22} color="#fff" />
          </div>
          <div className="asc-body">
            <span className="asc-value">{disabledCount}</span>
            <span className="asc-label">Disabled</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="admin-toolbar">
        <div className="admin-search-box">
          <FiSearch className="admin-search-icon" />
          <input
            type="text"
            placeholder="Search by name, email, or organization…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="admin-empty">
          {search ? 'No users match the search.' : 'No users found.'}
        </p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Organization</th>
                <th>Role</th>
                <th>Status</th>
                <th>Subscription</th>
                <th>Linked</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const isSelf     = u.user_id === myUid;
                const isSuperAdmin = u.role === 'super_admin';
                const isDisabled = !u.is_active;
                const isSavingThis = saving === u.id;

                return (
                  <tr key={u.id} className={isDisabled ? 'user-row-disabled' : ''}>

                    {/* Name */}
                    <td className="grant-name-cell">
                      {u.firstname} {u.lastname}
                      {isSelf && <span className="user-self-badge"> (you)</span>}
                    </td>

                    {/* Email */}
                    <td style={{ fontSize: '0.88rem' }}>{u.email}</td>

                    {/* Organization */}
                    <td style={{ fontSize: '0.88rem' }}>{u.organization_name || '—'}</td>

                    {/* Role */}
                    <td>
                      <span className={`user-role-pill role-${u.role}`}>
                        {u.role === 'admin' ? <FiShield size={11} /> : <FiUser size={11} />}
                        {u.role}
                      </span>
                    </td>

                    {/* Active status */}
                    <td>
                      <span className={`user-status-pill ${isDisabled ? 'status-disabled' : 'status-active'}`}>
                        {isDisabled ? <FiXCircle size={11} /> : <FiCheckCircle size={11} />}
                        {isDisabled ? 'Disabled' : 'Active'}
                      </span>
                    </td>

                    {/* Subscription status */}
                    <td>
                      {u.role === 'super_admin' ? (
                        <span className="user-status-pill" style={{ background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db' }}>Exempt</span>
                      ) : u.role === 'admin' && isTfacTenant ? (
                        <span className="user-status-pill" style={{ background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db' }}>Exempt</span>
                      ) : memberships[u.id]?.source === 'manual' ? (
                        <span className="user-status-pill" style={{ background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd' }}>Waived</span>
                      ) : memberships[u.id]?.membership_tier === 'premium' ? (
                        <span className="user-status-pill" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>Fiscal Agents Plan (Paid)</span>
                      ) : memberships[u.id]?.membership_tier === 'basic' ? (
                        <span className="user-status-pill" style={{ background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' }}>Basic (Paid)</span>
                      ) : (
                        <span className="user-status-pill" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }}>None</span>
                      )}
                    </td>

                    {/* Linked */}
                    <td>
                      {u.user_id ? (
                        <span className="user-linked-yes" title="Auth account linked"><FiLink size={14} /></span>
                      ) : (
                        <span
                          className="user-linked-no"
                          title="No auth account linked — run 05-After-User-Creation.sql"
                        >
                          <FiAlertCircle size={14} />
                        </span>
                      )}
                    </td>

                    {/* Joined */}
                    <td className="date-cell">{fmtDate(u.created_at)}</td>

                    {/* Actions */}
                    <td className="user-actions-cell">
                      {isSelf || isSuperAdmin ? (
                        <span className="user-self-note">—</span>
                      ) : (
                        <>
                          {/* Role toggle */}
                          {confirmRole === u.id ? (
                            <span className="user-confirm-group">
                              <span className="user-confirm-label">
                                Make {u.role === 'admin' ? 'Grantee' : 'Admin'}?
                              </span>
                              <button
                                className="user-action-btn confirm"
                                disabled={isSavingThis}
                                onClick={() => handleRoleToggle(u)}
                              >
                                Yes
                              </button>
                              <button
                                className="user-action-btn cancel"
                                onClick={() => setConfirmRole(null)}
                              >
                                No
                              </button>
                            </span>
                          ) : (
                            <button
                              className="user-action-btn role"
                              title={u.role === 'admin' ? 'Make Grantee' : 'Make Admin'}
                              onClick={() => { setConfirmDisable(null); setConfirmRole(u.id); }}
                              disabled={isSavingThis}
                            >
                              <FiShield size={13} />
                              {u.role === 'admin' ? 'Make Grantee' : 'Make Admin'}
                            </button>
                          )}

                          {/* Enable/Disable toggle */}
                          {confirmDisable === u.id ? (
                            <span className="user-confirm-group">
                              <span className="user-confirm-label">
                                {isDisabled ? 'Enable' : 'Disable'} user?
                              </span>
                              <button
                                className="user-action-btn confirm"
                                disabled={isSavingThis}
                                onClick={() => handleToggleActive(u)}
                              >
                                Yes
                              </button>
                              <button
                                className="user-action-btn cancel"
                                onClick={() => setConfirmDisable(null)}
                              >
                                No
                              </button>
                            </span>
                          ) : (
                            <button
                              className={`user-action-btn ${isDisabled ? 'enable' : 'disable'}`}
                              title={isDisabled ? 'Enable user' : 'Disable user'}
                              onClick={() => { setConfirmRole(null); setConfirmDisable(u.id); }}
                              disabled={isSavingThis}
                            >
                              {isDisabled
                                ? <><FiCheckCircle size={13} /> Enable</>
                                : <><FiXCircle size={13} /> Disable</>
                              }
                            </button>
                          )}

                          {/* Waive/Remove subscription requirement */}
                          {(u.role === 'grantee' || (u.role === 'admin' && !isTfacTenant)) && (
                            memberships[u.id]?.source === 'manual' ? (
                              <button
                                className="user-action-btn disable"
                                title={u.role === 'admin' ? 'Remove waiver — admin will need a Fiscal Agents plan subscription' : 'Remove waiver — user will need a Stripe subscription'}
                                onClick={() => handleRemoveWaiver(u)}
                                disabled={isSavingThis}
                              >
                                <FiXCircle size={13} /> Remove Waiver
                              </button>
                            ) : !memberships[u.id] ? (
                              <button
                                className="user-action-btn enable"
                                title={u.role === 'admin' ? 'Waive subscription — grant fiscal agent access without billing' : 'Waive subscription — grant full access for free'}
                                onClick={() => handleWaiveSubscription(u)}
                                disabled={isSavingThis}
                              >
                                <FiCheckCircle size={13} /> Waive
                              </button>
                            ) : null
                          )}
                        </>
                      )}
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
}

export default AdminUserList;
