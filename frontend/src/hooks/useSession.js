import { useState, useEffect } from "react";
import * as Sentry from "@sentry/react";
import { supabase } from "../supabaseClient";
import { fetchSessionContext } from "../lib/billing";
import { useMembership } from "./useMembership";

// Owns session bootstrap (auth user -> tenant/profile/membership context),
// the disabled-account / bootstrap-error flags, and the login/logout/
// profile-complete handlers that mutate session state. The route table and
// guard wiring stay in App.js — this hook only knows about session data.
/** @typedef {import('../lib/types').Session} Session */
/** @typedef {import('../lib/types').UserRecord} UserRecord */
/** @typedef {import('@supabase/supabase-js').User} AuthUser */

export function useSession() {
  const [session, setSession] = useState(/** @type {Session|null} */ (null));
  const [sessionLoading, setSessionLoading] = useState(true);
  const [accountDisabled, setAccountDisabled] = useState(false);
  const [sessionError, setSessionError] = useState(false); // session bootstrap failed
  const [needsProfile, setNeedsProfile] = useState(false);
  const [authUser, setAuthUser] = useState(/** @type {AuthUser|null} */ (null)); // Auth user without a users table record

  const { loadMembershipStatus, refreshMembership } = useMembership(
    session,
    setSession,
  );

  useEffect(() => {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    const hasRecoveryToken =
      hash.includes("type=recovery") || search.includes("type=recovery");
    const hasRecoveryError =
      hash.includes("error_code=otp_expired") ||
      hash.includes("error=access_denied");

    // Backward-compatible handling for recovery links that land on '/'.
    // Also route recovery failures to the reset page so users get actionable guidance.
    if (
      (hasRecoveryToken || hasRecoveryError) &&
      window.location.pathname !== "/reset-password"
    ) {
      window.history.replaceState({}, "", `/reset-password${search}${hash}`);
    }
  }, []);

  useEffect(() => {
    const getSession = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
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

        if (tenant && !tenant.is_active && userRecord.role !== "super_admin") {
          await supabase.auth.signOut();
          setAccountDisabled(true);
          return;
        }

        setSession({ user, userRecord, tenantConfig, membership });
      } catch (err) {
        // Surface the failure instead of leaving the user on a blank screen.
        console.error("Failed to initialise session:", err);
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
  /** @param {{ user: AuthUser, userRecord: UserRecord }} args */
  async function handleProfileComplete({ user, userRecord }) {
    try {
      // Single round trip for tenant + settings + membership (issue #12). Fetch
      // before clearing needsProfile — otherwise the route guard sees
      // needsProfile=false + session=null and redirects to /login.
      const context = await fetchSessionContext();
      const resolvedRecord = context?.userRecord ?? userRecord;
      const tenantConfig = context?.tenantConfig ?? {
        type: undefined,
        name: undefined,
      };
      const membership =
        context?.membership ?? (await loadMembershipStatus(resolvedRecord));
      // Set session first, then clear needsProfile — both update in the same React batch
      setSession({
        user,
        userRecord: resolvedRecord,
        tenantConfig,
        membership,
      });
      setNeedsProfile(false);
      setAuthUser(null);
    } catch (err) {
      console.error("Failed to load session after profile completion:", err);
      Sentry.captureException(err);
      setSessionError(true);
    }
  }

  // Called by Login.js after successful auth. Check is_active before setting session.
  /** @param {{ user: AuthUser, userRecord: UserRecord }} args */
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
      if (
        context?.tenant &&
        !context.tenant.is_active &&
        resolvedRecord.role !== "super_admin"
      ) {
        supabase.auth.signOut();
        setAccountDisabled(true);
        return;
      }
      const tenantConfig = context?.tenantConfig ?? {
        type: undefined,
        name: undefined,
      };
      const membership =
        context?.membership ?? (await loadMembershipStatus(resolvedRecord));
      setSession({
        user,
        userRecord: resolvedRecord,
        tenantConfig,
        membership,
      });
    } catch (err) {
      console.error("Failed to load session after login:", err);
      Sentry.captureException(err);
      setSessionError(true);
    }
  }

  return {
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
  };
}
