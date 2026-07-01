// src/App.js
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import './styles/variables.css';
import './styles/global.css';
import './styles/utilities.css';
import './styles/Charts.css';

import Header from './components/layout/Header';
import Main from './components/grant/Main';
import Footer from './components/layout/Footer';
import Login from './components/auth/Login';
import SignUp from './components/auth/SignUpClean';
import ResetPassword from './components/auth/ResetPassword';
import Grants from './components/grant/Grants';
import GrantDetail from './components/grant/GrantDetail';
import GrantBreakdown from './components/grant/GrantBreakdown';
import CreateGrant from './components/grant/CreateGrant';
import ExpenseReports from './components/grant/ExpenseReports';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminGrantList from './components/admin/AdminGrantList';
import AdminGrantReview from './components/admin/AdminGrantReview';
import AdminAuditLog from './components/admin/AdminAuditLog';
import AdminUserList from './components/admin/AdminUserList';
import TenantManagement from './components/admin/TenantManagement';
import AdminListingVerification from './components/admin/AdminListingVerification';
import AdminSettings from './components/admin/AdminSettings';
import CompleteProfile from './components/auth/CompleteProfile';
import LandingPage from './components/landing/LandingPage';
import Join from './components/auth/Join';
import SubscriptionPage from './components/billing/SubscriptionPage';
import FiscalAgentDirectory from './components/fiscalAgent/FiscalAgentDirectory';
import FiscalAgentProfile from './components/fiscalAgent/FiscalAgentProfile';
import FiscalAgentListIntake from './components/fiscalAgent/FiscalAgentListIntake';
import FiscalAgentCheckoutReturn from './components/fiscalAgent/FiscalAgentCheckoutReturn';
import FiscalAgentOwnerDashboard from './components/fiscalAgent/FiscalAgentOwnerDashboard';
import FiscalAgentListingEditor from './components/fiscalAgent/FiscalAgentListingEditor';
import { Guard, GRANTEE_BILLING_REDIRECT } from './lib/guards';
import { ROLES, needsSubscription, isAuthenticated } from './lib/policy';
import { useNotifications } from './hooks/useNotifications';
import { usePlatformSettings } from './hooks/usePlatformSettings';
import { useSession } from './hooks/useSession';

