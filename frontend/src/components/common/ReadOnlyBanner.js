// src/components/ReadOnlyBanner.js
//
// Shown at the top of admin views when a lapsed admin is in read-only mode
// (#40 read-only degrade). Reads stay open; the banner explains why mutations
// are blocked and links to the billing nudge.
import React from 'react';
import { Link } from 'react-router-dom';
import { FiLock } from 'react-icons/fi';
import { BILLING_NUDGE_PATH } from '../../lib/policy';
import './ReadOnlyBanner.css';

function ReadOnlyBanner({ readOnly }) {
  if (!readOnly) return null;
  return (
    <div role="status" className="admin-readonly-banner">
      <FiLock aria-hidden="true" />
      <span>
        Your subscription has lapsed — this view is read-only. Reactivate your
        subscription to make changes.{' '}
        <Link to={BILLING_NUDGE_PATH}>
          Manage billing
        </Link>
      </span>
    </div>
  );
}

export default ReadOnlyBanner;
