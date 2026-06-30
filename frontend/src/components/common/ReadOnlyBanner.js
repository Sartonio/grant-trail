// src/components/ReadOnlyBanner.js
//
// Shown at the top of admin views when a lapsed admin is in read-only mode
// (#40 read-only degrade). Reads stay open; the banner explains why mutations
// are blocked and links to the billing nudge.
import React from 'react';
import { Link } from 'react-router-dom';
import { FiLock } from 'react-icons/fi';
import { BILLING_NUDGE_PATH } from '../../lib/policy';

function ReadOnlyBanner({ readOnly }) {
  if (!readOnly) return null;
  return (
    <div
      role="status"
      className="admin-readonly-banner"
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6em',
        background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e',
        borderRadius: 8, padding: '0.75em 1em', margin: '0 0 1em',
        fontSize: '0.92rem',
      }}
    >
      <FiLock aria-hidden="true" />
      <span>
        Your subscription has lapsed — this view is read-only. Reactivate your
        subscription to make changes.{' '}
        <Link to={BILLING_NUDGE_PATH} style={{ color: '#92400e', fontWeight: 600 }}>
          Manage billing
        </Link>
      </span>
    </div>
  );
}

export default ReadOnlyBanner;
