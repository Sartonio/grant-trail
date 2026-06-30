import { useState, useRef, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../../supabaseClient';
import {
  FaUpload,
  FaExternalLinkAlt,
  FaTrash,
  FaCheckCircle,
  FaTimes,
} from 'react-icons/fa';
import './GrantAttachments.css';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx';

const CATEGORY_LABELS = {
  proposal: 'Proposal',
  budget:   'Budget',
  report:   'Report',
  general:  'General',
};

function fmtBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${parseInt(d, 10)}-${months[parseInt(m, 10) - 1]}-${y}`;
}

function GrantAttachments({ grantId, session, readOnly = false }) {
  const [attachments, setAttachments] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  // Upload form state
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const fileInputRef = useRef(null);

  const fetchAttachments = async () => {
    const { data } = await supabase
      .from('grant_attachments')
      .select('*')
      .eq('grant_id', grantId)
      .order('created_at', { ascending: false });
    setAttachments(data || []);
    setLoadingList(false);
  };

  useEffect(() => {
    if (grantId) fetchAttachments();
  }, [grantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!ALLOWED_TYPES.includes(f.type)) {
      setError('File must be a PDF, JPG, PNG, Word, or Excel document.');
      e.target.value = '';
      return;
    }
    if (f.size > MAX_BYTES) {
      setError('File must be 5 MB or smaller.');
      e.target.value = '';
      return;
    }
    setFile(f);
    if (error) setError('');
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = async () => {
    if (!file) { setError('Please select a file first.'); return; }
    setUploading(true);
    setError('');
    try {
      const tenantId = session?.userRecord?.tenant_id;
      const storagePath = `attachments/${tenantId}/${grantId}/${Date.now()}-${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from('grant-documents')
        .upload(storagePath, file, { upsert: false });
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

      const { error: dbErr } = await supabase.from('grant_attachments').insert({
        grant_id:    grantId,
        file_name:   file.name,
        file_path:   storagePath,
        file_type:   file.type,
        file_size:   file.size,
        uploaded_by: session?.user?.id,
        description: description.trim() || null,
        category,
      });
      if (dbErr) {
        // Compensate: remove the uploaded file so storage stays consistent
        await supabase.storage.from('grant-documents').remove([storagePath]);
        throw dbErr;
      }

      clearFile();
      setDescription('');
      setCategory('general');
      await fetchAttachments();
    } catch (err) {
      console.error('Attachment upload error:', err);
      Sentry.captureException(err);
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleView = async (storagePath) => {
    const { data, error: signErr } = await supabase.storage
      .from('grant-documents')
      .createSignedUrl(storagePath, 60);
    if (signErr || !data?.signedUrl) {
      alert('Could not open file. Please try again.');
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const handleDelete = async (att) => {
    if (deletingId !== att.id) {
      setDeletingId(att.id);
      return;
    }
    // Second click = confirmed
    try {
      await supabase.storage.from('grant-documents').remove([att.file_path]);
      await supabase.from('grant_attachments').delete().eq('id', att.id);
      setDeletingId(null);
      await fetchAttachments();
    } catch (err) {
      console.error('Delete error:', err);
      Sentry.captureException(err);
      alert('Could not delete file. Please try again.');
      setDeletingId(null);
    }
  };

  return (
    <div className="ga-root">

      {/* Upload form — grantee only */}
      {!readOnly && (
        <div className="ga-upload-form">
          <div className="ga-upload-row">

            {/* File picker */}
            <div className="ga-file-area">
              {file ? (
                <div className="ga-file-selected">
                  <FaCheckCircle className="ga-file-ok-icon" />
                  <span className="ga-file-name" title={file.name}>{file.name}</span>
                  <span className="ga-file-size">{fmtBytes(file.size)}</span>
                  <button
                    type="button"
                    className="ga-clear-btn"
                    onClick={clearFile}
                    aria-label="Remove file"
                  >
                    <FaTimes />
                  </button>
                </div>
              ) : (
                <div
                  className="ga-drop-zone"
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
                >
                  <FaUpload className="ga-drop-icon" />
                  <span className="ga-drop-text">Click to choose a file</span>
                  <span className="ga-drop-hint">PDF, Word, Excel, JPG, PNG · Max 5 MB</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_EXTENSIONS}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            {/* Category + description */}
            <div className="ga-meta-col">
              <select
                className="ga-category-select"
                value={category}
                onChange={e => setCategory(e.target.value)}
              >
                <option value="general">General</option>
                <option value="proposal">Proposal</option>
                <option value="budget">Budget</option>
                <option value="report">Report</option>
              </select>
              <input
                type="text"
                className="ga-desc-input"
                placeholder="Description (optional)"
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={200}
              />
            </div>

            {/* Upload button */}
            <button
              className="ga-upload-btn"
              onClick={handleUpload}
              disabled={uploading || !file}
            >
              {uploading ? (
                <><div className="button-spinner" /> Uploading…</>
              ) : (
                <><FaUpload /> Upload</>
              )}
            </button>
          </div>

          {error && (
            <div className="ga-error">
              <FaTimes className="ga-error-icon" /> {error}
            </div>
          )}
        </div>
      )}

      {/* Attachment list */}
      {loadingList ? (
        <p className="ga-loading">Loading…</p>
      ) : attachments.length === 0 ? (
        <p className="ga-empty">
          {readOnly
            ? 'No attachments have been uploaded for this grant.'
            : 'No attachments yet — upload a file above.'}
        </p>
      ) : (
        <div className="ga-list">
          {attachments.map(att => (
            <div key={att.id} className="ga-item">
              <div className="ga-item-left">
                <span className={`ga-cat-badge ga-cat-${att.category}`}>
                  {CATEGORY_LABELS[att.category] || att.category}
                </span>
                <div className="ga-item-text">
                  <span className="ga-item-name" title={att.file_name}>
                    {att.file_name}
                  </span>
                  {att.description && (
                    <span className="ga-item-desc">{att.description}</span>
                  )}
                </div>
              </div>

              <div className="ga-item-right">
                <span className="ga-item-meta">
                  {fmtBytes(att.file_size)} · {fmtDate(att.created_at)}
                </span>

                <div className="ga-item-actions">
                  <button
                    className="ga-view-btn"
                    onClick={() => handleView(att.file_path)}
                    title="Open file"
                  >
                    <FaExternalLinkAlt /> View
                  </button>

                  {!readOnly && (
                    deletingId === att.id ? (
                      <div className="ga-confirm-delete">
                        <span>Delete?</span>
                        <button className="ga-confirm-yes" onClick={() => handleDelete(att)}>Yes</button>
                        <button className="ga-confirm-no" onClick={() => setDeletingId(null)}>No</button>
                      </div>
                    ) : (
                      <button
                        className="ga-delete-btn"
                        onClick={() => handleDelete(att)}
                        title="Delete attachment"
                      >
                        <FaTrash />
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GrantAttachments;
