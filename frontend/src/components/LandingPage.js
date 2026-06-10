import React from 'react';
import { Link } from 'react-router-dom';
import {
  FaArrowRight,
  FaChartPie,
  FaChartLine,
  FaCheckCircle,
  FaCog,
  FaFileInvoiceDollar,
  FaFolderOpen,
  FaLock,
  FaSitemap,
  FaSeedling,
  FaUsers,
} from 'react-icons/fa';
import './LandingPage.css';

const whyGrantTrailItems = [
  'Track expenses in real-time',
  'Cleaner reporting workflows',
  'Transparent funder visibility',
  'Built to scale with your team',
];

const audienceItems = [
  'Nonprofits',
  'Fiscal agents',
  'Grant teams',
  'Grassroot organizations',
];

const imageHighlights = [
  {
    image: '/landing-testimonials/GrantOversightImage.jpg',
    title: 'Grant Oversight',
    alt: 'Team member reviewing financial dashboard',
  },
  {
    image: '/landing-testimonials/TeamCollaborationImage.jpg',
    title: 'Team Collaboration',
    alt: 'Program leader with tablet in office',
  },
  {
    image: '/landing-testimonials/FinancialConfidenceImage.jpg',
    title: 'Financial Confidence',
    alt: 'Finance lead holding report tablet',
  },
];

const featureItems = [
  {
    icon: <FaChartLine />,
    title: 'Real-Time Expense Tracking',
    text: 'Live visibility on spend and budget movement.',
  },
  {
    icon: <FaLock />,
    title: 'Secure Data Management',
    text: 'All grant records and receipts in one place.',
  },
  {
    icon: <FaFileInvoiceDollar />,
    title: 'Easy Reporting Tools',
    text: 'Generate clean reporting outputs in minutes.',
  },
  {
    icon: <FaSitemap />,
    title: 'Multi-Organization Support',
    text: 'Manage multiple organizations from one dashboard.',
  },
  {
    icon: <FaCog />,
    title: 'Scalable System',
    text: 'Flexible workflows for growing teams.',
  },
  {
    icon: <FaFolderOpen />,
    title: 'Financial Insights Dashboard',
    text: 'Instant snapshots of funding and utilization.',
  },
];

const steps = [
  'Input Expenses',
  'Track in Real-Time',
  'Generate Reports',
  'Share with Funders',
];

const testimonialItems = [
  {
    image: '/landing-testimonials/SarahLTestimony1Image.jpg',
    quote: 'GrantTrail has transformed how we track and report our funding.',
    name: 'Brenna P.',
    role: 'Executive Director',
  },
  {
    image: '/landing-testimonials/raymond-owusu-afriyieTestimony2Image.jpg',
    quote: 'Finally, a platform built for nonprofit and fiscal agent workflows.',
    name: 'Sarah L.',
    role: 'Program Manager',
  },
  {
    image: '/landing-testimonials/baljkannTestimony3Image.jpg',
    quote: 'Our team can see budget progress and reporting status without chasing spreadsheets.',
    name: 'Luka R.',
    role: 'Finance Lead',
  },
];

const testimonialStats = [
  { value: '100+', label: 'Organizations' },
  { value: '500+', label: 'Projects' },
  { value: '$25M+', label: 'Expenses Tracked' },
];

function getCurrentAccessLabel(session) {
  const membership = session?.membership;
  const role = session?.userRecord?.role;

  if (!session || !membership) return null;
  if (membership.isExempt) {
    if (role === 'super_admin') return 'Exempt (Super Admin)';
    if (role === 'admin') return 'Exempt (TFAC or subscription-exempt fiscal agent)';
    return 'Full Access';
  }
  if (membership.membership?.source === 'manual') {
    return role === 'admin' ? 'Fiscal Agents Plan (Waived)' : 'Basic (Waived)';
  }
  if (role === 'admin' && membership.hasPremiumAccess) return 'Fiscal Agents Plan (Paid)';
  if (membership.hasBasicAccess) return 'Basic (Paid)';
  return 'No active subscription';
}

