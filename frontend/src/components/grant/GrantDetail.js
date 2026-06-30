import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import StatusBadge from '../common/StatusBadge';
import GrantAttachments from './GrantAttachments';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import {
  FaArrowLeft,
  FaChartBar,
  FaFileAlt,
  FaCalendarAlt,
  FaDollarSign,
  FaClock,
  FaCheckCircle,
  FaCommentAlt,
  FaHistory,
  FaPaperclip,
  FaEdit,
} from 'react-icons/fa';
import './GrantDetail.css';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(day, 10)}-${months[parseInt(month, 10) - 1]}-${year}`;
}

function GrantDetail({ session }) {
  const { id } = useParams();
  const [grant, setGrant] = useState(null);
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      const { data: grantData, error: grantError } = await supabase
        .from('grant_record')
        .select('*')
        .eq('id', id)
        .single();

      if (grantError || !grantData) {
        setError('Grant not found.');
        setLoading(false);
        return;
      }
      setGrant(grantData);

      const { data: historyData } = await supabase
        .from('grant_status_history')
        .select('*')
        .eq('grant_id', id)
        .order('created_at', { ascending: true });
      setHistory(historyData || []);

      const { data: commentsData } = await supabase
        .from('grant_comments')
        .select('*')
        .eq('grant_id', id)
        .order('created_at', { ascending: true });
      setComments(commentsData || []);

      setLoading(false);
    }

    fetchData();
  }, [id]);

  if (loading) return <div className="detail-loading">Loading grant details...</div>;
  if (error) return <div className="detail-error">{error}</div>;
  if (!grant) return null;

  return (
    <div className="grant-detail-page">

      {/* Nav bar */}
      <div className="detail-nav">
        <Link to="/grants" className="detail-back-link">
          <FaArrowLeft /> Back to Grants
        </Link>
        <div className="detail-nav-right">
          {(grant.status === 'needs_changes' || session?.tenantConfig?.type === 'self_service') && (
            <Link to={`/grants/${grant.id}/edit`} className="detail-edit-link">
              <FaEdit /> Edit Application
            </Link>
          )}
          <Link to={`/grants/${grant.id}/breakdown`} className="detail-expenses-link">
            <FaChartBar /> View Breakdown
          </Link>
        </div>
      </div>

      {/* Expired grant warning */}
      {grant.end_spend_period && new Date(grant.end_spend_period + 'T23:59:59') < new Date() && (
        <div className="expired-grant-banner">
          <FaClock /> This grant's spend period has ended. You can still add receipts and update records.
        </div>
      )}

      {/* Header banner */}
      <div className="detail-header-banner">
        <div className="detail-banner-title">
          <h2>{grant.grant_name || `Grant #${grant.id}`}</h2>
          <StatusBadge status={grant.status} />
        </div>
        <div className="detail-banner-meta">
          <span><FaDollarSign /> ${grant.grant_amount?.toLocaleString() || '0'}</span>
          {(grant.start_spend_period || grant.end_spend_period) && (
            <span>
              <FaCalendarAlt />
              {formatDate(grant.start_spend_period)} – {formatDate(grant.end_spend_period)}
            </span>
          )}
          {grant.submitted_at && (
            <span><FaClock /> Submitted {formatDate(grant.submitted_at)}</span>
          )}
        </div>
      </div>

      {/* Grant Information */}
      <div className="detail-section">
        <h3 className="detail-section-title"><FaFileAlt /> Grant Information</h3>
        <div className="detail-info-grid">

          {grant.description && (
            <div className="detail-info-item full-width">
              <span className="detail-info-label">Description</span>
              <span className="detail-info-value">{grant.description}</span>
            </div>
          )}

          <div className="detail-info-item">
            <span className="detail-info-label"><FaDollarSign /> Grant Amount</span>
            <span className="detail-info-value">${grant.grant_amount?.toLocaleString()}</span>
          </div>
          <div className="detail-info-item">
            <span className="detail-info-label"><FaDollarSign /> Spent</span>
            <span className="detail-info-value spent">${(grant.total_spent || 0).toLocaleString()}</span>
          </div>
          <div className="detail-info-item">
            <span className="detail-info-label"><FaDollarSign /> Remaining Balance</span>
            <span className="detail-info-value remaining">${(grant.remaining_balance || 0).toLocaleString()}</span>
          </div>

          <div className="detail-info-item">
            <span className="detail-info-label"><FaCalendarAlt /> Start Spend Period</span>
            <span className="detail-info-value">{formatDate(grant.start_spend_period)}</span>
          </div>
          <div className="detail-info-item">
            <span className="detail-info-label"><FaCalendarAlt /> End Spend Period</span>
            <span className="detail-info-value">{formatDate(grant.end_spend_period)}</span>
          </div>

          {grant.release_date && (
            <div className="detail-info-item">
              <span className="detail-info-label"><FaCalendarAlt /> Expected Release</span>
              <span className="detail-info-value">{formatDate(grant.release_date)}</span>
            </div>
          )}

          {grant.submitted_at && (
            <div className="detail-info-item">
              <span className="detail-info-label"><FaClock /> Submitted</span>
              <span className="detail-info-value">{formatDate(grant.submitted_at)}</span>
            </div>
          )}
          {grant.reviewed_at && (
            <div className="detail-info-item">
              <span className="detail-info-label"><FaCheckCircle /> Reviewed</span>
              <span className="detail-info-value">{formatDate(grant.reviewed_at)}</span>
            </div>
          )}

          {grant.approval_notes && (
            <div className="detail-info-item full-width">
              <span className="detail-info-label">Approval Notes</span>
              <span className="detail-info-value notes">{grant.approval_notes}</span>
            </div>
          )}

        </div>
      </div>

      {/* Status History + Budget donut side by side */}
      <div className="detail-info-row">
      <div className="detail-section">
        <h3 className="detail-section-title"><FaHistory /> Status History</h3>
        {history.length === 0 ? (
          <p className="detail-empty">No status changes recorded yet.</p>
        ) : (
          <div className="status-timeline">
            {history.map((entry, i) => (
              <div key={entry.id} className="timeline-entry">
                <div className="timeline-marker">
                  <div className="timeline-dot" />
                  {i < history.length - 1 && <div className="timeline-line" />}
                </div>
                <div className="timeline-content">
                  <div className="timeline-transition">
                    {entry.old_status && (
                      <>
                        <StatusBadge status={entry.old_status} />
                        <span className="timeline-arrow">→</span>
                      </>
                    )}
                    <StatusBadge status={entry.new_status} />
                  </div>
                  <span className="timeline-date">{formatDate(entry.created_at)}</span>
                  {entry.comment && (
                    <p className="timeline-comment">{entry.comment}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Budget donut chart */}
      {(() => {
        const spent = grant.total_spent || 0;
        const remaining = Math.max((grant.grant_amount || 0) - spent, 0);
        const pct = grant.grant_amount > 0
          ? Math.min(Math.round((spent / grant.grant_amount) * 100), 100)
          : 0;
        const donutData = [
          { name: 'Spent',     value: spent,     fill: '#065F46' },
          { name: 'Remaining', value: remaining,  fill: '#E5E7EB' },
        ];
        return (
          <div className="detail-section">
            <h3 className="detail-section-title"><FaChartBar /> Budget Used</h3>
            <div style={{ position: 'relative' }}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    cx="50%" cy="45%"
                    innerRadius={58} outerRadius={82}
                    startAngle={90} endAngle={-270}
                  >
                    {donutData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v, name) => [`$${v.toLocaleString()}`, name]} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{
                position: 'absolute', top: '45%', left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center', pointerEvents: 'none', lineHeight: 1.3,
              }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#065F46' }}>{pct}%</div>
                <div style={{ fontSize: '10px', color: '#6B7280' }}>spent</div>
              </div>
            </div>
          </div>
        );
      })()}
      </div>{/* end detail-info-row */}

      {/* Admin Comments — hidden for self-service tenants */}
      {session?.tenantConfig?.type !== 'self_service' && comments.length > 0 && (
        <div className="detail-section">
          <h3 className="detail-section-title"><FaCommentAlt /> Admin Comments</h3>
          <div className="comments-list">
            {comments.map(c => (
              <div key={c.id} className="comment-item">
                <span className="comment-date">{formatDate(c.created_at)}</span>
                <p className="comment-text">{c.comment}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grant Attachments */}
      <div className="detail-section">
        <h3 className="detail-section-title"><FaPaperclip /> Attachments</h3>
        <GrantAttachments
          grantId={parseInt(id)}
          session={session}
        />
      </div>

    </div>
  );
}

export default GrantDetail;
