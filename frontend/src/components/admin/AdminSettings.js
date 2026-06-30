// src/components/AdminSettings.js
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { FiArrowLeft, FiSettings, FiSave } from 'react-icons/fi';
import { useWriteGuard } from '../../lib/useWriteGuard';
import ReadOnlyBanner from '../common/ReadOnlyBanner';
import './Admin.css';

function AdminSettings({ session, readOnly = false }) {
  const guardWrite = useWriteGuard(session);
  const tenantConfig = session?.tenantConfig;
  const tenantId = session?.userRecord?.tenant_id;

  const [requireGrant, setRequireGrant] = useState(tenantConfig?.require_grant_approval ?? true);
  const [requireBudget, setRequireBudget] = useState(tenantConfig?.require_budget_approval ?? true);
  const [requireExpense, setRequireExpense] = useState(tenantConfig?.require_expense_approval ?? true);
  const [supportEmail, setSupportEmail] = useState(tenantConfig?.support_email || '');
  const [supportPhone, setSupportPhone] = useState(tenantConfig?.support_phone || '');

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const hasChanges =
    requireGrant !== (tenantConfig?.require_grant_approval ?? true) ||
    requireBudget !== (tenantConfig?.require_budget_approval ?? true) ||
    requireExpense !== (tenantConfig?.require_expense_approval ?? true) ||
    supportEmail !== (tenantConfig?.support_email || '') ||
    supportPhone !== (tenantConfig?.support_phone || '');

  async function handleSave() {
    if (!guardWrite()) return;
    setSaving(true);
    setError('');
    setSuccess('');

    const { error: err } = await supabase
      .from('tenant_settings')
      .update({
        require_grant_approval: requireGrant,
        require_budget_approval: requireBudget,
        require_expense_approval: requireExpense,
        support_email: supportEmail.trim() || null,
        support_phone: supportPhone.trim() || null,
      })
      .eq('tenant_id', tenantId);

    setSaving(false);
    if (err) {
      setError(err.message);
    } else {
      setSuccess('Settings saved.');
      // Update session tenantConfig in memory
      if (tenantConfig) {
        tenantConfig.require_grant_approval = requireGrant;
        tenantConfig.require_budget_approval = requireBudget;
        tenantConfig.require_expense_approval = requireExpense;
        tenantConfig.support_email = supportEmail.trim() || null;
        tenantConfig.support_phone = supportPhone.trim() || null;
      }
    }
  }

  return (
    <div className="admin-page">
      <ReadOnlyBanner readOnly={readOnly} />
      <div className="admin-header">
        <div>
          <h2 className="admin-title"><FiSettings /> Settings</h2>
          <p className="admin-subtitle">Approval workflows and support contact information</p>
        </div>
        <Link to="/admin" className="admin-back-link">
          <FiArrowLeft /> Dashboard
        </Link>
      </div>

      <div className="admin-card" style={{ maxWidth: '640px' }}>
        <p style={{ color: '#6b7280', fontSize: '0.88rem', marginBottom: '1.5em', lineHeight: 1.6 }}>
          When approval is <strong>required</strong>, new records start as "Pending" and must be reviewed by an admin.
          When <strong>off</strong>, new records are automatically approved on creation.
          Changes only affect newly created records - existing pending records are not retroactively approved.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25em' }}>
          <ToggleRow
            label="Grant Approval"
            description="New grant applications require admin review before approval"
            checked={requireGrant}
            onChange={setRequireGrant}
          />
          <ToggleRow
            label="Budget Item Approval"
            description="New budget line items require admin review before counting toward totals"
            checked={requireBudget}
            onChange={setRequireBudget}
          />
          <ToggleRow
            label="Expense Approval"
            description="New expenses require admin review before counting toward grant spent totals"
            checked={requireExpense}
            onChange={setRequireExpense}
          />
        </div>

        <h4 style={{ margin: '2em 0 0.5em', fontSize: '1rem', fontWeight: 600, color: '#1a1a1a', fontFamily: 'var(--font-body)' }}>Support Contact</h4>
        <p style={{ color: '#6b7280', fontSize: '0.88rem', marginBottom: '1em', lineHeight: 1.6 }}>
          Displayed in the footer for all users in your tenant. If not set, a default platform contact is shown.
        </p>

        <div style={{ display: 'flex', gap: '1em', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Support Email</label>
            <input
              type="email"
              placeholder="support@yourorg.com"
              value={supportEmail}
              onChange={e => setSupportEmail(e.target.value)}
              style={{ width: '100%', padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Support Phone</label>
            <input
              type="tel"
              placeholder="(555) 123-4567"
              value={supportPhone}
              onChange={e => setSupportPhone(e.target.value)}
              style={{ width: '100%', padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
            />
          </div>
        </div>

        {error && (
          <p style={{ color: '#991b1b', fontSize: '0.88rem', marginTop: '1em' }}>{error}</p>
        )}
        {success && (
          <p style={{ color: 'var(--color-success)', fontSize: '0.88rem', marginTop: '1em' }}>{success}</p>
        )}

        <div style={{ marginTop: '1.5em' }}>
          <button
            className="admin-approve-btn"
            onClick={handleSave}
            disabled={saving || !hasChanges || readOnly}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4em', opacity: (hasChanges && !readOnly) ? 1 : 0.5 }}
          >
            <FiSave size={15} /> {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '1em', background: '#f9fafb', borderRadius: '8px', border: '1px solid #f3f4f6',
    }}>
      <div>
        <span style={{ fontWeight: 600, fontSize: '0.95rem', fontFamily: 'var(--font-body)' }}>{label}</span>
        <p style={{ color: '#6b7280', fontSize: '0.82rem', margin: '0.25em 0 0', fontFamily: 'var(--font-body)' }}>{description}</p>
      </div>
      <label className="toggle-switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
        />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

export default AdminSettings;
