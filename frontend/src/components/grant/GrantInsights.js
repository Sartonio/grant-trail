import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line,
} from 'recharts';
import {
  FaFileAlt, FaClock, FaCheckCircle, FaTimesCircle, FaDollarSign,
  FaPercentage, FaArrowLeft,
} from 'react-icons/fa';
import { listGrantInsightsForUser } from '../../lib/data/grants';
import { computeGrantInsights } from '../../lib/grantInsights';
import { formatCurrency } from '../../lib/format';
import StatusBadge from '../common/StatusBadge';
import './GrantInsights.css';

// Series colors — mirrored between charts and the tables so identity is never
// encoded by color alone (legends + exact numbers in tables carry the data).
const COLORS = {
  pending: '#F59E0B',
  approved: '#10B981',
  declined: '#EF4444',
  needsChanges: '#D97706',
  requested: '#3B82F6',
  awarded: '#10B981',
};

/** "$1,235" — compact whole-dollar axis/tooltip currency. */
const fmtMoney = (n) => formatCurrency(n, 0);

/** Success rate as a whole-percent string, or an em dash when undecided.
 * @param {number|null} rate */
function fmtRate(rate) {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

function StatTile({ title, value, icon, accentColor }) {
  return (
    <div className="gi-tile" style={{ '--accent-color': accentColor }}>
      <div className="gi-tile-icon">{icon}</div>
      <div className="gi-tile-content">
        <h3>{title}</h3>
        <p className="gi-tile-value">{value}</p>
      </div>
    </div>
  );
}

export default function GrantInsights({ session }) {
  const [grants, setGrants] = useState(null); // null = loading

  useEffect(() => {
    let active = true;
    async function load() {
      const userId = session?.userRecord?.id;
      if (!userId) return;
      const { data, error } = await listGrantInsightsForUser(userId);
      if (!active) return;
      setGrants(error ? [] : (data || []));
    }
    load();
    return () => { active = false; };
  }, [session]);

  const insights = useMemo(() => computeGrantInsights(grants || []), [grants]);
  const { overall, byYear, bySource } = insights;

  // Per-grant rows for the accessible table (newest year first).
  const grantRows = useMemo(() => {
    const rows = (grants || []).map((g) => ({
      ...g,
      year: (g.submitted_at || g.created_at)
        ? new Date(g.submitted_at || g.created_at).getUTCFullYear()
        : null,
    }));
    return rows.sort((a, b) => (b.year || 0) - (a.year || 0));
  }, [grants]);

  const anyNeedsChanges = overall.needsChanges > 0;
  const successYears = byYear.filter((y) => y.successRate != null);

  if (grants === null) {
    return (
      <div className="gi-page">
        <div className="gi-loading">Loading grant insights…</div>
      </div>
    );
  }

  if (overall.total === 0) {
    return (
      <div className="gi-page">
        <GiHeader />
        <div className="gi-empty">
          <p>No grant applications yet</p>
          <Link to="/grants/new" className="gi-cta">Create your first application</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="gi-page">
      <GiHeader />

      {/* Stat tiles */}
      <div className="gi-tiles">
        <StatTile title="Applications" value={overall.total} icon={<FaFileAlt />} accentColor="var(--color-primary)" />
        <StatTile title="Pending" value={overall.pending} icon={<FaClock />} accentColor={COLORS.pending} />
        <StatTile title="Approved" value={overall.approved} icon={<FaCheckCircle />} accentColor={COLORS.approved} />
        <StatTile title="Declined" value={overall.declined} icon={<FaTimesCircle />} accentColor={COLORS.declined} />
        <StatTile title="Success Rate" value={fmtRate(overall.successRate)} icon={<FaPercentage />} accentColor="var(--color-gold)" />
        <StatTile title="Requested" value={fmtMoney(overall.requested)} icon={<FaDollarSign />} accentColor={COLORS.requested} />
        <StatTile title="Awarded" value={fmtMoney(overall.awarded)} icon={<FaDollarSign />} accentColor={COLORS.awarded} />
      </div>

      {/* Chart A — Applications per year by status (stacked) */}
      <section className="gi-chart-card">
        <h3 className="gi-chart-title">Applications per year by status</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={byYear} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar stackId="s" dataKey="pending" name="Pending" fill={COLORS.pending} barSize={28} />
            {anyNeedsChanges && (
              <Bar stackId="s" dataKey="needsChanges" name="Needs changes" fill={COLORS.needsChanges} barSize={28} />
            )}
            <Bar stackId="s" dataKey="declined" name="Declined" fill={COLORS.declined} barSize={28} />
            <Bar stackId="s" dataKey="approved" name="Approved" fill={COLORS.approved} barSize={28} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Chart B — Requested vs awarded per year (grouped) */}
      <section className="gi-chart-card">
        <h3 className="gi-chart-title">Funding requested vs awarded per year</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={byYear} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={fmtMoney} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v) => fmtMoney(Number(v))} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar dataKey="requested" name="Requested" fill={COLORS.requested} barSize={28} radius={[4, 4, 0, 0]} />
            <Bar dataKey="awarded" name="Awarded" fill={COLORS.awarded} barSize={28} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Chart C — Success rate trend */}
      {successYears.length > 0 && (
        <section className="gi-chart-card">
          <h3 className="gi-chart-title">Success rate trend (approved of decided)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={successYears.map((y) => ({ year: y.year, rate: Math.round(y.successRate * 100) }))}
              margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line type="monotone" dataKey="rate" name="Success rate" stroke="#D89F01" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Funding sources table (accessible view of the source breakdown) */}
      <section className="gi-table-card">
        <h3 className="gi-chart-title">Funding sources</h3>
        <table className="gi-table">
          <thead>
            <tr>
              <th>Source</th>
              <th className="gi-num">Applications</th>
              <th className="gi-num">Requested</th>
              <th className="gi-num">Awarded</th>
            </tr>
          </thead>
          <tbody>
            {bySource.map((s) => (
              <tr key={s.source}>
                <td>{s.source}</td>
                <td className="gi-num">{s.count}</td>
                <td className="gi-num">{fmtMoney(s.requested)}</td>
                <td className="gi-num">{fmtMoney(s.awarded)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Per-grant table (exact numbers + shared StatusBadge) */}
      <section className="gi-table-card">
        <h3 className="gi-chart-title">Applications</h3>
        <table className="gi-table">
          <thead>
            <tr>
              <th className="gi-num">Year</th>
              <th>Grant</th>
              <th>Source</th>
              <th>Status</th>
              <th className="gi-num">Requested</th>
            </tr>
          </thead>
          <tbody>
            {grantRows.map((g) => (
              <tr key={g.id}>
                <td className="gi-num">{g.year ?? '—'}</td>
                <td>{g.grant_name || `Grant #${g.id}`}</td>
                <td>{g.funding_source && g.funding_source.trim() ? g.funding_source : 'Unspecified'}</td>
                <td><StatusBadge status={g.status} /></td>
                <td className="gi-num">{fmtMoney(Number(g.grant_amount) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function GiHeader() {
  return (
    <div className="gi-page-header">
      <div>
        <h2 className="gi-page-title">Grant Insights</h2>
        <p className="gi-page-subtitle">Your grant application activity over time</p>
      </div>
      <Link to="/grants" className="gi-back-link">
        <FaArrowLeft /> Back to grants
      </Link>
    </div>
  );
}
