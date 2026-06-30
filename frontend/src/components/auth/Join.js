// src/components/Join.js
// The single decision point for new (non-invited) accounts. A logged-out visitor
// picks their path once; that choice routes to the flow that assigns their role
// and collects payment:
//   - Self-serve (find a fiscal agent / track grants) -> /signup -> grantee + Basic.
//   - Fiscal agent (list a charity)                    -> /fiscal-agents/list -> admin + Premium.
// Invited users never land here — invite links go straight to /signup?invite=…,
// which presets the role and skips payment (covered by the inviting org).
import React from 'react';
import { Link } from 'react-router-dom';
import { FaSeedling, FaBuilding, FaArrowRight, FaHandshake } from 'react-icons/fa';
import '../fiscalAgent/FiscalAgentDirectory.css';

export default function Join() {
  return (
    <div className="fad-page">
      <section className="fad-hero">
        <h1>How do you want to use GrantTrail?</h1>
        <p>Pick the option that fits — you can pay and finish setting up in the next step.</p>
      </section>

      <div className="fad-plan-grid">
        <div className="fad-plan">
          <span className="fad-plan-icon"><FaHandshake /></span>
          <span className="fad-plan-name">Find a fiscal agent &amp; track grants</span>
          <p className="fad-plan-note">
            Browse fiscal agents, reach out for sponsorship, and manage your grants and
            expenses in one place.
          </p>
          <Link to="/signup" className="fad-btn fad-btn-primary fad-btn-block">
            Get started <FaArrowRight />
          </Link>
        </div>

        <div className="fad-plan">
          <span className="fad-plan-icon"><FaBuilding /></span>
          <span className="fad-plan-name">Become a fiscal agent</span>
          <p className="fad-plan-note">
            List your 501(c)(3) in the directory so organizations seeking a fiscal sponsor
            can find and apply to you.
          </p>
          <Link to="/fiscal-agents/list" className="fad-btn fad-btn-gold fad-btn-block">
            <FaSeedling /> List your charity
          </Link>
        </div>
      </div>

      <p className="fad-paywall-fine" style={{ textAlign: 'center', marginTop: '1.5em' }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
