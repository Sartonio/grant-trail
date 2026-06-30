// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import './App.css';
import { supabase } from './supabaseClient';
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
import { fetchSessionContext } from './lib/billing';
import { Guard, GRANTEE_BILLING_REDIRECT } from './lib/guards';
import { ROLES, needsSubscription, isAuthenticated } from './lib/policy';
import { useNotifications } from './hooks/useNotifications';
import { usePlatformSettings } from './hooks/usePlatformSettings';
import { useMembership } from './hooks/useMembership';

// Charity onboarding (S9) is token-auth, not session-auth. The pay-first webhook
// emails a one-time signup link carrying an invite token; we reuse the existing
// invite-based CompleteProfile flow by mapping ?token= -> ?invite=.
function FiscalAgentOnboardRedirect() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || params.get('invite');
  return <Navigate to={token ? `/complete-profile?invite=${encodeURIComponent(token)}` : '/login'} replace />;
}

function App() {
  const [session,         setSession]         = useState(null);
  const [sessionLoading,  setSessionLoading]  = useState(true);
  const [accountDisabled, setAccountDisabled] = useState(false);
  const [sessionError,    setSessionError]    = useState(false); // session bootstrap failed
  const [needsProfile,   setNeedsProfile]   = useState(false);
  const [authUser,       setAuthUser]       = useState(null); // Auth user without a users table record

  const platformSettings = usePlatformSettings();
  const { loadMembershipStatus, refreshMembership } = useMembership(session, setSession);
  const { notifications, handleMarkRead, handleMarkAllRead, handleClearAll } = useNotifications(session);

  useEffect(() => {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const hasRecoveryToken = hash.includes('type=recovery') || search.includes('type=recovery');
    const hasRecoveryError = hash.includes('error_code=otp_expired') || hash.includes('error=access_denied');

    // Backward-compatible handling for recovery links that land on '/'.
    // Also route recovery failures to the reset page so users get actionable guidance.
    if ((hasRecoveryToken || hasRecoveryError) && window.location.pathname !== '/reset-password') {
      window.history.replaceState({}, '', `/reset-password${search}${hash}`);
    }
  }, []);

  useEffect(() => {
    const getSession = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          return;
        }

        // Single round trip: profile + tenant + settings + membership (issue #12).
        const context = await fetchSessionContext();

        if (!context) {
          // Auth user exists but no profile — needs to complete profile
          setAuthUser(user);
          setNeedsProfile(true);
          return;
        }

        const { userRecord, tenant, tenantConfig, membership } = context;

        if (!userRecord.is_active) {
          await supabase.auth.signOut();
          setAccountDisabled(true);
          return;
        }

        if (tenant && !tenant.is_active && userRecord.role !== 'super_admin') {
          await supabase.auth.signOut();
          setAccountDisabled(true);
          return;
        }

        setSession({ user, userRecord, tenantConfig, membership });
      } catch (err) {
        // Surface the failure instead of leaving the user on a blank screen.
        console.error('Failed to initialise session:', err);
        Sentry.captureException(err);
        setSessionError(true);
      } finally {
        setSessionLoading(false);
      }
    };
    getSession();
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setNeedsProfile(false);
    setAuthUser(null);
  }

  // Called after CompleteProfile form submission
  async function handleProfileComplete({ user, userRecord }) {
    try {
      // Single round trip for tenant + settings + membership (issue #12). Fetch
      // before clearing needsProfile — otherwise the route guard sees
      // needsProfile=false + session=null and redirects to /login.
      const context = await fetchSessionContext();
      const resolvedRecord = context?.userRecord ?? userRecord;
      const tenantConfig = context?.tenantConfig ?? { type: undefined, name: undefined };
      const membership = context?.membership ?? await loadMembershipStatus(resolvedRecord);
      // Set session first, then clear needsProfile — both update in the same React batch
      setSession({ user, userRecord: resolvedRecord, tenantConfig, membership });
      setNeedsProfile(false);
      setAuthUser(null);
    } catch (err) {
      console.error('Failed to load session after profile completion:', err);
      Sentry.captureException(err);
      setSessionError(true);
    }
  }

  // Called by Login.js after successful auth. Check is_active before setting session.
  async function handleLogin({ user, userRecord }) {
    if (userRecord && !userRecord.is_active) {
      supabase.auth.signOut();
      setAccountDisabled(true);
      return;
    }
    try {
      // Single round trip for tenant + settings + membership (issue #12).
      const context = await fetchSessionContext();
      const resolvedRecord = context?.userRecord ?? userRecord;
      if (context?.tenant && !context.tenant.is_active && resolvedRecord.role !== 'super_admin') {
        supabase.auth.signOut();
        setAccountDisabled(true);
        return;
      }
      const tenantConfig = context?.tenantConfig ?? { type: undefined, name: undefined };
      const membership = context?.membership ?? await loadMembershipStatus(resolvedRecord);
      setSession({ user, userRecord: resolvedRecord, tenantConfig, membership });
    } catch (err) {
      console.error('Failed to load session after login:', err);
      Sentry.captureException(err);
      setSessionError(true);
    }
  }

  if (sessionLoading) return null;

  if (accountDisabled) {
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
          <div style={{ fontSize: '2rem', marginBottom: '0.4em' }}>🔒</div>
          <h2 style={{ color: '#111827', marginBottom: '0.5em', fontSize: '1.2rem' }}>
            Account Disabled
          </h2>
          <p style={{ color: '#6b7280', fontSize: '0.95rem', lineHeight: 1.6 }}>
            Your account has been disabled. Please contact your administrator for assistance.
          </p>
        </div>
      </div>
    );
  }

  if (sessionError) {
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
          <div style={{ fontSize: '2rem', marginBottom: '0.4em' }}>⚠️</div>
          <h2 style={{ color: '#111827', marginBottom: '0.5em', fontSize: '1.2rem' }}>
            Something went wrong
          </h2>
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
        </div>
      </div>
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
    if (!session) return <LandingPage />;
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
            return, S9 onboard) stay public — the seeker paywall is an
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
              // Pay-first onboarding provisions a fresh tenant + admin — only valid
              // for logged-out visitors. Signed-in users (grantee/admin) would pay
              // for nothing, so bounce them back to the directory.
              isAuthenticated(session) ? <Navigate to="/fiscal-agents" replace /> : <FiscalAgentListIntake />
            }
          />
          <Route
            path="/fiscal-agents/checkout/return"
            element={<FiscalAgentCheckoutReturn />}
          />
          <Route
            path="/fiscal-agents/onboard"
            element={<FiscalAgentOnboardRedirect />}
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
              <AdminGrantList session={session} />
            </Guard>
          } />
          <Route path="/admin/grants/:id" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <AdminGrantReview session={session} />
            </Guard>
          } />
          <Route path="/admin/audit" element={
            <Guard session={session} requireRole={ROLES.ADMIN} roleRedirect="/" billingMode="readOnly">
              <AdminAuditLog session={session} />
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
        </Routes>
        </div>
        <Footer session={session} platformSettings={platformSettings} />
      </div>
    </Router>
  );
}

export default App;