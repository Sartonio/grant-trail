import React from 'react';
import { Link } from 'react-router-dom';
import { FaCheckCircle, FaArrowLeft, FaArrowRight } from 'react-icons/fa';
import './FiscalAgentDirectory.css';

/*
  Charity "list your charity" entry — account-FIRST.
  --------------------------------------------------
  The pay-first funnel (anonymous intake → checkout → webhook provisioning →
  emailed signup link) is gone. A charity now becomes a Fiscal Agent the same way
  a basic user signs up: create an account, then the Fiscal Agent (premium)
  checkout is the last step of profile completion. This page is just the value
  pitch + a CTA into that signup; org/EIN/focus/blurb are collected afterward in
  the listing editor.
*/

export default function FiscalAgentListIntake() {
  return (
    <div className="fad-page">
      <div className="fap-topbar">
        <Link to="/fiscal-agents" className="fap-back">
          <FaArrowLeft /> Back to the directory
        </Link>
      </div>

      <section className="fad-hero">
        <h1>List your charity as a Fiscal Agent</h1>
        <p>
          Create your account and choose a Fiscal Agent subscription. You’ll finish your public
          listing right after checkout — and we verify your 501(c)(3) status before it goes live.
        </p>
      </section>

      <div className="fad-intake">
        <div className="fad-plans">
          <ul className="fad-checklist">
            <li><FaCheckCircle /> Verified listing in the directory</li>
            <li><FaCheckCircle /> Receive partnership requests from organizations</li>
            <li><FaCheckCircle /> Edit your profile anytime</li>
          </ul>
        </div>

        <div className="fad-form-foot">
          <Link to="/fiscal-agents" className="fad-btn fad-btn-ghost">
            Cancel
          </Link>
          <Link to="/signup?plan=fiscal-agent" className="fad-btn fad-btn-gold">
            Create your account <FaArrowRight />
          </Link>
        </div>
      </div>
    </div>
  );
}
