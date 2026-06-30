import { FaClock, FaCheckCircle, FaTimesCircle, FaExclamationTriangle } from 'react-icons/fa';

const STATUS_ICONS = {
  pending:       FaClock,
  approved:      FaCheckCircle,
  rejected:      FaTimesCircle,
  needs_changes: FaExclamationTriangle,
};

function StatusBadge({ status, iconOnly = false }) {
  if (!status) return null;
  const label = status === 'needs_changes'
    ? 'Needs Changes'
    : status.charAt(0).toUpperCase() + status.slice(1);

  if (iconOnly) {
    const Icon = STATUS_ICONS[status.toLowerCase()] || FaClock;
    return (
      <span className={`status-icon status-icon-${status.toLowerCase()}`} title={label}>
        <Icon />
      </span>
    );
  }

  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      {label}
    </span>
  );
}

export default StatusBadge;
