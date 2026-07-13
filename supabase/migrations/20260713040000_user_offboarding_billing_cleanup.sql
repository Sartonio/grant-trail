-- ============================================================================
-- Offboarding + session polish for tenant-owned premium billing
--
-- Two follow-ups found hardening 20260713020000_tenant_owned_premium_billing:
--
-- ── 1. User offboarding violated chk_subscriptions_has_owner ────────────────
--   That migration changed subscriptions.user_id from ON DELETE CASCADE to
--   ON DELETE SET NULL so deleting the PAYER of an org (tenant-owned) sub no
--   longer destroys the org's subscription row. Correct for tenant-owned rows
--   (user_id nulls out, tenant_id keeps the CHECK satisfied) — but a USER-owned
--   row (basic: tenant_id IS NULL) now fails the at-least-one-owner CHECK when
--   the FK nulls user_id, so DELETE FROM users errors for any user holding a
--   basic subscription row (reproduced: deleting seed user maria).
--
--   FIX: BEFORE DELETE trigger on public.users removes the user's USER-owned
--   subscription rows (tenant_id IS NULL) — restoring the old CASCADE semantics
--   for exactly the rows that were previously CASCADE-deleted — and lets the
--   SET NULL FK handle tenant-owned rows. billing_customers (user FK CASCADE)
--   and user_memberships (CASCADE) are unchanged.
--
-- ── 2. get_session_context.activeSubscription was nondeterministic ──────────
--   The lookup matches the caller's OWN sub OR their tenant's sub ordered only
--   by updated_at, so which row surfaced depended on webhook timing (e.g. a
--   grantee with an active basic sub could be shown the org's premium sub).
--   FIX: prefer the caller's own subscription, then the tenant's; updated_at
--   stays as the tiebreak. Org-plan state is carried by tenantMembership, so
--   the personal row is the right default for the personal billing UX.
-- ============================================================================

-- ── 1. Offboarding: clean up user-owned subscription rows before user delete ─
CREATE OR REPLACE FUNCTION "public"."cleanup_user_owned_billing_on_user_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- User-owned (basic) subscription rows would violate the at-least-one-owner
  -- CHECK when the FK nulls user_id; delete them like the old CASCADE did.
  -- Tenant-owned rows (tenant_id IS NOT NULL) are intentionally left for the
  -- SET NULL FK: the org's subscription survives its initiator.
  DELETE FROM public.subscriptions
   WHERE user_id = OLD.id
     AND tenant_id IS NULL;

  RETURN OLD;
END;
$$;

ALTER FUNCTION "public"."cleanup_user_owned_billing_on_user_delete"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trg_cleanup_user_owned_billing"
  BEFORE DELETE ON "public"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_user_owned_billing_on_user_delete"();

GRANT ALL ON FUNCTION "public"."cleanup_user_owned_billing_on_user_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_user_owned_billing_on_user_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_user_owned_billing_on_user_delete"() TO "service_role";


-- ── 2. get_session_context: deterministic activeSubscription (own-first) ─────
-- Identical to the 20260713020000 version except the activeSubscription ORDER BY.
CREATE OR REPLACE FUNCTION "public"."get_session_context"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user             public.users%ROWTYPE;
  v_tenant           jsonb;
  v_settings         jsonb;
  v_membership       jsonb;
  v_tenant_membership jsonb;
  v_subscription     jsonb;
BEGIN
  SELECT * INTO v_user
  FROM public.users
  WHERE user_id = auth.uid()
  LIMIT 1;

  -- Authenticated, but no profile row yet → client shows profile completion.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('user', NULL);
  END IF;

  SELECT to_jsonb(t) INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_user.tenant_id;

  SELECT to_jsonb(ts) INTO v_settings
  FROM public.tenant_settings ts
  WHERE ts.tenant_id = v_user.tenant_id;

  -- Most recently updated active membership / live subscription (mirrors the
  -- prior client-side queries, but scoped server-side to this user).
  SELECT to_jsonb(m) INTO v_membership
  FROM public.user_memberships m
  WHERE m.user_id = v_user.id
    AND m.is_active = true
  ORDER BY m.updated_at DESC
  LIMIT 1;

  -- The caller's tenant-owned premium membership (org plan), if any.
  SELECT to_jsonb(tm) INTO v_tenant_membership
  FROM public.tenant_memberships tm
  WHERE tm.tenant_id = v_user.tenant_id
  LIMIT 1;

  -- Live subscription: prefer the caller's OWN sub, then their tenant's (the
  -- org-plan state itself is carried by tenantMembership above).
  SELECT to_jsonb(s) INTO v_subscription
  FROM public.subscriptions s
  WHERE (s.user_id = v_user.id OR s.tenant_id = v_user.tenant_id)
    AND s.status IN ('active', 'trialing', 'past_due')
  ORDER BY (s.user_id = v_user.id) DESC NULLS LAST, s.updated_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'user', to_jsonb(v_user),
    'tenant', v_tenant,
    'tenantSettings', v_settings,
    'membership', jsonb_build_object(
      'isExempt',          COALESCE(public.is_membership_exempt(v_user.id), false),
      'hasBasicAccess',    COALESCE(public.has_basic_membership(v_user.id), false),
      'hasPremiumAccess',  COALESCE(public.has_premium_membership(v_user.id), false),
      'membership',        v_membership,
      'tenantMembership',  v_tenant_membership,
      'activeSubscription', v_subscription
    )
  );
END;
$$;

ALTER FUNCTION "public"."get_session_context"() OWNER TO "postgres";
