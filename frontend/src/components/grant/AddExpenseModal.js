import { useState, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../../supabaseClient';
import {
  FaTimes,
  FaSave,
  FaFileInvoiceDollar,
  FaDollarSign,
  FaTag,
  FaCalendarAlt,
  FaReceipt,
  FaUpload,
  FaCheckCircle,
} from 'react-icons/fa';
import '../../styles/Forms.css';

const MAX_FILE_BYTES = 500 * 1024; // 500 KB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_EXTENSIONS = '.jpg,.jpeg,.png,.pdf';

function AddExpenseModal({ grantId, budgetItemId, budgetItem, expenseItem, existingReceipt, onClose, onSuccess, session, grantStartDate, grantEndDate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dateWarning, setDateWarning] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const fileInputRef = useRef(null);
  const isEditMode = !!expenseItem;
  const isManagedTenant = session?.tenantConfig?.type !== 'self_service';
  const willResetStatus = isEditMode && isManagedTenant && expenseItem?.status !== 'pending';

  const today = new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState({
    item_name: expenseItem?.item_name || '',
    amount_spent: expenseItem?.amount_spent || '',
    expense_date: expenseItem?.expense_date || today,
  });

  function checkDateWarning(date) {
    if (!date) { setDateWarning(''); return; }
    if (grantStartDate && date < grantStartDate) {
      setDateWarning('This date is before the grant spend period starts.');
    } else if (grantEndDate && date > grantEndDate) {
      setDateWarning('This date is after the grant spend period has ended.');
    } else {
      setDateWarning('');
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) setError('');
    if (name === 'expense_date') checkDateWarning(value);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Receipt must be a JPG, PNG, or PDF file.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('Receipt file must be 500 KB or smaller.');
      e.target.value = '';
      return;
    }
    setReceiptFile(file);
    if (error) setError('');
  };

  const clearFile = () => {
    setReceiptFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validateForm = () => {
    if (!formData.item_name.trim()) {
      setError('Item name is required');
      return false;
    }
    if (!formData.amount_spent || parseFloat(formData.amount_spent) <= 0) {
      setError('Amount spent must be greater than 0');
      return false;
    }
    if (!formData.expense_date) {
      setError('Expense date is required');
      return false;
    }
    const requireReceipt = session?.tenantConfig?.require_expense_approval !== false;
    if (!isEditMode && !receiptFile && requireReceipt) {
      setError('A receipt is required. Please upload a JPG, PNG, or PDF.');
      return false;
    }

    if (budgetItem) {
      const spent = parseFloat(formData.amount_spent);
      const alreadySpent = isEditMode
        ? budgetItem.amount_spent - (expenseItem.amount_spent || 0)
        : budgetItem.amount_spent;
      const available = budgetItem.budget_allocated - alreadySpent;
      if (spent > available) {
        setError(`Amount ($${spent.toLocaleString()}) exceeds available budget ($${available.toLocaleString()}) for this category.`);
        return false;
      }
    }

    return true;
  };

  async function uploadReceipt(expenseId, isUpdate) {
    const fileExt = receiptFile.name.split('.').pop().toLowerCase();
    const tenantId = session?.userRecord?.tenant_id;
    const storagePath = `receipts/${tenantId}/${grantId}/${expenseId}/${Date.now()}.${fileExt}`;

    const { error: uploadErr } = await supabase.storage
      .from('receipts')
      .upload(storagePath, receiptFile, { upsert: true });
    if (uploadErr) throw new Error(`Receipt upload failed: ${uploadErr.message}`);

    const receiptPayload = {
      user_id: session?.userRecord?.id,
      grant_id: grantId,
      expense_id: expenseId,
      receipt_files: [{
        name: receiptFile.name,
        path: storagePath,
        type: receiptFile.type,
        size: receiptFile.size,
      }],
    };

    if (isUpdate) {
      // Replace existing receipt record for this expense
      await supabase.from('receipts').delete().eq('expense_id', expenseId);
    }
    const { error: insertErr } = await supabase.from('receipts').insert(receiptPayload);
    if (insertErr) throw insertErr;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      const itemData = {
        grant_id: grantId,
        budget_item_id: budgetItemId || null,
        item_name: formData.item_name.trim(),
        amount_spent: parseFloat(formData.amount_spent),
        expense_date: formData.expense_date,
      };

      if (isEditMode) {
        // Managed tenants: reset status to pending for admin re-review
        if (isManagedTenant) itemData.status = 'pending';
        const { error: updateErr } = await supabase
          .from('expenses')
          .update(itemData)
          .eq('id', expenseItem.id);
        if (updateErr) throw updateErr;

        if (receiptFile) {
          await uploadReceipt(expenseItem.id, true);
        }
      } else {
        const { data: newExpense, error: insertErr } = await supabase
          .from('expenses')
          .insert([{ ...itemData, status: 'pending' }])
          .select()
          .single();
        if (insertErr) throw insertErr;

        if (receiptFile) {
          try {
            await uploadReceipt(newExpense.id, false);
          } catch (uploadErr) {
            // Compensate: remove the expense we just created so data stays consistent
            await supabase.from('expenses').delete().eq('id', newExpense.id);
            throw uploadErr;
          }
        }
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error(`Error ${isEditMode ? 'updating' : 'adding'} expense:`, err);
      Sentry.captureException(err);
      setError(err.message || `Failed to ${isEditMode ? 'update' : 'add'} expense`);
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target.classList.contains('modal-backdrop')) onClose();
  };

  const alreadySpent = isEditMode
    ? (budgetItem?.amount_spent || 0) - (expenseItem?.amount_spent || 0)
    : (budgetItem?.amount_spent || 0);
  const available = budgetItem ? budgetItem.budget_allocated - alreadySpent : null;

  const fmtBytes = bytes => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const truncName = name => {
    const dot = name.lastIndexOf('.');
    const base = dot !== -1 ? name.slice(0, dot) : name;
    const ext  = dot !== -1 ? name.slice(dot) : '';
    return base.length > 20 ? base.slice(0, 20) + '…' + ext : name;
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-container expense-modal">
        <div className="modal-header">
          <div className="modal-header-content">
            <FaFileInvoiceDollar className="modal-icon" />
            <h2>{isEditMode ? 'Edit Expense Item' : 'Add Expense Item'}</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} type="button" aria-label="Close modal">
            <FaTimes />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-body">
            <div className="expense-split">

              {/* Left column: fields */}
              <div className="expense-fields-col">
                <div className="form-group">
                  <label htmlFor="item_name">
                    <FaTag /> Item Name
                  </label>
                  <input
                    type="text"
                    id="item_name"
                    name="item_name"
                    value={formData.item_name}
                    onChange={handleChange}
                    placeholder="e.g., Office Supplies"
                    maxLength={50}
                    required
                  />
                  <span className="field-hint">Brief description</span>
                </div>

                <div className="form-group">
                  <label htmlFor="expense_date">
                    <FaCalendarAlt /> Date
                  </label>
                  <input
                    type="date"
                    id="expense_date"
                    name="expense_date"
                    value={formData.expense_date}
                    onChange={handleChange}
                    required
                  />
                  <span className="field-hint">Date expense occurred</span>
                  {dateWarning && (
                    <span className="field-warning" style={{ color: '#D97706', fontSize: '0.8rem', display: 'block', marginTop: '0.25em' }}>
                      {dateWarning}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="amount_spent">
                    <FaDollarSign /> Amount Spent
                  </label>
                  <div className="input-with-prefix">
                    <span className="input-prefix">$</span>
                    <input
                      type="number"
                      id="amount_spent"
                      name="amount_spent"
                      value={formData.amount_spent}
                      onChange={handleChange}
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <span className="field-hint">Actual amount spent</span>
                </div>
              </div>

              {/* Right column: receipt */}
              <div className="expense-receipt-col">
            <div className="form-group receipt-form-group">
              <label>
                <FaReceipt />
                Receipt
                {!isEditMode && session?.tenantConfig?.require_expense_approval !== false && <span className="receipt-required-mark"> *</span>}
              </label>

              {receiptFile ? (
                <div className="receipt-preview">
                  <FaCheckCircle className="receipt-check-icon" />
                  <div className="receipt-file-info">
                    <span className="receipt-filename" title={receiptFile.name}>{truncName(receiptFile.name)}</span>
                    <span className="receipt-filesize">{fmtBytes(receiptFile.size)}</span>
                  </div>
                  <button
                    type="button"
                    className="receipt-clear-btn"
                    onClick={clearFile}
                    aria-label="Remove file"
                  >
                    <FaTimes />
                  </button>
                </div>
              ) : isEditMode && existingReceipt ? (
                <div className="receipt-preview existing-receipt">
                  <FaReceipt className="receipt-check-icon existing" />
                  <div className="receipt-file-info">
                    <span className="receipt-filename" title={existingReceipt.name}>{truncName(existingReceipt.name)}</span>
                    <span className="receipt-filesize">{fmtBytes(existingReceipt.size)} · Current receipt</span>
                  </div>
                  <button
                    type="button"
                    className="receipt-replace-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <div
                  className="receipt-upload-area"
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
                >
                  <FaUpload className="receipt-upload-icon" />
                  <span className="receipt-upload-text">Click to upload receipt</span>
                  <span className="receipt-upload-hint">JPG, PNG, or PDF · Max 500 KB</span>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                id="receipt"
                accept={ALLOWED_EXTENSIONS}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              <span className="field-hint">
                {receiptFile
                  ? 'New file will replace the current receipt on save'
                  : isEditMode && existingReceipt
                  ? 'Receipt on file - click Replace to swap it out'
                  : isEditMode
                  ? 'Upload to add a receipt'
                  : session?.tenantConfig?.require_expense_approval !== false
                  ? 'Required for all expenses'
                  : 'Optional - upload for your records'}
              </span>
            </div>
              </div>{/* end expense-receipt-col */}
            </div>{/* end expense-split */}

            {/* Budget Item Info */}
            {budgetItem && (
              <div className="budget-info-box">
                <div className="budget-row">
                  <span className="budget-label">Budget Category:</span>
                  <span className="budget-value">{budgetItem.item_name}</span>
                </div>
                <div className="budget-row">
                  <span className="budget-label">Category Allocation:</span>
                  <span className="budget-value">${budgetItem.budget_allocated?.toLocaleString() || 0}</span>
                </div>
                <div className="budget-row">
                  <span className="budget-label">Already Spent:</span>
                  <span className="budget-value">${alreadySpent.toLocaleString()}</span>
                </div>
                <div className="budget-row available">
                  <span className="budget-label">Available:</span>
                  <span className="budget-value highlight">${available?.toLocaleString() || 0}</span>
                </div>
              </div>
            )}

            <div className="info-note">
              <strong>Note:</strong> Budget item totals and grant totals update automatically when this expense is saved.
            </div>

            {willResetStatus && (
              <div className="info-note">
                Saving changes will reset this expense to <strong>pending</strong> for admin review.
              </div>
            )}

            {error && (
              <div className="form-error">
                <FaTimes /> {error}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-cancel" disabled={loading}>
              <FaTimes /> Cancel
            </button>
            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? (
                <>
                  <div className="button-spinner"></div>
                  {isEditMode ? 'Updating...' : 'Saving...'}
                </>
              ) : (
                <>
                  <FaSave /> {isEditMode ? 'Update Expense' : 'Add Expense'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddExpenseModal;
