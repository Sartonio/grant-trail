import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FaPen, FaInbox, FaIdCard } from 'react-icons/fa';
import * as Sentry from '@sentry/react';
import { supabase } from '../../supabaseClient';
import { canOwnListing, isReadOnlyAdmin, BILLING_NUDGE_PATH } from '../../lib/policy';
import { useWriteGuard } from '../../lib/useWriteGuard';
import { mapFullListing, mapInquiry } from './fiscalAgents.map';
import { OwnerListingPanel, listingCompleteness, Toast } from './fiscalAgentsShared';
import FiscalAgentInbox from './FiscalAgentInbox';
import './FiscalAgentDirectory.css';

/*
  Owner dashboard (S11) + Sponsorship inbox (S12) — /fiscal-agents/me[ /inbox ].
  -----------------------------------------------------------------------------
  Reads the owner's `fiscal_agent_listings` row + their `sponsorship_inquiries`
  via the Supabase client (RLS scopes both to the caller's owned listing). Route
  is guarded `requireRole="admin" billingMode="readOnly"`: a lapsed Fiscal Agent
  keeps READ access (view listing + inbox) but every mutation — accepting toggle,
  inquiry status change — routes to the billing nudge via useWriteGuard (#40).

  `tab` selects the active surface so the same component backs both /fiscal-agents/me
  and /fiscal-agents/me/inbox.
*/

export default function FiscalAgentOwnerDashboard({ session, readOnly: readOnlyProp = false, tab = 'overview' }) {
  const navigate = useNavigate();
  const guardWrite = useWriteGuard(session);
  // The route guard injects readOnly for a lapsed admin; fall back to the policy
  // helper so the component is correct even if rendered without the guard.
  const readOnly = readOnlyProp || isReadOnlyAdmin(session) || !canOwnListing(session);

  const [activeTab, setActiveTab] = useState(tab);
  const [listing, setListing] = useState(null);
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setActiveTab(tab);
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const { data: rows, error } = await supabase
          .from('fiscal_agent_listings')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        const row = (rows || [])[0];
        const model = row ? mapFullListing(row) : null;
        if (!cancelled) setListing(model);

        if (model) {
          const { data: inqRows, error: inqError } = await supabase
            .from('sponsorship_inquiries')
            .select('*')
            .eq('listing_id', Number(model.id))
            .order('submitted_at', { ascending: false });
          if (inqError) throw inqError;
          if (!cancelled) setInquiries((inqRows || []).map(mapInquiry));
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

  const completeness = useMemo(
    () => (listing ? listingCompleteness(listing) : 0),
    [listing],
  );

  async function toggleAccepting() {
    if (!guardWrite()) return;
    const nextAccepting = !listing.accepting;
    // Optimistic update with rollback on failure.
    setListing((l) => ({ ...l, accepting: nextAccepting }));
    try {
      const { error } = await supabase
        .from('fiscal_agent_listings')
        .update({ accepting: nextAccepting })
        .eq('id', Number(listing.id));
      if (error) throw error;
    } catch (err) {
      Sentry.captureException(err);
      setListing((l) => ({ ...l, accepting: !nextAccepting }));
      setToast({ kind: 'error', msg: 'Could not update. Please try again.' });
    }
  }

  async function handleUpdateStatus(inquiryId, nextStatus) {
    if (!guardWrite()) return;
    const prev = inquiries;
    setInquiries((list) => list.map((q) => (q.id === inquiryId ? { ...q, status: nextStatus } : q)));
    try {
      const { error } = await supabase
        .from('sponsorship_inquiries')
        .update({ status: nextStatus })
        .eq('id', Number(inquiryId));
      if (error) throw error;
    } catch (err) {
      Sentry.captureException(err);
      setInquiries(prev);
      setToast({ kind: 'error', msg: 'Could not update the application. Please try again.' });
    }
  }

  function handleOnboard(inquiry) {
    if (!guardWrite()) return;
    // Bridge into GrantTrail is a backend concern (invite a grantee under the
    // charity tenant); surface a confirmation for now per UX §2.1 step 10.
    setToast({ msg: `Onboarding ${inquiry.project?.name || 'project'} as a grantee…` });
  }

  if (loading) {
    return (
      <div className="fad-page">
        <p className="fad-count">Loading your dashboard…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="fad-page">
        <div className="fad-empty">
          <p>We couldn’t load your dashboard. Please try again.</p>
        </div>
      </div>
    );
  }

  if (!listing) {
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

  return (
    <div className="fad-page">
      <section className="fad-owner-banner">
        <div>
          <strong>{listing.name}</strong>
          {readOnly ? (
            <>
              {' '}is {listing.status === 'published' ? 'live' : 'unlisted'} — your Fiscal Agent
              subscription is inactive, so your listing is unlisted from the directory and this
              dashboard is read-only.{' '}
              <Link to={BILLING_NUDGE_PATH} className="fad-link">Resubscribe to edit</Link>.
            </>
          ) : (
            <> is {listing.status === 'published' ? 'live' : 'in draft'}. Keep your profile complete to rank higher.</>
          )}
        </div>
        <button
          type="button"
          className="fad-btn fad-btn-primary"
          onClick={() => navigate('/fiscal-agents/listing/edit')}
        >
          <FaPen /> {readOnly ? 'View your listing' : 'Edit your listing'}
        </button>
      </section>

      <div className="fad-owner-tabs" role="tablist" aria-label="Owner dashboard sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          className={`fad-toggle ${activeTab === 'overview' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <FaIdCard /> Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'inbox'}
          className={`fad-toggle ${activeTab === 'inbox' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('inbox')}
        >
          <FaInbox /> Sponsorship inbox
        </button>
      </div>

      {activeTab === 'overview' ? (
        <OwnerListingPanel
          listing={listing}
          completeness={completeness}
          status={listing.status}
          readOnly={readOnly}
          onEdit={() => navigate('/fiscal-agents/listing/edit')}
          onToggleAccepting={toggleAccepting}
        />
      ) : (
        <FiscalAgentInbox
          inquiries={inquiries}
          onUpdateStatus={handleUpdateStatus}
          onOnboard={handleOnboard}
          readOnly={readOnly}
        />
      )}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
