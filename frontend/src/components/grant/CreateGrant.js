import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { getOwnGrant, insertGrant, updateOwnGrant } from '../../lib/data/grants';
import { listBudgetItems } from '../../lib/data/budgetItems';
import { blurOnWheel } from '../../lib/format';
import {
  FaCalendarAlt,
  FaDollarSign,
  FaFileAlt,
  FaSave,
  FaTimes,
  FaCheckCircle,
  FaPen,
  FaExclamationTriangle,
} from 'react-icons/fa';
import './CreateGrant.css';

function CreateGrant({ session }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditMode = !!id;
  const isSelfService = session?.tenantConfig?.type === 'self_service';

  const [loading, setLoading]           = useState(false);
  const [fetchLoading, setFetchLoading] = useState(isEditMode);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState(false);
  const [totalAllocated, setTotalAllocated] = useState(0);

  const [formData, setFormData] = useState({
    grant_name:         '',
    description:        '',
    start_spend_period: '',
    end_spend_period:   '',
    release_date:       '',
    grant_amount:       '',
    funding_source:     '',
    status:             'pending',
  });

  // In edit mode: fetch existing grant and pre-populate
  useEffect(() => {
    if (!isEditMode) return;

    async function fetchGrant() {
      setFetchLoading(true);

      const { data: grantData, error: grantError } = await getOwnGrant(Number(id), session.userRecord.id);

      if (grantError || !grantData) {
        setError('Grant not found or access denied.');
        setFetchLoading(false);
        return;
      }

      // Guard: only needs_changes grants are editable (managed), or any grant for self-service
      if (grantData.status !== 'needs_changes' && !isSelfService) {
        navigate(`/grants/${id}`, { replace: true });
        return;
      }

      setFormData({
        grant_name:         grantData.grant_name         || '',
        description:        grantData.description        || '',
        start_spend_period: grantData.start_spend_period || '',
        end_spend_period:   grantData.end_spend_period   || '',
        release_date:       grantData.release_date       || '',
        grant_amount:       grantData.grant_amount?.toString() || '',
        funding_source:     grantData.funding_source || '',
        status:             grantData.status === 'needs_changes' ? 'pending' : (grantData.status || 'pending'),
      });

      // Fetch total allocated to enforce grant_amount >= allocated
      const { data: biData } = await listBudgetItems(Number(id));

      const allocated = (biData || []).reduce((sum, bi) => sum + (bi.budget_allocated || 0), 0);
      setTotalAllocated(allocated);

      setFetchLoading(false);
    }

    fetchGrant();
  }, [id, isEditMode]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (error) setError('');
  };

  const validateForm = () => {
    if (!formData.grant_name.trim()) {
      setError('Grant name is required');
      return false;
    }
    if (!formData.start_spend_period) {
      setError('Start date is required');
      return false;
    }
    if (!formData.end_spend_period) {
      setError('End date is required');
      return false;
    }
    const newAmount = parseFloat(formData.grant_amount);
    if (!formData.grant_amount || newAmount <= 0) {
      setError('Grant amount must be greater than 0');
      return false;
    }
    const startDate = new Date(formData.start_spend_period);
    const endDate   = new Date(formData.end_spend_period);
    if (endDate <= startDate) {
      setError('End date must be after start date');
      return false;
    }
    if (isEditMode && totalAllocated > 0 && newAmount < totalAllocated) {
      setError(
        `Grant amount cannot be less than the total already allocated to budget items ` +
        `($${totalAllocated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
      );
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    setError('');

    try {
      if (isEditMode) {
        const updateData = {
            grant_name:         formData.grant_name.trim(),
            description:        formData.description.trim() || null,
            start_spend_period: formData.start_spend_period,
            end_spend_period:   formData.end_spend_period,
            release_date:       formData.release_date || null,
            grant_amount:       parseFloat(formData.grant_amount),
            funding_source:     formData.funding_source.trim() || null,
        };
        // Self-service: save the grantee's chosen status. Managed: reset to pending for re-review.
        updateData.status = isSelfService ? formData.status : 'pending';
        const { error: updateError } = await updateOwnGrant(Number(id), session.userRecord.id, updateData);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await insertGrant({
          user_id:            session.userRecord.id,
          grant_name:         formData.grant_name.trim(),
          description:        formData.description.trim() || null,
          start_spend_period: formData.start_spend_period,
          end_spend_period:   formData.end_spend_period,
          release_date:       formData.release_date || null,
          grant_amount:       parseFloat(formData.grant_amount),
          funding_source:     formData.funding_source.trim() || null,
          status:             'pending',
          submitted_at:       new Date().toISOString(),
        });

        if (insertError) throw insertError;
      }

      setSuccess(true);
      setTimeout(() => {
        navigate(isEditMode ? `/grants/${id}` : '/grants');
      }, 1500);
    } catch (err) {
      console.error('Error saving grant:', err);
      Sentry.captureException(err);
      setError(err.message || 'Failed to save grant');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    navigate(isEditMode ? `/grants/${id}` : '/');
  };

  if (fetchLoading) {
    return <div className="create-grant-page"><p style={{ padding: '2em' }}>Loading grant...</p></div>;
  }

  if (success) {
    return (
      <div className="create-grant-success">
        <div className="success-icon"><FaCheckCircle /></div>
        <h2>{isEditMode ? 'Grant Updated!' : 'Grant Submitted!'}</h2>
        <p>
          {isEditMode
            ? isSelfService
              ? 'Your changes have been saved.'
              : 'Your changes have been saved and the grant resubmitted for review.'
            : isSelfService
              ? 'Your application has been submitted as Pending. Record the funder\'s decision here once it arrives.'
              : session?.tenantConfig?.require_grant_approval === false
                ? 'Your grant has been created and approved.'
                : 'Your grant has been successfully submitted and is pending review.'}
        </p>
        <p className="redirect-message">
          {isEditMode ? 'Redirecting to grant details...' : 'Redirecting to your grants...'}
        </p>
      </div>
    );
  }

  return (
    <div className="create-grant-page">
      <div className="create-grant-container">
        <div className="form-header">
          <FaFileAlt className="header-icon" />
          <div>
            <h2>{isEditMode ? 'Edit Grant' : 'Create New Grant'}</h2>
            <p className="form-subtitle">
              {isEditMode
                ? 'Update your grant and resubmit for review'
                : 'Submit a new grant for review'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grant-form">
          {/* Grant Name */}
          <div className="form-group">
            <label htmlFor="grant_name">
              <FaPen /> Grant Name <span className="required">*</span>
            </label>
            <input
              type="text"
              id="grant_name"
              name="grant_name"
              value={formData.grant_name}
              onChange={handleChange}
              placeholder="e.g., Community Youth Development Program"
              maxLength={200}
              required
            />
            <span className="field-hint">A short, descriptive name for this grant</span>
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="description">
              <FaFileAlt /> Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Briefly describe the purpose and goals of this grant..."
              rows={1}
            />
            <span className="field-hint">Optional — additional context for reviewers</span>
          </div>

          {/* Start and End Dates */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="start_spend_period">
                <FaCalendarAlt /> Start Spend Period <span className="required">*</span>
              </label>
              <input
                type="date"
                id="start_spend_period"
                name="start_spend_period"
                value={formData.start_spend_period}
                onChange={handleChange}
                required
              />
              <span className="field-hint">Begin date of eligible spending</span>
            </div>

            <div className="form-group">
              <label htmlFor="end_spend_period">
                <FaCalendarAlt /> End Spend Period <span className="required">*</span>
              </label>
              <input
                type="date"
                id="end_spend_period"
                name="end_spend_period"
                value={formData.end_spend_period}
                onChange={handleChange}
                required
              />
              <span className="field-hint">Last date of eligible spending</span>
            </div>
          </div>

          {/* Release Date and Grant Amount */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="release_date">
                <FaCalendarAlt /> Expected Release Date
              </label>
              <input
                type="date"
                id="release_date"
                name="release_date"
                value={formData.release_date}
                onChange={handleChange}
              />
              <span className="field-hint">Optional — when funds are expected</span>
            </div>

            <div className="form-group">
              <label htmlFor="grant_amount">
                <FaDollarSign /> Requested Grant Amount <span className="required">*</span>
              </label>
              <div className="input-with-prefix">
                <span className="input-prefix">$</span>
                <input
                  type="number"
                  id="grant_amount"
                  name="grant_amount"
                  value={formData.grant_amount}
                  onChange={handleChange}
                  onWheel={blurOnWheel}
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  required
                />
              </div>
              {isEditMode && totalAllocated > 0 && (
                <span className="field-hint">
                  Minimum ${totalAllocated.toLocaleString()} (total already allocated to budget items)
                </span>
              )}
              {!isEditMode && (
                <span className="field-hint">Total amount of funding requested</span>
              )}
            </div>
          </div>

          {/* Funding Source / Grant Program (all tenants) */}
          <div className="form-group">
            <label htmlFor="funding_source">
              <FaFileAlt /> Funding Source / Grant Program
            </label>
            <input
              type="text"
              id="funding_source"
              name="funding_source"
              value={formData.funding_source}
              onChange={handleChange}
              placeholder="e.g., Ford Foundation — Community Impact Fund"
              maxLength={200}
            />
            <span className="field-hint">Who is this grant from? e.g. a foundation, agency, or program name.</span>
          </div>

          {/* Application status — self-service records the funder's decision (edit mode only) */}
          {isEditMode && isSelfService && (
            <div className="form-group">
              <label htmlFor="status">
                <FaCheckCircle /> Application Status
              </label>
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="declined">Declined</option>
              </select>
              <span className="field-hint">Record the funder's decision once you receive it.</span>
            </div>
          )}

          {/* Info box */}
          {isEditMode ? (
            isSelfService ? (
            <div className="info-box">
              <FaFileAlt />
              <div>
                <strong>Editing grant</strong>
                <p>Your changes will be saved immediately with the status you selected above.</p>
              </div>
            </div>
            ) : (
            <div className="info-box info-box-warning">
              <FaExclamationTriangle />
              <div>
                <strong>Resubmitting for review</strong>
                <p>Saving will reset the grant status back to "Pending" and queue it for admin re-review.</p>
              </div>
            </div>
            )
          ) : (
            <div className="info-box">
              <FaFileAlt />
              <div>
                <strong>What happens next?</strong>
                <p>{isSelfService
                  ? 'Your application will be submitted as Pending. Once the funder makes a decision, your organization records it here. You can add budget items and expenses in the meantime.'
                  : session?.tenantConfig?.require_grant_approval === false
                    ? 'Your grant will be automatically approved. You can then add budget items and expenses.'
                    : 'Your grant will be submitted with a "Pending" status. An administrator will review it. You can add budget items and expenses while it is being reviewed.'}</p>
              </div>
            </div>
          )}

          {/* Documents tip */}
          <p className="form-tip">
            💡 Supporting documents (proposals, budgets, reports) can be uploaded from the grant detail page after saving.
          </p>

          {/* Error Message */}
          {error && (
            <div className="form-error">
              <FaTimes /> {error}
            </div>
          )}

          {/* Form Actions */}
          <div className="form-actions">
            <button
              type="button"
              onClick={handleCancel}
              className="btn-cancel"
              disabled={loading}
            >
              <FaTimes /> Cancel
            </button>
            <button
              type="submit"
              className="btn-submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <div className="button-spinner"></div>
                  {isEditMode ? 'Saving...' : 'Submitting...'}
                </>
              ) : (
                <>
                  <FaSave /> {isEditMode ? (session?.tenantConfig?.type === 'self_service' ? 'Save Changes' : 'Save & Resubmit') : 'Submit Grant'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateGrant;
