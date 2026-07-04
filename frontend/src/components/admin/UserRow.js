import React from 'react';
import {
  FiShield, FiUser, FiCheckCircle, FiXCircle, FiLink, FiAlertCircle,
} from 'react-icons/fi';
import { fmtDate } from '../../lib/format';
import './Admin.css';

/**
 * One row of the user-management table. Purely presentational — confirm
 * state and mutation handlers live in AdminUserList so only one confirm
 * of each kind is open across the whole table.
 *
 * Props: user, membership (active membership row), isSelf, isTfacTenant,
 * isSavingThis, the three confirm states + setters (confirmRole/Disable/Waive),
 * and the mutation handlers (onRoleToggle, onToggleActive,
 * onWaiveSubscription, onRemoveWaiver).
 */
/** @param {any} props */
export default function UserRow(props) {
  const {
    user: u, membership, isSelf, isTfacTenant, isSavingThis,
    confirmRole, confirmDisable, confirmWaive,
    setConfirmRole, setConfirmDisable, setConfirmWaive,
    onRoleToggle, onToggleActive, onWaiveSubscription, onRemoveWaiver,
  } = props;
  const isSuperAdmin = u.role === 'super_admin';
  const isDisabled = !u.is_active;

  return (
    <tr className={isDisabled ? 'user-row-disabled' : ''}>

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
        ) : membership?.source === 'manual' ? (
          <span className="user-status-pill" style={{ background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd' }}>Waived</span>
        ) : membership?.membership_tier === 'premium' ? (
          <span className="user-status-pill" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>Fiscal Agents Plan (Paid)</span>
        ) : membership?.membership_tier === 'basic' ? (
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
                  onClick={() => onRoleToggle(u)}
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
                  onClick={() => onToggleActive(u)}
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
              confirmWaive?.uid === u.id ? (
                <span className="user-confirm-group">
                  <span className="user-confirm-label">
                    {confirmWaive.action === 'remove'
                      ? `Remove subscription waiver for ${u.firstname} ${u.lastname}? This will cut off their access if they have no active subscription.`
                      : `Waive subscription for ${u.firstname} ${u.lastname}? They will get full access without a paid subscription.`}
                  </span>
                  <button
                    className="user-action-btn confirm"
                    disabled={isSavingThis}
                    onClick={() => {
                      setConfirmWaive(null);
                      confirmWaive.action === 'remove' ? onRemoveWaiver(u) : onWaiveSubscription(u);
                    }}
                  >
                    Yes
                  </button>
                  <button
                    className="user-action-btn cancel"
                    onClick={() => setConfirmWaive(null)}
                  >
                    No
                  </button>
                </span>
              ) : membership?.source === 'manual' ? (
                <button
                  className="user-action-btn disable"
                  title={u.role === 'admin' ? 'Remove waiver — admin will need a Fiscal Agents plan subscription' : 'Remove waiver — user will need a Stripe subscription'}
                  onClick={() => { setConfirmRole(null); setConfirmDisable(null); setConfirmWaive({ uid: u.id, action: 'remove' }); }}
                  disabled={isSavingThis}
                >
                  <FiXCircle size={13} /> Remove Waiver
                </button>
              ) : !membership ? (
                <button
                  className="user-action-btn enable"
                  title={u.role === 'admin' ? 'Waive subscription — grant fiscal agent access without billing' : 'Waive subscription — grant full access for free'}
                  onClick={() => { setConfirmRole(null); setConfirmDisable(null); setConfirmWaive({ uid: u.id, action: 'waive' }); }}
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
}
