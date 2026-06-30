import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FaCheck,
  FaPlus,
  FaTrashAlt,
  FaArrowLeft,
} from 'react-icons/fa';
import * as Sentry from '@sentry/react';
import { supabase } from '../../supabaseClient';
import { canOwnListing } from '../../lib/policy';
import { useWriteGuard } from '../../lib/useWriteGuard';
import { mapFullListing, listingToRow } from './fiscalAgents.map';
import { FOCUS_AREAS, RESPONSE_TIMES, Field, Toast } from './fiscalAgentsShared';
import './FiscalAgentDirectory.css';

/*
  Listing editor (S10) — /fiscal-agents/listing/edit.
  ---------------------------------------------------
  The charity owner edits their own `fiscal_agent_listings` row via the Supabase
  client (RLS scopes writes to the owner + requires fiscal_agent entitlement).
  Route is guarded `requireRole="admin" billingMode="readOnly"`, so a lapsed
  Fiscal Agent reaches this page read-only; every save routes blocked writes to
  the billing nudge via useWriteGuard. "Publish" requires the owner entitlement,
  completeness of required fields, and is independent of super_admin 501(c)(3)
  verification (which the backend gates).
*/

export default function FiscalAgentListingEditor({ session, readOnly = false }) {
  const navigate = useNavigate();
  const guardWrite = useWriteGuard(session);
  const owner = canOwnListing(session);

  const [listing, setListing] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        // RLS returns the caller's own listing row; take the most recent.
        const { data: rows, error } = await supabase
          .from('fiscal_agent_listings')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        const row = (rows || [])[0];
        if (!cancelled) {
          if (row) {
            const model = mapFullListing(row);
            setListing(model);
            setData({ ...model, focus: [...model.focus], services: [...model.services] });
          } else {
            setListing(null);
          }
        }
      } catch (err) {
        Sentry.captureException(err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function set(key, value) {
    setData((d) => ({ ...d, [key]: value }));
  }

  function toggleFocus(f) {
    setData((d) => ({
      ...d,
      focus: d.focus.includes(f) ? d.focus.filter((x) => x !== f) : [...d.focus, f],
    }));
  }

  function updateService(i, value) {
    setData((d) => {
      const services = [...d.services];
      services[i] = value;
      return { ...d, services };
    });
  }

  function addService() {
    setData((d) => ({ ...d, services: [...d.services, ''] }));
  }

  function removeService(i) {
    setData((d) => ({ ...d, services: d.services.filter((_, idx) => idx !== i) }));
  }

  const valid =
    data && data.name.trim() && data.location.trim() && data.blurb.trim() && data.focus.length > 0;

  async function persist(extra = {}) {
    // Read-only lapse: route the blocked write to the billing nudge.
    if (!guardWrite()) return false;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('fiscal_agent_listings')
        .update({ ...listingToRow(data), ...extra })
        .eq('id', Number(listing.id));
      if (error) throw error;
      return true;
    } catch (err) {
      Sentry.captureException(err);
      setToast({ kind: 'error', msg: 'Could not save your listing. Please try again.' });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!valid) return;
    const ok = await persist();
    if (ok) setToast({ msg: 'Listing updated' });
  }

  async function publish() {
    if (!valid) return;
    const ok = await persist({ status: 'published' });
    if (ok) {
      setListing((l) => ({ ...l, status: 'published' }));
      setToast({ msg: 'Listing submitted for publishing' });
    }
  }

  if (loading) {
    return (
      <div className="fad-page">
        <p className="fad-count">Loading your listing…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="fad-page">
        <div className="fad-empty">
          <p>We couldn’t load your listing. Please try again.</p>
        </div>
      </div>
    );
  }

  if (!listing || !data) {
    return (
      <div className="fad-page">
        <div className="fad-empty">
          <p>You don’t have a listing yet.</p>
          <Link to="/fiscal-agents/list" className="fad-btn fad-btn-primary">
            List your charity
          </Link>
        </div>
      </div>
    );
  }

  const lockWrites = readOnly || !owner;

  return (
    <div className="fad-page">
      <div className="fap-topbar">
        <Link to="/fiscal-agents/me" className="fap-back">
          <FaArrowLeft /> Back to your dashboard
        </Link>
      </div>

      <h2 className="fad-modal-title">Edit your listing</h2>
      <p className="fad-modal-sub">
        Changes appear on your public profile and directory card once saved.
      </p>

      {lockWrites && (
        <div className="subscription-required-alert">
          <strong>Read-only:</strong> Your Fiscal Agent subscription is inactive. You can review
          your listing, but editing and publishing are paused until you renew.
        </div>
      )}

      <div className="fad-form">
        <h4 className="fad-editor-section">Basics</h4>
        <Field label="Organization name" required>
          <input type="text" value={data.name} onChange={(e) => set('name', e.target.value)} disabled={lockWrites} />
        </Field>
        <Field label="Location" required>
          <input
            type="text"
            value={data.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="City, State"
            disabled={lockWrites}
          />
        </Field>
        <Field label="Short description" required>
          <textarea
            rows={2}
            value={data.blurb}
            onChange={(e) => set('blurb', e.target.value)}
            placeholder="One or two sentences organizations see on your card…"
            disabled={lockWrites}
          />
        </Field>
        <Field label="About">
          <textarea
            rows={4}
            value={data.about || ''}
            onChange={(e) => set('about', e.target.value)}
            placeholder="Full description shown on your profile…"
            disabled={lockWrites}
          />
        </Field>

        <h4 className="fad-editor-section">Focus areas</h4>
        <Field label="Focus areas" required>
          <div className="fad-focuspick">
            {FOCUS_AREAS.map((f) => (
              <button
                key={f}
                type="button"
                className={`fad-chip ${data.focus.includes(f) ? 'is-active' : ''}`}
                onClick={() => toggleFocus(f)}
                disabled={lockWrites}
              >
                {f}
              </button>
            ))}
          </div>
        </Field>

        <h4 className="fad-editor-section">Sponsorship terms</h4>
        <div className="fad-editor-grid">
          <Field label="Admin fee (%)">
            <input
              type="number"
              min="0"
              step="0.5"
              value={data.feeNum}
              onChange={(e) => set('feeNum', e.target.value)}
              disabled={lockWrites}
            />
          </Field>
          <Field label="Typical response">
            <select value={data.responseTime} onChange={(e) => set('responseTime', e.target.value)} disabled={lockWrites}>
              <option value="">Select…</option>
              {RESPONSE_TIMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          type="button"
          className={`fad-toggle ${data.accepting ? 'is-active' : ''}`}
          aria-pressed={data.accepting}
          onClick={() => set('accepting', !data.accepting)}
          disabled={lockWrites}
        >
          <FaCheck /> {data.accepting ? 'Accepting projects' : 'Waitlist only'}
        </button>

        <h4 className="fad-editor-section">Services</h4>
        <div className="fad-svc-list">
          {data.services.map((s, i) => (
            <div className="fad-svc-row" key={i}>
              <input
                type="text"
                value={s}
                onChange={(e) => updateService(i, e.target.value)}
                placeholder="e.g. Monthly financial reporting"
                disabled={lockWrites}
              />
              <button
                type="button"
                className="fad-svc-remove"
                onClick={() => removeService(i)}
                aria-label="Remove service"
                disabled={lockWrites}
              >
                <FaTrashAlt />
              </button>
            </div>
          ))}
          <button type="button" className="fad-btn fad-btn-ghost fad-svc-add" onClick={addService} disabled={lockWrites}>
            <FaPlus /> Add service
          </button>
        </div>

        <h4 className="fad-editor-section">Contact</h4>
        <div className="fad-editor-grid">
          <Field label="Website">
            <input
              type="text"
              value={data.website || ''}
              onChange={(e) => set('website', e.target.value)}
              placeholder="yourorg.org"
              disabled={lockWrites}
            />
          </Field>
          <Field label="Email">
            <input type="email" value={data.email || ''} onChange={(e) => set('email', e.target.value)} disabled={lockWrites} />
          </Field>
          <Field label="Phone">
            <input type="text" value={data.phone || ''} onChange={(e) => set('phone', e.target.value)} disabled={lockWrites} />
          </Field>
        </div>
      </div>

      <div className="fad-form-foot">
        <button type="button" className="fad-btn fad-btn-ghost" onClick={() => navigate('/fiscal-agents/me')}>
          Cancel
        </button>
        <button type="button" className="fad-btn fad-btn-ghost" disabled={!valid || saving || lockWrites} onClick={save}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          className="fad-btn fad-btn-primary"
          disabled={!valid || saving || lockWrites || listing.status === 'published'}
          onClick={publish}
        >
          {listing.status === 'published' ? 'Published' : 'Publish listing'}
        </button>
      </div>

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
