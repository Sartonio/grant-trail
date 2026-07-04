import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CHART_COLORS = ['#8c564b','#d62728','#ff7f0e', '#bcbd22','#065F46','#2ca02c','#1f77b4', '#9467bd'];
const fmtK = v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

/**
 * Monthly-spending bar chart + spending-by-grant pie chart for the expense
 * reports landing. Presentational only — derives its series from the caller's
 * expense/grant lists.
 *
 * @param {Object} props
 * @param {Array<Object>} props.items
 * @param {Array<Object>} props.grants
 */
export default function ExpenseCharts({ items, grants }) {
  // Monthly spending
  const monthlyMap = {};
  items.forEach(item => {
    if (!item.expense_date) return;
    const [y, m] = item.expense_date.split('-');
    const key = `${y}-${m}`;
    monthlyMap[key] = (monthlyMap[key] || 0) + (item.amount_spent || 0);
  });
  const monthlyData = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, total]) => {
      const [y, mo] = key.split('-');
      return { month: `${MONTHS_SHORT[parseInt(mo, 10) - 1]} ${y}`, total };
    });

  // Spending by grant — O(n) pre-aggregation, capped at top 8 + "Other"
  const spendingByGrantId = items.reduce((acc, it) => {
    acc[it.grant_id] = (acc[it.grant_id] || 0) + (it.amount_spent || 0);
    return acc;
  }, {});

  const TOP_N = 8;
  const grantSpending = grants
    .map(g => ({ name: g.grant_name || `Grant #${g.id}`, value: spendingByGrantId[g.id] || 0 }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const byGrantData = grantSpending.length <= TOP_N
    ? grantSpending.map((d, i) => ({ ...d, fill: CHART_COLORS[i % CHART_COLORS.length] }))
    : [
        ...grantSpending.slice(0, TOP_N).map((d, i) => ({ ...d, fill: CHART_COLORS[i % CHART_COLORS.length] })),
        {
          name: `Other (${grantSpending.length - TOP_N})`,
          value: grantSpending.slice(TOP_N).reduce((s, d) => s + d.value, 0),
          fill: '#D1D5DB',
        },
      ];

  return (
    <div className="charts-row">
      <div className="chart-card">
        <p className="chart-card-title">Monthly Spending</p>
        {monthlyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} tickMargin={10} />
              <YAxis tickFormatter={fmtK} tick={{ fontSize: 12 }} />
              <Tooltip formatter={v => [`$${v.toLocaleString()}`, 'Spent']} />
              <Bar dataKey="total" fill="#063F1E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="chart-empty">No dated expenses yet.</p>
        )}
      </div>
      <div className="chart-card">
        <p className="chart-card-title">Spending by Grant</p>
        {byGrantData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={byGrantData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90}>
                {byGrantData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip formatter={(v, name) => [`$${v.toLocaleString()}`, name]} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="chart-empty">No expense data yet.</p>
        )}
      </div>
    </div>
  );
}
