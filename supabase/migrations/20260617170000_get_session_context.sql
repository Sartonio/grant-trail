-- Issue #12 — Login waterfall (Robustness)
--
-- Session initialisation previously issued a chain of sequential round trips per
-- login: auth.getUser(), then SELECTs against users, tenants, tenant_settings, and
-- a separate membership fetch (3 RPCs + 2 table reads). This collapses the
-- per-session database work into a single round trip: one RPC that returns the
-- user record, their tenant, tenant settings, and computed membership status.
--
-- SECURITY DEFINER, scoped strictly to the caller via auth.uid() (the same set of
-- rows RLS would already permit). Returns {"user": null} when the authenticated
-- auth user has no profile row yet, so the client can route to profile completion.

CREATE OR REPLACE FUNCTION "public"."get_session_context"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user        public.users%ROWTYPE;
  v_tenant      jsonb;
  v_settings    jsonb;
  v_membership  jsonb;
  v_subscription jsonb;
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

  SELECT to_jsonb(s) INTO v_subscription
  FROM public.subscriptions s
  WHERE s.user_id = v_user.id
    AND s.status IN ('active', 'trialing', 'past_due')
  ORDER BY s.updated_at DESC
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
      'activeSubscription', v_subscription
    )
  );
END;
$$;

ALTER FUNCTION "public"."get_session_context"() OWNER TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."get_session_context"() TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_session_context"() TO "service_role";
