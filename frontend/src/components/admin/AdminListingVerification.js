// Super-admin surface for verifying new Fiscal Agent listings. A listing only
// appears in the public directory once status='published' AND verification=
// 'verified'; owners can publish but cannot self-verify, so this is where a
// platform super admin approves (or rejects) the 501(c)(3) status.
import React, { useState, useEffect } from 'react';
import { FiShield, FiCheckCircle, FiXCircle } from 'react-icons/fi';
import { fmtDate } from '../../lib/format';
import { listPendingListings, setListingVerification } from '../../lib/data/fiscalAgentListings';
import './Admin.css';

function AdminListingVerification() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);

  useEffect(() => { fetchPending(); }, []);

  async function fetchPending() {
    setLoading(true);
    setError('');
    const { data, error: err } = await listPendingListings();
    if (err) { setError(err.message); setLoading(false); return; }
    setListings(data || []);
    setLoading(false);
  }

  async function handleSetVerification(listing, verification) {
    setSaving(listing.id);
    const { error: err } = await setListingVerification(listing.id, verification);
    setSaving(null);
    if (err) { alert('Error updating listing: ' + err.message); return; }
    setListings(prev => prev.filter(l => l.id !== listing.id));
  }

  if (loading) return <div className="admin-page"><p className="admin-loading">Loading listings…</p></div>;
  if (error) return <div className="admin-page"><p className="admin-error">{error}</p></div>;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h2 className="admin-title"><FiShield /> Fiscal Agent Verification</h2>
          <p className="admin-subtitle">
            {listings.length} listing{listings.length !== 1 ? 's' : ''} awaiting verification
          </p>
        </div>
      </div>

      {listings.length === 0 ? (
        <p className="admin-empty">No listings awaiting verification.</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Location</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {listings.map(l => (
                <tr key={l.id}>
                  <td className="grant-name-cell" style={{ fontWeight: 600 }} title={l.name}>{l.name}</td>
                  <td>{l.location || '—'}</td>
                  <td>
                    <span className={`user-status-pill ${l.status === 'published' ? 'status-active' : 'status-disabled'}`}>
                      {l.status === 'published' ? 'Published — will go live' : l.status}
                    </span>
                  </td>
                  <td className="date-cell">{fmtDate(l.created_at)}</td>
                  <td className="user-actions-cell">
                    <button
                      className="user-action-btn enable"
                      disabled={saving === l.id}
                      onClick={() => handleSetVerification(l, 'verified')}
                    >
                      <FiCheckCircle size={13} /> Verify
                    </button>
                    <button
                      className="user-action-btn disable"
                      disabled={saving === l.id}
                      onClick={() => handleSetVerification(l, 'rejected')}
                    >
                      <FiXCircle size={13} /> Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminListingVerification;
