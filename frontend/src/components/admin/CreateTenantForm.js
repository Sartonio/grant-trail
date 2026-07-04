import React, { useState } from 'react';
import { FiPlus, FiX, FiCopy } from 'react-icons/fi';
import {
  createTenant, createTenantSettings, createTenantAdminInvite,
} from '../../lib/data/tenants';
import './Admin.css';

/**
 * Inline "New Tenant" card: creates the tenant + default settings + first
 * admin invite. Owns its own form state.
 *
 * @param {Object} props
 * @param {Object} props.session
 * @param {() => void} props.onClose
 * @param {() => Promise<void>} props.onCreated - refetch the tenant list
 */
export default function CreateTenantForm({ session, onClose, onCreated }) {
  const [newName, setNewName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);

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
    const { data: tenant, error: tErr } = await createTenant({ name: newName.trim(), slug, tenant_type: 'managed' });

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
    const { error: sErr } = await createTenantSettings({
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
    const { data: invite, error: iErr } = await createTenantAdminInvite({
      tenant_id: tenant.id,
      role: 'admin',
      email: adminEmail.trim().toLowerCase(),
      created_by: session?.user?.id,
    });

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
    await onCreated();
  }

  return (
    <div className="admin-card" style={{ marginBottom: '1.5em' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1em' }}>
        <h3 className="admin-card-title" style={{ margin: 0 }}><FiPlus /> New Tenant</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
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
            onChange={e => setNewName(e.target.value)}
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
  );
}
