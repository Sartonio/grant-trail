import React, { useState } from 'react';
import { FiAlertTriangle, FiRefreshCw, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import './ErrorFallback.css';

export function ErrorFallback({ error, resetError }) {
  const [showDetails, setShowDetails] = useState(false);

  function handleReload() {
    if (resetError) {
      resetError();
    } else {
      window.location.reload();
    }
  }

  return (
    <div className="error-fallback-container">
      <div className="error-fallback-card">
        <div className="error-fallback-icon-wrapper">
          <FiAlertTriangle className="error-fallback-icon" />
        </div>
        <h1 className="error-fallback-title">Something went wrong</h1>
        <p className="error-fallback-message">
          An unexpected error occurred in the application. Our development team has been automatically notified.
        </p>

        <div className="error-fallback-actions">
          <button className="error-fallback-btn-retry" onClick={handleReload}>
            <FiRefreshCw className="btn-icon" /> Reload Application
          </button>
          
          {error && (
            <button 
              className="error-fallback-btn-details" 
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? (
                <>Hide details <FiChevronUp style={{ marginLeft: '4px' }} /></>
              ) : (
                <>Show details <FiChevronDown style={{ marginLeft: '4px' }} /></>
              )}
            </button>
          )}
        </div>

        {error && showDetails && (
          <div className="error-fallback-details">
            <h3 className="details-header">Diagnostic Information</h3>
            <pre className="details-stack">
              <strong>{error.toString()}</strong>
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default ErrorFallback;
