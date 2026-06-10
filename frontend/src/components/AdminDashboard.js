// src/components/AdminDashboard.js
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { FiUsers, FiGrid, FiClock, FiCheckCircle, FiDollarSign, FiArrowRight, FiAlertCircle, FiActivity } from 'react-icons/fi';
import StatusBadge from './StatusBadge';
import './Admin.css';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

function AdminDashboard({ session }) {
  const [stats, setStats] = useState(null);
  const [queue, setQueue] = useState([]);
  const [topGrantees, setTopGrantees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const { data: grants, error: gErr } = await supabase
          .from('grant_record')
          .select('id, grant_name, grant_amount, total_spent, status, created_at, user_id, users(firstname, lastname, organization_name)');

        if (gErr) throw gErr;

        const totalGrantees = new Set(grants.map(g => g.user_id)).size;
        const totalFunding = grants.reduce((s, g) => s + (g.grant_amount || 0), 0);
        const totalSpent = grants.reduce((s, g) => s + (g.total_spent || 0), 0);

        const byStatus = grants.reduce((acc, g) => {
          acc[g.status] = (acc[g.status] || 0) + 1;
          return acc;
        }, {});

        // Pending budget items and expenses counts
        const { count: pendingBudgetItems } = await supabase
          .from('budget_items')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');

        const { count: pendingExpenses } = await supabase
          .from('expenses')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');

        setStats({
          totalGrantees,
          totalGrants: grants.length,
          approved: byStatus['approved'] || 0,
          pending: byStatus['pending'] || 0,
          needsChanges: byStatus['needs_changes'] || 0,
          rejected: byStatus['rejected'] || 0,
          totalFunding,
          totalSpent,
          pendingBudgetItems: pendingBudgetItems || 0,
          pendingExpenses: pendingExpenses || 0,
        });

        // Pending review queue: pending + needs_changes, oldest first, up to 5
        const reviewQueue = grants
          .filter(g => g.status === 'pending' || g.status === 'needs_changes')
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
          .slice(0, 5);

        setQueue(reviewQueue);

        // Top grantees by funding
        const granteeMap = {};
        grants.forEach(g => {
          const key = g.user_id;
          if (!granteeMap[key]) {
            granteeMap[key] = {
              name: g.users?.organization_name || `${g.users?.firstname} ${g.users?.lastname}`,
              Funding: 0,
            };
          }
          granteeMap[key].Funding += (g.grant_amount || 0);
        });
        setTopGrantees(
          Object.values(granteeMap).sort((a, b) => b.Funding - a.Funding).slice(0, 7)
        );
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const fmt = n =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  if (loading) return <div className="admin-page"><p className="admin-loading">Loading dashboard…</p></div>;
  if (error)   return <div className="admin-page"><p className="admin-error">{error}</p></div>;

  const reviewTotal = stats.pending + stats.needsChanges;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h2 className="admin-title">Admin Dashboard</h2>
          <p className="admin-subtitle">Overview of grant activity and review queue</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75em' }}>
          <Link to="/admin/audit" className="admin-back-link">
            <FiActivity /> Audit Log
          </Link>
          <Link to="/admin/grants" className="admin-primary-btn">
            <FiGrid /> All Grants
          </Link>
        </div>
      </div>

      {/* Nudge banner if support contact not set */}
      {session?.tenantConfig && !session.tenantConfig.support_email && !session.tenantConfig.support_phone && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.75em',
          background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)',
          borderLeft: '4px solid #F59E0B', borderRadius: 'var(--radius-md)',
          padding: '0.75em 1.25em', marginBottom: '1.25em', fontSize: '0.9rem', color: '#92400E',
        }}>
          <FiAlertCircle size={16} />
          <span>Your tenant doesn't have support contact info set. <Link to="/admin/settings" style={{ color: '#D97706', fontWeight: 600 }}>Go to Settings</Link> to add it.</span>
        </div>
      )}

      {/* Stat cards — ordered: total grants, approved, pending, needs changes, rejected, total funding, total spent */}
      <div className="admin-stat-grid">
        <Link to="/admin/grants" className="asc-card-link">
          <div className="admin-stat-card">
            <div className="asc-icon users"><FiUsers /></div>
            <div className="asc-body">
              <span className="asc-value">{stats.totalGrantees}</span>
              <span className="asc-label">Grantees</span>
            </div>
          </div>
        </Link>

        <Link to="/admin/grants" className="asc-card-link">
          <div className="admin-stat-card">
            <div className="asc-icon grants"><FiGrid /></div>
            <div className="asc-body">
              <span className="asc-value">{stats.totalGrants}</span>
              <span className="asc-label">Total Grants</span>
            </div>
          </div>
        </Link>

        <Link to="/admin/grants?status=approved" className="asc-card-link">
          <div className="admin-stat-card">
            <div className="asc-icon approved"><FiCheckCircle /></div>
            <div className="asc-body">
              <span className="asc-value">{stats.approved}</span>
              <span className="asc-label">Approved</span>
            </div>
          </div>
        </Link>

        {stats.pending > 0 && (
          <Link to="/admin/grants?status=pending" className="asc-card-link">
            <div className="admin-stat-card highlight-pending">
              <div className="asc-icon pending"><FiClock /></div>
              <div className="asc-body">
                <span className="asc-value">{stats.pending}</span>
                <span className="asc-label">Pending</span>
              </div>
            </div>
          </Link>
        )}

        {stats.needsChanges > 0 && (
          <Link to="/admin/grants?status=needs_changes" className="asc-card-link">
            <div className="admin-stat-card">
              <div className="asc-icon pending"><FiClock /></div>
              <div className="asc-body">
                <span className="asc-value">{stats.needsChanges}</span>
                <span className="asc-label">Needs Changes</span>
              </div>
            </div>
          </Link>
        )}

        {stats.rejected > 0 && (
          <Link to="/admin/grants?status=rejected" className="asc-card-link">
            <div className="admin-stat-card">
              <div className="asc-icon" style={{ background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)' }}>
                <FiCheckCircle />
              </div>
              <div className="asc-body">
                <span className="asc-value">{stats.rejected}</span>
                <span className="asc-label">Rejected</span>
              </div>
            </div>
          </Link>
        )}

        <div className="admin-stat-card">
          <div className="asc-icon funding"><FiDollarSign /></div>
          <div className="asc-body">
            <span className="asc-value">{fmt(stats.totalFunding)}</span>
            <span className="asc-label">Total Funding</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="asc-icon grants"><FiDollarSign /></div>
          <div className="asc-body">
            <span className="asc-value">{fmt(stats.totalSpent)}</span>
            <span className="asc-label">Approved Spent</span>
          </div>
        </div>

        {stats.pendingBudgetItems > 0 && (
          <Link to="/admin/grants?pending=budgets" className="asc-card-link">
            <div className="admin-stat-card highlight-pending">
              <div className="asc-icon pending"><FiAlertCircle /></div>
              <div className="asc-body">
                <span className="asc-value">{stats.pendingBudgetItems}</span>
                <span className="asc-label">Pending Budget Items</span>
              </div>
            </div>
          </Link>
        )}

        {stats.pendingExpenses > 0 && (
          <Link to="/admin/grants?pending=expenses" className="asc-card-link">
            <div className="admin-stat-card highlight-pending">
              <div className="asc-icon pending"><FiAlertCircle /></div>
              <div className="asc-body">
                <span className="asc-value">{stats.pendingExpenses}</span>
                <span className="asc-label">Pending Expenses</span>
              </div>
            </div>
          </Link>
        )}
      </div>

      {/* Charts */}
      {stats.totalGrants > 0 && (() => {
        const fmtK = v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;
        const statusData = [
          { name: 'Approved',      value: stats.approved,      fill: '#10B981' },
          { name: 'Pending',       value: stats.pending,        fill: '#F59E0B' },
          { name: 'Needs Changes', value: stats.needsChanges,   fill: '#D97706' },
          { name: 'Rejected',      value: stats.rejected,       fill: '#EF4444' },
        ].filter(d => d.value > 0);
        const barHeight = Math.max(topGrantees.length * 50 + 60, 180);
        return (
          <div className="charts-row">
            <div className="chart-card">
              <p className="chart-card-title">Grants by Status</p>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90}>
                    {statusData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v, name) => [v, name]} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-card">
              <p className="chart-card-title">Top Grantees by Funding</p>
              {topGrantees.length > 0 ? (
                <ResponsiveContainer width="100%" height={barHeight}>
                  <BarChart data={topGrantees} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={v => [`$${v.toLocaleString()}`, 'Funding']} />
                    <Bar dataKey="Funding" fill="#065F46" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="chart-empty">No grantee data yet.</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Review queue — hide when grant approval is off */}
      {session?.tenantConfig?.require_grant_approval !== false && (
      <div className="admin-section">
        <div className="admin-section-header">
          <h3>
            <FiClock /> Pending Review
            {reviewTotal > 0 && <span className="queue-badge">{reviewTotal}</span>}
          </h3>
          <Link to="/admin/grants?status=pending" className="admin-link">
            View all <FiArrowRight />
          </Link>
        </div>

        {queue.length === 0 ? (
          <p className="admin-empty">No grants awaiting review.</p>
        ) : (
          <div className="admin-queue-list">
            {queue.map(g => (
              <div key={g.id} className="admin-queue-item">
                <div className="aqi-info">
                  <span className="aqi-name">{g.grant_name || `Grant #${g.id}`}</span>
                  <span className="aqi-amount">
                    {fmt(g.grant_amount)} · {g.users?.organization_name || `${g.users?.firstname} ${g.users?.lastname}`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', flexShrink: 0 }}>
                  <StatusBadge status={g.status} />
                  <Link to={`/admin/grants/${g.id}`} className="admin-review-btn small">
                    Review <FiArrowRight />
                  </Link>
                </div>
              </div>
            ))}
            {reviewTotal > 5 && (
              <p className="admin-more">+ {reviewTotal - 5} more awaiting review</p>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export default AdminDashboard;