function LandingPage({ session }) {
  const isAuthenticated = !!session;
  const accessLabel = getCurrentAccessLabel(session);
  const primaryLink = isAuthenticated ? '/subscription' : '/signup';
  const secondaryLink = isAuthenticated ? (session?.userRecord?.role === 'admin' ? '/admin' : '/grants') : '/login';
  const primaryLabel = isAuthenticated ? 'Manage Subscription' : 'Get Started';
  const secondaryLabel = isAuthenticated ? 'Open Workspace' : 'Sign In';

  return (
    <main className="landing-page">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow">GrantTrail - Smart Financial Tracking for Impact-Driven Organizations</div>
          <h1>Simplify. Track. Report. Grow.</h1>
          <p className="landing-lede">
            One platform for expenses, grants, and reporting.
          </p>

          <div className="landing-hero-actions">
            <Link to={primaryLink} className="landing-primary-cta">
              {primaryLabel} <FaArrowRight />
            </Link>
            <Link to={secondaryLink} className="landing-secondary-cta">
              {secondaryLabel}
            </Link>
          </div>

          {isAuthenticated && accessLabel && (
            <div className="landing-session-chip">
              <FaCheckCircle />
              <span>Current access: {accessLabel}</span>
            </div>
          )}

          <div className="landing-image-strip">
            {imageHighlights.map((item) => (
              <div
                key={item.image}
                className="landing-image-tile"
                style={{ backgroundImage: `url(${item.image})` }}
                aria-label={item.alt}
                role="img"
              >
                <span>{item.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-hero-panel">
          <div className="landing-stat-card">
            <div className="landing-stat-icon" aria-hidden="true"><FaChartPie /></div>
            <span>Centralized oversight</span>
            <strong>One place for grants, expenses, and reporting</strong>
          </div>
          <div className="landing-stat-card accent">
            <div className="landing-stat-icon" aria-hidden="true"><FaUsers /></div>
            <span>Built for accountability</span>
            <strong>Clear visibility for organizations, fiscal agents, and funders</strong>
          </div>
          <div className="landing-stat-card muted">
            <div className="landing-stat-icon" aria-hidden="true"><FaSitemap /></div>
            <span>Ready to scale</span>
            <strong>From small programs to multi-organization financial management</strong>
          </div>
        </div>
      </section>

      <section className="landing-section" id="why-granttrail">
        <div className="landing-section-heading">
          <p>Why GrantTrail?</p>
          <h2>Built for fast, transparent financial workflows.</h2>
        </div>
        <div className="landing-check-grid">
          {whyGrantTrailItems.map((item) => (
            <div key={item} className="landing-check-item">
              <FaCheckCircle />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

<section className="landing-section landing-audience-section">
  <div className="landing-audience-header-container">
    <div className="landing-section-heading">
      <p>Who It's For</p>
      <h2>For teams managing funded programs.</h2>
    </div>
    
    <div 
      className="landing-audience-image"
      style={{ backgroundImage: `url('/landing-testimonials/TeamCollaborationImage.jpg')` }}
      aria-label="Team collaborating on funded programs"
      role="img"
    />
  </div>

  <div className="landing-audience-list">
    {audienceItems.map((item) => (
      <div key={item} className="landing-audience-pill">{item}</div>
    ))}
  </div>
</section>

      <section className="landing-section" id="plans">
        <div className="landing-section-heading">
          <p>Choose Your Plan</p>
          <h2>Simple pricing. Clear access.</h2>
        </div>

        <div className="landing-plan-grid">
          <article className="landing-plan-card">
            <div className="landing-plan-topline">Basic Plan</div>
            <h3>For organizations getting started.</h3>
            <ul>
              <li>Expense tracking dashboard</li>
              <li>Receipt uploading and secure storage</li>
              <li>Simple reporting tools</li>
              <li>Secure data storage</li>
              <li>User-friendly interface</li>
              <li>Affordable monthly subscription</li>
            </ul>
            <Link to={isAuthenticated ? '/subscription' : '/signup'} className="landing-plan-cta">
              {isAuthenticated ? 'Manage Basic Access' : 'Get Started'}
            </Link>
          </article>

          <article className="landing-plan-card featured">
            <div className="landing-plan-topline">Fiscal Agents (Charities) Plan</div>
            <h3>For fiscal agents managing multiple organizations.</h3>
            <ul>
              <li>Manage multiple organizations in one platform</li>
              <li>Advanced reporting and financial insights</li>
              <li>Real-time tracking across projects</li>
              <li>Enhanced transparency for funders</li>
              <li>Scalable system for growth</li>
              <li>Subscription for high-impact fiscal agents</li>
            </ul>
            <Link to={isAuthenticated ? '/subscription' : '/signup'} className="landing-plan-cta">
              {isAuthenticated ? 'Manage Fiscal Agent Access' : 'Start Managing Smarter'}
            </Link>
          </article>
        </div>
      </section>

      <section className="landing-section" id="features">
        <div className="landing-section-heading">
          <p>Features</p>
          <h2>Everything you need in one workspace.</h2>
        </div>
        <div className="landing-feature-grid">
          {featureItems.map((item) => (
            <article key={item.title} className="landing-feature-card">
              <div className="landing-feature-icon">{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="how-it-works">
        <div className="landing-section-heading">
          <p>How It Works</p>
          <h2>From entry to report in four steps.</h2>
        </div>
        <div className="landing-steps-row">
          {steps.map((step, index) => (
            <React.Fragment key={step}>
              <div className="landing-step-card">
                <span className="landing-step-number">{index + 1}</span>
                <strong>{step}</strong>
              </div>
              {index < steps.length - 1 && <div className="landing-step-arrow"><FaArrowRight /></div>}
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="landing-mission-band">
        <div>
          <p className="landing-mission-label">Our Mission</p>
          <h2>Strong systems build strong organizations.</h2>
          <p>
            Help teams focus on impact by making financial operations simpler.
          </p>
        </div>
        <div className="landing-mission-mark">
          <FaSeedling />
        </div>
      </section>

      <section className="landing-section landing-testimonial-section">
        <div className="landing-section-heading landing-testimonial-heading">
          <p>Tested by Organizations Making a Difference</p>
          <h2>Real teams using GrantTrail every day.</h2>
        </div>

        <div className="landing-testimonial-grid">
          {testimonialItems.map((item) => (
            <article key={item.name} className="landing-testimonial-card">
              <div
                className="landing-testimonial-photo"
                style={{ backgroundImage: `url(${item.image})` }}
                aria-label={item.name}
                role="img"
              />
              <div className="landing-testimonial-content">
                <div className="landing-testimonial-stars">
                  <FaCheckCircle />
                  <FaCheckCircle />
                  <FaCheckCircle />
                  <FaCheckCircle />
                  <FaCheckCircle />
                </div>
                <p>{item.quote}</p>
                <strong>{item.name}</strong>
                <span>{item.role}</span>
              </div>
            </article>
          ))}
        </div>

        <div className="landing-testimonial-stats">
          {testimonialStats.map((item) => (
            <div key={item.label} className="landing-testimonial-stat">
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default LandingPage;