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
import './App.css';

import Header from './components/Header';
import Main from './components/Main';
import Footer from './components/Footer';
import Login from './components/Login';
import SignUp from './components/SignUpClean';
import ResetPassword from './components/ResetPassword';
import Grants from './components/Grants';
import GrantDetail from './components/GrantDetail';
import GrantBreakdown from './components/GrantBreakdown';
import CreateGrant from './components/CreateGrant';
import ExpenseReports from './components/ExpenseReports';
import AdminDashboard from './components/AdminDashboard';
import AdminGrantList from './components/AdminGrantList';
import AdminGrantReview from './components/AdminGrantReview';
import AdminAuditLog from './components/AdminAuditLog';
import AdminUserList from './components/AdminUserList';
import TenantManagement from './components/TenantManagement';
import AdminSettings from './components/AdminSettings';
import CompleteProfile from './components/CompleteProfile';
import LandingPage from './components/LandingPage';
import SubscriptionPage from './components/SubscriptionPage';
import { fetchMembershipStatus, fetchSessionContext, syncMembershipFromStripe } from './lib/billing';
import { Guard, GRANTEE_BILLING_REDIRECT } from './lib/guards';
import { ROLES, needsSubscription } from './lib/policy';

function App() {
  const [session,         setSession]         = useState(null);
  const [sessionLoading,  setSessionLoading]  = useState(true);
  const [accountDisabled, setAccountDisabled] = useState(false);
  const [sessionError,    setSessionError]    = useState(false); // session bootstrap failed
  const [needsProfile,   setNeedsProfile]   = useState(false);
  const [authUser,       setAuthUser]       = useState(null); // Auth user without a users table record
  const [platformSettings, setPlatformSettings] = useState(null);
  const [notifications,   setNotifications]   = useState([]);

  // Membership status helper — super_admins are exempt, while grantees and some admins can require billing.
  async function loadMembershipStatus(userRecord) {
    if (!userRecord) {
      return {
        isExempt: true,
        hasBasicAccess: true,
        hasPremiumAccess: true,
        membership: null,
        activeSubscription: null,
      };
    }
    if (userRecord.role === 'super_admin') {
      return {
        isExempt: true,
        hasBasicAccess: true,
        hasPremiumAccess: true,
        membership: null,
        activeSubscription: null,
      };
    }
    try {
      return await fetchMembershipStatus();
    } catch (_error) {
      return {
        isExempt: false,
        hasBasicAccess: false,
        hasPremiumAccess: false,
        membership: null,
        activeSubscription: null,
      };
    }
  }

  async function refreshMembership() {
    if (!session?.userRecord || session.userRecord.role === 'super_admin') return;
    try {
      await syncMembershipFromStripe();
      const membership = await fetchMembershipStatus();
      setSession(prev => (prev ? { ...prev, membership: { ...membership } } : prev));
    } catch (err) {
      console.error('Failed to refresh membership:', err);
      Sentry.captureException(err);
    }
  }

  // Fetch platform-wide defaults (support contact fallbacks)
  useEffect(() => {
    async function fetchPlatformSettings() {
      const { data } = await supabase.from('platform_settings').select('*').single();
      if (data) setPlatformSettings(data);
    }
    fetchPlatformSettings();
  }, []);

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

  // Fetch notifications and subscribe to realtime updates
  useEffect(() => {
    if (!session?.userRecord) {
      setNotifications([]);
      return;
    }

    const userId = session.userRecord.id;

    async function fetchNotifications() {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      setNotifications(data || []);
    }

    fetchNotifications();

    // Subscribe to new notifications in realtime
    const channel = supabase
      .channel('user-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setNotifications(prev => [payload.new, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  function handleMarkRead(notificationId) {
    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
    );
  }

  function handleMarkAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  function handleClearAll() {
    setNotifications([]);
  }

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
        <img src="/logo.png" alt="GrantTrail" style={{ height: 56, marginBottom: '1.5em' }} />
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
        <img src="/logo.png" alt="GrantTrail" style={{ height: 56, marginBottom: '1.5em' }} />
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
          <Route
            path="/signup"
            element={<SignUp />}
          />
          <Route
            path="/reset-password"
            element={<ResetPassword />}
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
            Grantee routes — authz axis: any authenticated user (wrong/none -> /login);
            billing axis: unpaid grantee redirected to the upgrade landing.
          */}
          <Route path="/grants" element={
            <Guard session={session} requireRole="authenticated" roleRedirect="/login" billingMode="redirect">
              <Grants session={session} />
            </Guard>
          } />
          <Route path="/grants/new" element={
            <Guard session={session} requireRole="authenticated" roleRedirect="/login" billingMode="redirect">
              <CreateGrant session={session} />
            </Guard>
          } />
          <Route path="/grants/:id/edit" element={
            <Guard session={session} requireRole="authenticated" roleRedirect="/login" billingMode="redirect">
              <CreateGrant session={session} />
            </Guard>
          } />
          <Route path="/grants/:id" element={
            <Guard session={session} requireRole="authenticated" roleRedirect="/login" billingMode="redirect">
              <GrantDetail session={session} />
            </Guard>
          } />
          <Route path="/grants/:id/breakdown" element={
            <Guard session={session} requireRole="authenticated" roleRedirect="/login" billingMode="redirect">
              <GrantBreakdown session={session} />
            </Guard>
          } />
          <Route path="/expenses" element={
            <Guard session={session} requireRole="authenticated" roleRedirect="/login" billingMode="redirect">
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