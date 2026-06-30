import React from 'react';
import { FaEnvelope, FaPhone } from 'react-icons/fa';
import './Footer.css';

function Footer({ session, platformSettings }) {
  const currentYear = new Date().getFullYear();

  // Tenant-specific → platform default → hardcoded fallback
  const email = session?.tenantConfig?.support_email
    || platformSettings?.default_support_email
    || 'support@granttrail.org';
  const phone = session?.tenantConfig?.support_phone
    || platformSettings?.default_support_phone
    || '(555) 123-4567';

  return (
    <footer className="footer-base">
      <div className="footer-content">
        {/* Left Section - Branding */}
        <div className="footer-section footer-brand">
          <h3>Grant Trail</h3>
          <p>&copy; {currentYear} GrantTrail. All Rights Reserved.</p>
        </div>

        {/* Right Section - Contact */}
        <div className="footer-section footer-contact">
          <h4>Contact Us</h4>
          <div className="contact-info">
            <a href={`mailto:${email}`} className="contact-item">
              <FaEnvelope />
              <span>{email}</span>
            </a>
            {/*}
            <a href={`tel:${phone.replace(/[^+\d]/g, '')}`} className="contact-item">
              <FaPhone />
              <span>{phone}</span>
            </a>
            */}
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
