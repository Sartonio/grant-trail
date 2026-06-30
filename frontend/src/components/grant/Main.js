import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import {
  FaFileAlt,
  FaClock,
  FaCheckCircle,
  FaTimesCircle,
  FaDollarSign,
  FaPlusCircle,
  FaList,
  FaChartBar,
  FaExclamationTriangle,
  FaArrowRight,
  FaCalendarAlt,
  FaTimes
} from 'react-icons/fa';
import './Main.css';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

function Main({ session }) {
  const [stats, setStats] = useState({
    totalGrants: 0,
    pending: 0,
    needsChanges: 0,
    approved: 0,
    rejected: 0,
    totalFunding: 0,
    totalDisbursed: 0,
    totalSpent: 0,
    totalPendingSpent: 0,
  });
  const [recentGrants, setRecentGrants] = useState([]);
  const [showTaxBanner, setShowTaxBanner] = useState(false);
  const [taxMonthName, setTaxMonthName] = useState('');

  useEffect(() => {
    async function fetchStats() {
      if (!session?.userRecord) return;

      const userId = session.userRecord.id;

      // Fetch all grants for stats in one query
      const { data: allGrants } = await supabase
        .from("grant_record")
        .select("status, grant_amount, disbursed_funds, total_spent")
        .eq("user_id", userId);

      const totalGrants  = allGrants?.length ?? 0;
      const pending      = allGrants?.filter(g => g.status === 'pending').length ?? 0;
      const needsChanges = allGrants?.filter(g => g.status === 'needs_changes').length ?? 0;
      const approved     = allGrants?.filter(g => g.status === 'approved').length ?? 0;
      const rejected     = allGrants?.filter(g => g.status === 'rejected').length ?? 0;
      const totalFunding    = allGrants?.reduce((sum, g) => sum + Number(g.grant_amount || 0), 0) ?? 0;
      const totalDisbursed  = allGrants?.reduce((sum, g) => sum + Number(g.disbursed_funds || 0), 0) ?? 0;
      // total_spent on grant_record is trigger-maintained and counts only approved expenses
      const totalSpent      = allGrants?.reduce((sum, g) => sum + Number(g.total_spent || 0), 0) ?? 0;

      // Pending/rejected expense total — query expenses directly
      const grantIds = allGrants?.map(g => g.id) || [];
      let totalPendingSpent = 0;
      if (grantIds.length > 0) {
        const { data: pendingExpenses } = await supabase
          .from('expenses')
          .select('amount_spent')
          .in('grant_id', grantIds)
          .neq('status', 'approved');
        totalPendingSpent = (pendingExpenses || []).reduce((sum, e) => sum + Number(e.amount_spent || 0), 0);
      }

      setStats({ totalGrants, pending, needsChanges, approved, rejected, totalFunding, totalDisbursed, totalSpent, totalPendingSpent });

      // Fetch recent grants
      const { data: grantsData } = await supabase
        .from("grant_record")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5);

      setRecentGrants(grantsData || []);
    }

    fetchStats();

    // Check if tax month is approaching (within 30 days)
    const taxMonth = session?.userRecord?.tax_month;
    if (taxMonth) {
      const now = new Date();
      const year = now.getFullYear();
      // First day of the tax month (this year or next year)
      let taxDate = new Date(year, taxMonth - 1, 1);
      if (taxDate < now) taxDate = new Date(year + 1, taxMonth - 1, 1);
      const daysUntil = Math.ceil((taxDate - now) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 30) {
        const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        setTaxMonthName(monthNames[taxMonth - 1]);
        setShowTaxBanner(true);
      }
    }
  }, [session]);

  return (
    <main>
      <div className="dashboard-content">
      <section className="starter">
        <h2>Welcome Back, {session.userRecord.firstname}</h2>
        {showTaxBanner && (
          <div className="tax-month-alert">
            <FaCalendarAlt className="tax-alert-icon" />
            <span>
              Your tax filing period (<strong>{taxMonthName}</strong>) is approaching - reach out to us and we'll connect you with a trusted accountant to prepare your tax or audit.
            </span>
            <button className="tax-alert-close" onClick={() => setShowTaxBanner(false)} aria-label="Dismiss">
              <FaTimes />
            </button>
          </div>
        )}
        <div className="stats">
          <StatCard
            title="Total Grants"
            value={stats.totalGrants}
            icon={<FaFileAlt />}
            accentColor="var(--accent-total-grants)"
            linkTo="/grants"
          />
          <StatCard
            title="Approved"
            value={stats.approved}
            icon={<FaCheckCircle />}
            accentColor="var(--accent-approved)"
            linkTo="/grants?status=approved"
          />
          {session?.tenantConfig?.type !== 'self_service' && (
            <>
              <StatCard
                title="Pending"
                value={stats.pending}
                icon={<FaClock />}
                accentColor="var(--accent-under-review)"
                linkTo="/grants?status=pending"
                dimWhenZero
              />
              <StatCard
                title="Needs Changes"
                value={stats.needsChanges}
                icon={<FaExclamationTriangle />}
                accentColor="var(--accent-needs-changes)"
                linkTo="/grants?status=needs_changes"
                dimWhenZero
              />
            </>
          )}
          {session?.tenantConfig?.type !== 'self_service' && (
            <StatCard
              title="Rejected"
              value={stats.rejected}
              icon={<FaTimesCircle />}
              accentColor="#EF4444"
              linkTo="/grants?status=rejected"
              dimWhenZero
            />
          )}
          <StatCard
            title="Total Funding"
            value={stats.totalFunding}
            icon={<FaDollarSign />}
            accentColor="var(--accent-funding)"
          />
          <StatCard
            title="Spent"
            value={stats.totalSpent}
            icon={<FaDollarSign />}
            accentColor="var(--accent-spent)"
          />
        </div>
      </section>

      {/* Charts */}
      {stats.totalGrants > 0 && (() => {
        const fmtK = v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;
        const statusData = [
          { name: 'Approved',      value: stats.approved,      fill: '#10B981' },
          { name: 'Pending',       value: stats.pending,        fill: '#F59E0B' },
          { name: 'Needs Changes', value: stats.needsChanges,   fill: '#D97706' },
          { name: 'Rejected',      value: stats.rejected,       fill: '#EF4444' },
        ].filter(d => d.value > 0);
        const fundingData = [
          { name: 'Total Funding',    value: stats.totalFunding,        fill: '#065F46' },
          { name: 'Disbursed',        value: stats.totalDisbursed,      fill: '#059669' },
          { name: 'Spent (Approved)', value: stats.totalSpent,          fill: '#6B7280' },
          ...(stats.totalPendingSpent > 0
            ? [{ name: 'Spent (Pending)', value: stats.totalPendingSpent, fill: '#F59E0B' }]
            : []),
        ];
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
              <p className="chart-card-title">Funding vs Spent</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={fundingData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={fmtK} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={v => [`$${v.toLocaleString()}`, 'Amount']} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {fundingData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      <section className="action">
        <ActionCard
          title="Submit New Grant"
          buttonText="Create Application"
          icon={<FaPlusCircle />}
          description="Start a new grant application"
          linkTo="/grants/new"
        />
        <ActionCard
          title="View All Grants"
          buttonText="View Grants"
          icon={<FaList />}
          description="Browse your grant applications"
          linkTo="/grants"
        />
        <ActionCard
          title="View Expenses"
          buttonText="View Expenses"
          icon={<FaChartBar />}
          description="Track spending across your grants"
          linkTo="/expenses"
        />
      </section>

      {/* Recent Grants Section */}
      <section className="recent-grants-section">
        <div className="section-header">
          <h3>Recent Grants</h3>
          <Link to="/grants" className="view-all-link">
            View All <FaArrowRight />
          </Link>
        </div>

        {recentGrants.length > 0 ? (
          <div className="recent-grants-list">
            {recentGrants.map((grant) => (
              <div key={grant.id} className="recent-grant-item">
                <div className="grant-item-icon">
                  <FaFileAlt />
                </div>
                <div className="grant-item-content">
                  <div className="grant-item-header">
                    <h4>{grant.grant_name || `Grant #${grant.id}`}</h4>
                    <span className={`status-badge status-${grant.status}`}>
                      {grant.status === 'needs_changes' ? 'Needs Changes' : grant.status}
                    </span>
                  </div>
                  <div className="grant-item-details">
                    <span className="grant-amount">
                      <FaDollarSign /> ${grant.grant_amount?.toLocaleString() || 0}
                    </span>
                    <span className="grant-date">
                      <FaCalendarAlt />{" "}
                      {grant.start_spend_period
                        ? new Date(grant.start_spend_period).toLocaleDateString()
                        : 'N/A'}
                    </span>
                  </div>
                </div>
                <Link to={`/grants/${grant.id}`} className="grant-item-arrow">
                  <FaArrowRight />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-grants-message">
            <p>No grants yet. Start by creating your first grant application!</p>
            <Link to="/grants/new">
              <button className="cta-button">
                <FaPlusCircle /> Create Grant Application
              </button>
            </Link>
          </div>
        )}
      </section>
      </div>
    </main>
  );
}

function StatCard({ title, value, icon, accentColor, linkTo, dimWhenZero }) {
  const isMonetary = title === "Total Funding" || title === "Total Spent" || title === "Spent";
  const displayValue = isMonetary ? `$${(value ?? 0).toLocaleString()}` : value ?? 0;
  const dimmed = dimWhenZero && !value;

  const card = (
    <div className="card stat-card" style={{ '--accent-color': accentColor, opacity: dimmed ? 0.38 : 1 }}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <h3>{title}</h3>
        <p className="stat-value">{displayValue}</p>
      </div>
    </div>
  );

  if (linkTo && !dimmed) {
    return <Link to={linkTo} className="stat-card-link">{card}</Link>;
  }
  return card;
}

function ActionCard({ title, buttonText, icon, description, linkTo }) {
  return (
    <div className="action-card">
      <div className="action-icon">{icon}</div>
      <h3>{title}</h3>
      {description && <p className="action-description">{description}</p>}
      <Link to={linkTo}>
        <button>{buttonText}</button>
      </Link>
    </div>
  );
}

export default Main;