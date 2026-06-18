import React, { useState } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../supabaseClient';
import {
  FaTimes,
  FaSave,
  FaLayerGroup,
  FaDollarSign,
  FaTag
} from 'react-icons/fa';
import '../styles/Forms.css';

function BudgetItemModal({ grantId, budgetItem, grantAmount, totalAllocated, onClose, onSuccess, session }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isEditMode = !!budgetItem;
  const isManagedTenant = session?.tenantConfig?.type !== 'self_service';
  const willResetStatus = isEditMode && isManagedTenant && budgetItem?.status !== 'pending';

  const [formData, setFormData] = useState({
    item_name: budgetItem?.item_name || '',
    description: budgetItem?.description || '',
    budget_allocated: budgetItem?.budget_allocated || '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const validateForm = () => {
    if (!formData.item_name.trim()) {
      setError('Budget item name is required');
      return false;
    }
    const newAmount = parseFloat(formData.budget_allocated);
    if (!formData.budget_allocated || newAmount <= 0) {
      setError('Allocated budget must be greater than 0');
      return false;
    }
    // Prevent allocation below total approved expenses for this budget item
    if (isEditMode && budgetItem.amount_spent > 0 && newAmount < budgetItem.amount_spent) {
      setError(
        `Allocated budget cannot be less than the total expenses already recorded ` +
        `($${budgetItem.amount_spent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
      );
      return false;
    }
    if (grantAmount != null && totalAllocated != null) {
      // In edit mode, exclude this item's current allocation from the running total
      const currentItemAmount = isEditMode ? (budgetItem.budget_allocated || 0) : 0;
      const otherAllocated = totalAllocated - currentItemAmount;
      const available = grantAmount - otherAllocated;
      if (newAmount > available) {
        setError(
          `Allocated amount exceeds available grant funds. ` +
          `Available: $${available.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        );
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      const newAmount = parseFloat(formData.budget_allocated);
      const payload = {
        grant_id: grantId,
        item_name: formData.item_name.trim(),
        description: formData.description.trim() || null,
        budget_allocated: newAmount,
      };

      // New items start as pending (auto-approve trigger overrides for self-service).
      // Edits in managed tenants reset to pending for admin re-review.
      if (!isEditMode) {
        payload.status = 'pending';
      } else if (isManagedTenant) {
        payload.status = 'pending';
      }

      let result;
      if (isEditMode) {
        result = await supabase
          .from('budget_items')
          .update(payload)
          .eq('id', budgetItem.id)
          .select();
      } else {
        result = await supabase
          .from('budget_items')
          .insert([payload])
          .select();
      }

      if (result.error) throw result.error;

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error('Error saving budget item:', err);
      Sentry.captureException(err);
      setError(err.message || 'Failed to save budget item');
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target.classList.contains('modal-backdrop')) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-container expense-modal">
        <div className="modal-header">
          <div className="modal-header-content">
            <FaLayerGroup className="modal-icon" />
            <h2>{isEditMode ? 'Edit Budget Item' : 'Add Budget Item'}</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} type="button" aria-label="Close modal">
            <FaTimes />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="bi_item_name">
                  <FaTag /> Item Name
                </label>
                <input
                  type="text"
                  id="bi_item_name"
                  name="item_name"
                  value={formData.item_name}
                  onChange={handleChange}
                  placeholder="e.g., Staff Salaries"
                  maxLength={200}
                  required
                />
                <span className="field-hint">Name for this budget line</span>
              </div>

              <div className="form-group">
                <label htmlFor="bi_budget_allocated">
                  <FaDollarSign /> Allocated Budget
                </label>
                <div className="input-with-prefix">
                  <span className="input-prefix">$</span>
                  <input
                    type="number"
                    id="bi_budget_allocated"
                    name="budget_allocated"
                    value={formData.budget_allocated}
                    onChange={handleChange}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    required
                  />
                </div>
                <span className="field-hint">
                  {isEditMode && budgetItem.amount_spent > 0
                    ? `Minimum $${budgetItem.amount_spent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (total expenses recorded)`
                    : 'Budget for this line item'}
                </span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="bi_description">Description</label>
              <textarea
                id="bi_description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Optional description of this budget line..."
                rows={1}
              />
            </div>

            {willResetStatus && (
              <div className="info-note">
                Saving changes will reset this item to <strong>pending</strong> for admin review.
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
                  {isEditMode ? 'Updating...' : 'Adding...'}
                </>
              ) : (
                <>
                  <FaSave /> {isEditMode ? 'Update Budget Item' : 'Add Budget Item'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BudgetItemModal;