// Full-screen branded notice for pre-session states (account disabled / session
// error). Shared shell; callers pass the icon, title, and body (message + any
// action button).
function FullScreenNotice({ icon, title, children }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#f9fafb', fontFamily: 'Montserrat, sans-serif', padding: '2em',
    }}>
      <img src="/logo-full.png" alt="GrantTrail" style={{ height: 56, marginBottom: '1.5em' }} />
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '2em 2.5em', maxWidth: 420, textAlign: 'center',
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.4em' }}>{icon}</div>
        <h2 style={{ color: '#111827', marginBottom: '0.5em', fontSize: '1.2rem' }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
function App() {
  const {
    session,
    sessionLoading,
    accountDisabled,
    sessionError,
    needsProfile,
    authUser,
    refreshMembership,
    handleLogout,
    handleProfileComplete,
    handleLogin,
  } = useSession();

  const platformSettings = usePlatformSettings();
  const { notifications, handleMarkRead, handleMarkAllRead, handleClearAll } = useNotifications(session);

  if (sessionLoading) return null;

  if (accountDisabled) {
    return (
      <FullScreenNotice icon="🔒" title="Account Disabled">
        <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.6 }}>
          Your account has been disabled. Please contact your administrator for assistance.
        </p>
      </FullScreenNotice>
    );
  }

  if (sessionError) {
    return (
      <FullScreenNotice icon="⚠️" title="Something went wrong">
        <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '1.2em' }}>
          We couldn’t load your session. Please check your connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#111827', color: '#fff', border: 'none', borderRadius: 8,
            padding: '0.6em 1.4em', fontSize: '0.95rem', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Retry
        </button>
      </FullScreenNotice>
    );
  }

  // Grantee routes are grantee-only. A non-grantee that lands on one is sent to
  // their own home (the same role redirect targets "/" uses): super_admin ->
  // /super/tenants, admin -> /admin. Anyone without a recognized role (i.e.
  // unauthenticated) keeps the historical /login redirect.
  function granteeRoleRedirect(s) {
    const role = s?.userRecord?.role;
    if (role === ROLES.SUPER_ADMIN) return '/super/tenants';
    if (role === ROLES.ADMIN) return '/admin';
    return '/login';
  }

  // Root ("/") landing decision. Role-based authorization and billing gating are
  // kept as two separate concerns (issue #41); the rest of the app expresses
  // them declaratively via <Guard>, but "/" is a multi-target dispatcher so it
  // resolves them inline against the same centralized policy (lib/policy.js).
  function resolveRootElement() {
    if (needsProfile) return <Navigate to="/complete-profile" />;
    if (!session) return <LandingPage session={session} />;
    if (session.userRecord?.role === ROLES.SUPER_ADMIN) return <Navigate to="/super/tenants" />;
    // Authenticated-but-unpaid (non-super) -> upgrade landing (the billing nudge target).
    if (needsSubscription(session)) return <Navigate to={GRANTEE_BILLING_REDIRECT} />;
    if (session.userRecord?.role === ROLES.ADMIN) return <Navigate to="/admin" />;
    return <Main session={session} />;
  }

  return (
    <Router>
      <div id="wrapper">
        <Header
          onLogout={handleLogout}
          session={session}
          notifications={notifications}
          onMarkRead={handleMarkRead}
          onMarkAllRead={handleMarkAllRead}
          onClearAll={handleClearAll}
        />
        <div className="app-content">
        <Routes>
          {/* Root: public landing page for logged-out visitors, dashboard redirect for authenticated users */}
          <Route path="/" element={resolveRootElement()} />
          <Route
            path="/home"
            element={session ? <LandingPage session={session} /> : <Navigate to="/" />}
          />
          <Route
            path="/login"
            element={<Login onLogin={handleLogin} />}
          />
          {/* Single decision point for new accounts. Authenticated users have
              already chosen a path, so bounce them home. Invite links skip this
              and go straight to /signup?invite=…. */}
          <Route
            path="/join"
            element={isAuthenticated(session) ? <Navigate to="/" replace /> : <Join />}
          />
          <Route
            path="/signup"
            element={<SignUp />}
          />
          <Route
            path="/reset-password"
            element={<ResetPassword />}
          />
          {/*
            Fiscal Agent / Charity Directory.
            Public surfaces (S1/S2 directory, S3/S4 profile, S5 intake, S7/S8
            return) stay public — the seeker paywall is an
            in-component check (canViewDirectory), NOT a route redirect, so the
            marketing page is reachable while anonymous. Owner surfaces
            (S10–S12) are admin-only with read-only billing degrade (#40).
          */}
          <Route
            path="/fiscal-agents"
            element={<FiscalAgentDirectory session={session} />}
          />
          <Route
            path="/fiscal-agents/list"
            element={
              // Account-first onboarding: the "list your charity" page is just a
              // CTA into /signup?plan=fiscal-agent. Signed-in users already have an
              // account/tenant, so bounce them back to the directory.
              isAuthenticated(session) ? <Navigate to="/fiscal-agents" replace /> : <FiscalAgentListIntake />
            }
          />
          <Route
            path="/fiscal-agents/checkout/return"
            element={<FiscalAgentCheckoutReturn />}
          />
          <Route path="/fiscal-agents/me" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <FiscalAgentOwnerDashboard session={session} tab="overview" />
            </Guard>
          } />
          <Route path="/fiscal-agents/me/inbox" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <FiscalAgentOwnerDashboard session={session} tab="inbox" />
            </Guard>
          } />
          <Route path="/fiscal-agents/listing/edit" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <FiscalAgentListingEditor session={session} />
            </Guard>
          } />
          {/* Shareable public Fiscal Agent profile page (teaser/full split). */}
          <Route
            path="/fiscal-agents/:id"
            element={<FiscalAgentProfile session={session} />}
          />
          <Route
            path="/complete-profile"
            element={
              needsProfile
                ? <CompleteProfile session={{ user: authUser }} onProfileComplete={handleProfileComplete} />
                : session
                  ? <Navigate to="/" />
                  : <Navigate to="/login" />
            }
          />

          {/*
            Grantee routes — authz axis: grantee-only. A non-grantee is sent to
            its own home (granteeRoleRedirect: admin -> /admin, super_admin ->
            /super/tenants; unauthenticated -> /login). Billing axis: unpaid
            grantee redirected to the upgrade landing (unchanged).
          */}
          <Route path="/grants" element={
            <Guard session={session} requireRole={ROLES.GRANTEE} roleRedirect={granteeRoleRedirect} billingMode="redirect">
              <Grants session={session} />
            </Guard>
          } />
          <Route path="/grants/new" element={
            <Guard session={session} requireRole={ROLES.GRANTEE} roleRedirect={granteeRoleRedirect} billingMode="redirect">
              <CreateGrant session={session} />
            </Guard>
          } />
          <Route path="/grants/:id/edit" element={
            <Guard session={session} requireRole={ROLES.GRANTEE} roleRedirect={granteeRoleRedirect} billingMode="redirect">
              <CreateGrant session={session} />
            </Guard>
          } />
          <Route path="/grants/:id" element={
            <Guard session={session} requireRole={ROLES.GRANTEE} roleRedirect={granteeRoleRedirect} billingMode="redirect">
              <GrantDetail session={session} />
            </Guard>
          } />
          <Route path="/grants/:id/breakdown" element={
            <Guard session={session} requireRole={ROLES.GRANTEE} roleRedirect={granteeRoleRedirect} billingMode="redirect">
              <GrantBreakdown session={session} />
            </Guard>
          } />
          <Route path="/expenses" element={
            <Guard session={session} requireRole={ROLES.GRANTEE} roleRedirect={granteeRoleRedirect} billingMode="redirect">
              <ExpenseReports session={session} />
            </Guard>
          } />
          <Route path="/subscription" element={
            <Guard session={session} requireRole="authenticated" roleRedirect="/login" billingMode="none">
              <SubscriptionPage session={session} onMembershipUpdated={refreshMembership} />
            </Guard>
          } />

          {/*
            Admin routes — authz axis: role must be admin (else -> /); billing axis:
            read-only degrade (#40). A lapsed admin VIEWS every admin route; the
            guard injects readOnly and mutation handlers route writes to the nudge.
          */}
          <Route path="/admin" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <AdminDashboard session={session} />
            </Guard>
          } />
          <Route path="/admin/grants" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <AdminGrantList />
            </Guard>
          } />
          <Route path="/admin/grants/:id" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <AdminGrantReview session={session} />
            </Guard>
          } />
          <Route path="/admin/audit" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <AdminAuditLog />
            </Guard>
          } />
          <Route path="/admin/users" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <AdminUserList session={session} />
            </Guard>
          } />
          <Route path="/admin/settings" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <AdminSettings session={session} />
            </Guard>
          } />

          {/* Super admin routes — authz axis only; super_admin is billing-exempt. */}
          <Route path="/super/tenants" element={
            <Guard session={session} requireRole={ROLES.SUPER_ADMIN} roleRedirect="/" billingMode="none">
              <TenantManagement session={session} />
            </Guard>
          } />
          <Route path="/super/listings" element={
            <Guard session={session} requireRole={ROLES.SUPER_ADMIN} roleRedirect="/" billingMode="none">
              <AdminListingVerification />
            </Guard>
          } />
        </Routes>
        </div>
        <Footer session={session} platformSettings={platformSettings} />
      </div>
    </Router>
  );
}

export default App;