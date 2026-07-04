import React, { useState } from 'react';
import { FiUserPlus, FiCopy, FiX } from 'react-icons/fi';
import { createUserInvite } from '../../lib/data/users';
import './Admin.css';

/**
 * Inline "Invite New User" card: generates a signup invite link for the
 * admin's tenant. Owns its own form state; writes route through guardWrite.
 *
 * @param {Object} props
 * @param {Object} props.session
 * @param {() => boolean} props.guardWrite
 * @param {() => void} props.onClose
 */
export default function InviteUserForm({ session, guardWrite, onClose }) {
  const [inviteRole, setInviteRole] = useState('grantee');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleCreateInvite() {
    if (!guardWrite()) return;
    setInviteLoading(true);
    setInviteError('');
    setInviteLink('');
    setCopied(false);

    const tenantId = session?.userRecord?.tenant_id;
    const { data, error: err } = await createUserInvite({
      tenant_id: tenantId,
      role: inviteRole,
      email: inviteEmail.trim() || null,
      created_by: session?.user?.id,
    });

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

  return (
    <div className="admin-card" style={{ marginBottom: '1.5em' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1em' }}>
        <h3 className="admin-card-title" style={{ margin: 0 }}><FiUserPlus /> Invite New User</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
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
  );
}
