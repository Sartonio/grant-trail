import { FaExclamationTriangle, FaTimes, FaTrash } from 'react-icons/fa';
import '../../styles/Forms.css';

/**
 * Styled confirmation dialog — drop-in replacement for window.confirm().
 *
 * Props:
 *   title      {string}   — dialog heading
 *   message    {string}   — body text
 *   confirmLabel {string} — label for the destructive button (default "Delete")
 *   onConfirm  {fn}       — called when the user clicks the confirm button
 *   onCancel   {fn}       — called when the user clicks Cancel or the backdrop
 */
function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const handleBackdropClick = (e) => {
    if (e.target.classList.contains('modal-backdrop')) onCancel();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-container confirm-dialog">
        <div className="modal-header confirm-header">
          <div className="modal-header-content">
            <FaExclamationTriangle className="modal-icon confirm-icon" />
            <h2>{title}</h2>
          </div>
          <button className="modal-close-btn" onClick={onCancel} type="button" aria-label="Close">
            <FaTimes />
          </button>
        </div>

        <div className="modal-body confirm-body">
          <p>{message}</p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onCancel}>
            <FaTimes /> Cancel
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            <FaTrash /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
