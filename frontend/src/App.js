// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
import { fetchMembershipStatus, hasRequiredSubscription, syncMembershipFromStripe } from './lib/billing';

function App() {
  const [session,         setSession]         = useState(null);
  const [sessionLoading,  setSessionLoading]  = useState(true);
  const [accountDisabled, setAccountDisabled] = useState(false);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userRecord } = await supabase
          .from('users')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (!userRecord) {
          // Auth user exists but no profile — needs to complete profile
          setAuthUser(user);
          setNeedsProfile(true);
          setSessionLoading(false);
          return;
        }

        if (!userRecord.is_active) {
          await supabase.auth.signOut();
          setAccountDisabled(true);
          setSessionLoading(false);
          return;
        }

        // Fetch tenant info and settings for the user's tenant
        const { data: tenant } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', userRecord.tenant_id)
          .single();

        if (tenant && !tenant.is_active && userRecord.role !== 'super_admin') {
          await supabase.auth.signOut();
          setAccountDisabled(true);
          setSessionLoading(false);
          return;
        }

        const { data: settings } = await supabase
          .from('tenant_settings')
          .select('*')
          .eq('tenant_id', userRecord.tenant_id)
          .single();

        const tenantConfig = { ...settings, type: tenant?.tenant_type, name: tenant?.name };
        const membership = await loadMembershipStatus(userRecord);

        setSession({ user, userRecord, tenantConfig, membership });
      }
      setSessionLoading(false);
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
    // Fetch tenant info before clearing needsProfile — otherwise the route guard
    // sees needsProfile=false + session=null and redirects to /login
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', userRecord.tenant_id)
      .single();
    const { data: settings } = await supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', userRecord.tenant_id)
      .single();
    const tenantConfig = { ...settings, type: tenant?.tenant_type, name: tenant?.name };
    const membership = await loadMembershipStatus(userRecord);
    // Set session first, then clear needsProfile — both update in the same React batch
    setSession({ user, userRecord, tenantConfig, membership });
    setNeedsProfile(false);
    setAuthUser(null);
  }

  // Called by Login.js after successful auth. Check is_active before setting session.
  async function handleLogin({ user, userRecord }) {
    if (userRecord && !userRecord.is_active) {
      supabase.auth.signOut();
      setAccountDisabled(true);
      return;
    }
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', userRecord.tenant_id)
      .single();
    if (tenant && !tenant.is_active && userRecord.role !== 'super_admin') {
      supabase.auth.signOut();
      setAccountDisabled(true);
      return;
    }
    const { data: settings } = await supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', userRecord.tenant_id)
      .single();
    const tenantConfig = { ...settings, type: tenant?.tenant_type, name: tenant?.name };
    const membership = await loadMembershipStatus(userRecord);
    setSession({ user, userRecord, tenantConfig, membership });
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

  const userNeedsSubscription = session ? !hasRequiredSubscription(session) : false;
  const isSubscriptionRestricted = !!session && session.userRecord?.role !== 'super_admin' && userNeedsSubscription;
  const isGranteeWithoutSubscription = session?.userRecord?.role === 'grantee' && userNeedsSubscription;
  const isAdminWithoutSubscription = session?.userRecord?.role === 'admin' && userNeedsSubscription;

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
          <Route
            path="/"
            element={
              needsProfile ? <Navigate to="/complete-profile" /> :
              !session ? <LandingPage /> :
              session.userRecord?.role === 'super_admin' ? <Navigate to="/super/tenants" /> :
              isSubscriptionRestricted ? <Navigate to="/home" /> :
              session.userRecord?.role === 'admin' ? <Navigate to="/admin" /> :
              isGranteeWithoutSubscription ? <Navigate to="/home" /> :
              <Main session={session} />
            }
          />
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

          {/* Grantee routes (membership guard: grantees need Basic+ subscription) */}
          <Route
            path="/grants"
            element={session ? (isGranteeWithoutSubscription ? <Navigate to="/home" /> : <Grants session={session} />) : <Navigate to="/login" />}
          />
          <Route
            path="/grants/new"
            element={session ? (isGranteeWithoutSubscription ? <Navigate to="/home" /> : <CreateGrant session={session} />) : <Navigate to="/login" />}
          />
          <Route
            path="/grants/:id/edit"
            element={session ? (isGranteeWithoutSubscription ? <Navigate to="/home" /> : <CreateGrant session={session} />) : <Navigate to="/login" />}
          />
          <Route
            path="/grants/:id"
            element={session ? (isGranteeWithoutSubscription ? <Navigate to="/home" /> : <GrantDetail session={session} />) : <Navigate to="/login" />}
          />
          <Route
            path="/grants/:id/breakdown"
            element={session ? (isGranteeWithoutSubscription ? <Navigate to="/home" /> : <GrantBreakdown session={session} />) : <Navigate to="/login" />}
          />
          <Route
            path="/expenses"
            element={session ? (isGranteeWithoutSubscription ? <Navigate to="/home" /> : <ExpenseReports session={session} />) : <Navigate to="/login" />}
          />
          <Route
            path="/subscription"
            element={session ? <SubscriptionPage session={session} onMembershipUpdated={refreshMembership} /> : <Navigate to="/login" />}
          />

          {/* Admin routes */}
          <Route
            path="/admin"
            element={session?.userRecord?.role === 'admin' ? (isAdminWithoutSubscription ? <Navigate to="/home" /> : <AdminDashboard session={session} />) : <Navigate to="/" />}
          />
          <Route
            path="/admin/grants"
            element={session?.userRecord?.role === 'admin' ? (isAdminWithoutSubscription ? <Navigate to="/home" /> : <AdminGrantList session={session} />) : <Navigate to="/" />}
          />
          <Route
            path="/admin/grants/:id"
            element={session?.userRecord?.role === 'admin' ? (isAdminWithoutSubscription ? <Navigate to="/home" /> : <AdminGrantReview session={session} />) : <Navigate to="/" />}
          />
          <Route
            path="/admin/audit"
            element={session?.userRecord?.role === 'admin' ? (isAdminWithoutSubscription ? <Navigate to="/home" /> : <AdminAuditLog session={session} />) : <Navigate to="/" />}
          />
          <Route
            path="/admin/users"
            element={session?.userRecord?.role === 'admin' ? (isAdminWithoutSubscription ? <Navigate to="/home" /> : <AdminUserList session={session} />) : <Navigate to="/" />}
          />
          <Route
            path="/admin/settings"
            element={session?.userRecord?.role === 'admin' ? (isAdminWithoutSubscription ? <Navigate to="/home" /> : <AdminSettings session={session} />) : <Navigate to="/" />}
          />

          {/* Super admin routes */}
          <Route
            path="/super/tenants"
            element={session?.userRecord?.role === 'super_admin' ? <TenantManagement session={session} /> : <Navigate to="/" />}
          />
        </Routes>
        </div>
        <Footer session={session} platformSettings={platformSettings} />
      </div>
    </Router>
  );
}

export default App;