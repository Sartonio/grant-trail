// src/components/AdminUserList.js
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FiArrowLeft, FiUsers, FiSearch, FiShield, FiUser,
  FiXCircle, FiUserPlus,
} from 'react-icons/fi';
import {
  listTenantUsers, listActiveMemberships, updateUser,
  waiveUserSubscription, removeUserMembership,
} from '../../lib/data/users';
import { useWriteGuard } from '../../lib/useWriteGuard';
import ReadOnlyBanner from '../common/ReadOnlyBanner';
import InviteUserForm from './InviteUserForm';
import UserRow from './UserRow';
import './Admin.css';

function AdminUserList({ session, readOnly = false }) {
  const guardWrite = useWriteGuard(session);
  const [users,          setUsers]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [search,         setSearch]         = useState('');
  const [confirmRole,    setConfirmRole]    = useState(null); // user.id pending role confirm
  const [confirmDisable, setConfirmDisable] = useState(null); // user.id pending enable/disable confirm
  const [confirmWaive,   setConfirmWaive]   = useState(null); // { uid, action: 'waive'|'remove' }
  const [saving,         setSaving]         = useState(null); // user.id currently being saved
  const [actionError,    setActionError]    = useState('');   // transient mutation error
  const [memberships,    setMemberships]    = useState({});   // user.id → membership row

  const myUid = session?.user?.id; // auth UUID of the logged-in admin

  const [showInviteForm, setShowInviteForm] = useState(false);

  useEffect(() => {
    async function fetchUsers() {
      setLoading(true);
      setError('');
      const { data, error: err } = await listTenantUsers();
      if (err) setError(err.message);
      else {
        setUsers(data || []);
        // Fetch active memberships for all users in this tenant
        const { data: mData } = await listActiveMemberships();
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
    if (!guardWrite()) return;
    const newRole = u.role === 'admin' ? 'grantee' : 'admin';
    setSaving(u.id);
    const { error: err } = await updateUser(u.id, { role: newRole });
    setSaving(null);
    if (err) { setActionError('Error updating role: ' + err.message); return; }
    setActionError('');
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x));
    setConfirmRole(null);
  }

  async function handleToggleActive(u) {
    if (!guardWrite()) return;
    const newActive = !u.is_active;
    setSaving(u.id);
    const { error: err } = await updateUser(u.id, { is_active: newActive });
    setSaving(null);
    if (err) { setActionError('Error updating status: ' + err.message); return; }
    setActionError('');
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: newActive } : x));
    setConfirmDisable(null);
  }

  async function handleWaiveSubscription(u) {
    if (!guardWrite()) return;
    // Per-user waivers are basic-only: premium is a TENANT-level entitlement
    // (tenant_memberships) and the DB guard rejects non-super-admin premium
    // writes. Org comps go through require_subscription on /super/tenants.
    setSaving(u.id);
    const { data, error: err } = await waiveUserSubscription(u.id, 'basic');
    setSaving(null);
    if (err) { setActionError('Error waiving subscription: ' + err.message); return; }
    setActionError('');
    setMemberships(prev => ({ ...prev, [u.id]: data }));
  }

  async function handleRemoveWaiver(u) {
    if (!guardWrite()) return;
    setSaving(u.id);
    const { error: err } = await removeUserMembership(u.id);
    setSaving(null);
    if (err) { setActionError('Error removing waiver: ' + err.message); return; }
    setActionError('');
    setMemberships(prev => { const next = { ...prev }; delete next[u.id]; return next; });
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

  if (loading) return <div className="admin-page"><p className="admin-loading">Loading users…</p></div>;
  if (error)   return <div className="admin-page"><p className="admin-error">{error}</p></div>;

  return (
    <div className="admin-page">
      <ReadOnlyBanner readOnly={readOnly} />
      {actionError && (
        <p className="admin-error" style={{ marginBottom: '1em' }}>{actionError}</p>
      )}
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
        <InviteUserForm
          session={session}
          guardWrite={guardWrite}
          onClose={() => setShowInviteForm(false)}
        />
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
              {filtered.map(u => (
                <UserRow
                  key={u.id}
                  user={u}
                  membership={memberships[u.id]}
                  isSelf={u.user_id === myUid}
                  isTfacTenant={isTfacTenant}
                  isSavingThis={saving === u.id}
                  confirmRole={confirmRole}
                  confirmDisable={confirmDisable}
                  confirmWaive={confirmWaive}
                  setConfirmRole={setConfirmRole}
                  setConfirmDisable={setConfirmDisable}
                  setConfirmWaive={setConfirmWaive}
                  onRoleToggle={handleRoleToggle}
                  onToggleActive={handleToggleActive}
                  onWaiveSubscription={handleWaiveSubscription}
                  onRemoveWaiver={handleRemoveWaiver}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminUserList;
