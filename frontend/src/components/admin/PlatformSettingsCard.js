import React, { useState, useEffect } from 'react';
import { FiGrid, FiSave } from 'react-icons/fi';
import { getPlatformSettings, updatePlatformSettings } from '../../lib/data/tenants';
import './Admin.css';

/**
 * Platform Defaults card: default support contact + alert webhook URL.
 * Self-contained — fetches on mount and owns all of its own state.
 */
export default function PlatformSettingsCard() {
  const [platformEmail, setPlatformEmail] = useState('');
  const [platformPhone, setPlatformPhone] = useState('');
  const [platformWebhook, setPlatformWebhook] = useState('');
  const [platformSaving, setPlatformSaving] = useState(false);
  const [platformSuccess, setPlatformSuccess] = useState('');
  const [platformError, setPlatformError] = useState('');
  const [platformOriginal, setPlatformOriginal] = useState({ email: '', phone: '', webhook: '' });

  useEffect(() => {
    async function fetchPlatformSettings() {
      const { data } = await getPlatformSettings();
      if (data) {
        setPlatformEmail(data.default_support_email || '');
        setPlatformPhone(data.default_support_phone || '');
        setPlatformWebhook(data.alert_webhook_url || '');
        setPlatformOriginal({
          email: data.default_support_email || '',
          phone: data.default_support_phone || '',
          webhook: data.alert_webhook_url || '',
        });
      }
    }
    fetchPlatformSettings();
  }, []);

  async function handleSavePlatformSettings() {
    setPlatformSaving(true);
    setPlatformError('');
    setPlatformSuccess('');
    const { error: err } = await updatePlatformSettings({
      default_support_email: platformEmail.trim() || 'support@granttrail.org',
      default_support_phone: platformPhone.trim() || '(555) 123-4567',
      alert_webhook_url: platformWebhook.trim() || null,
    });
    setPlatformSaving(false);
    if (err) {
      setPlatformError(err.message);
    } else {
      setPlatformSuccess('Platform settings saved.');
      setPlatformOriginal({
        email: platformEmail.trim(),
        phone: platformPhone.trim(),
        webhook: platformWebhook.trim(),
      });
    }
  }

  const platformHasChanges =
    platformEmail !== platformOriginal.email ||
    platformPhone !== platformOriginal.phone ||
    platformWebhook !== platformOriginal.webhook;

  return (
    <div className="admin-card" style={{ maxWidth: '640px', marginTop: '2em' }}>
      <h3 className="admin-card-title" style={{ margin: '0 0 0.5em' }}><FiGrid /> Platform Defaults</h3>
      <p style={{ color: '#6b7280', fontSize: '0.88rem', marginBottom: '1em', lineHeight: 1.6 }}>
        Default support contact shown in the footer for all self-service users and for managed tenants that haven't set their own.
      </p>

      <div style={{ display: 'flex', gap: '1em', flexWrap: 'wrap', marginBottom: '1em' }}>
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

      <div style={{ marginBottom: '1.25em' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3em', fontFamily: 'var(--font-body)' }}>Alerting Webhook URL</label>
        <input
          type="url"
          placeholder="e.g. https://hooks.slack.com/services/..."
          value={platformWebhook}
          onChange={e => setPlatformWebhook(e.target.value)}
          style={{ width: '100%', padding: '0.5em 1em', borderRadius: '6px', border: '1.5px solid #e5e7eb', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}
        />
        <p style={{ color: '#6b7280', fontSize: '0.78rem', marginTop: '0.3em', lineHeight: 1.4, fontFamily: 'var(--font-body)' }}>
          Sends an HTTP POST alert for critical system failures (e.g. Stripe webhook processing failures) using database webhooks.
        </p>
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
  );
}
