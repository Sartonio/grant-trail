-- ============================================================================
-- Freeze privileged self-writes: role escalation + tenant billing waiver
--
-- Two verified security-review findings (9/10 each) that sit on the exact
-- surfaces the tenant-owned-premium redesign re-keys. Adversarial proofs added
-- to supabase/tests/rls-adversarial.test.sh in the same change.
--
-- ── Vuln 1 (role escalation): enforce_user_self_update_guard early-returns ──
--   The BEFORE UPDATE guard on public.users early-returns (RETURN NEW,
--   unrestricted) for service_role OR is_admin() OR is_super_admin(). That
--   lumps a plain tenant admin in with super_admin: a tenant admin can PATCH a
--   same-tenant user (or self) all the way up to role='super_admin', because
--   the "Admins can update users in their tenant" RLS policy authorizes the row
--   and the guard then waves the role change through. is_admin() is scoped to
--   the caller's own tenant, so this is not cross-tenant — but it is a vertical
--   escalation from admin to super_admin (the tenant-agnostic platform role).
--
--   FIX: keep service_role and is_super_admin() unrestricted (they legitimately
--   assign any role — server provisioning, admin:promote, platform root). For a
--   NON-super is_admin() caller, allow in-tenant user updates EXCEPT assigning a
--   role outside {'grantee','admin'}: only a super admin may grant 'super_admin'
--   (or any future privileged role). Everyone else (a user editing their OWN
--   row through the self-update policy) keeps the pre-existing freezes
--   byte-for-byte: self role change, tenant hop, and is_active are all still
--   rejected with the same messages the tests assert on.
--
-- ── Vuln 2 (billing-gate bypass): tenant_settings.require_subscription flip ──
--   require_subscription is the tenant-wide subscription waiver read by
--   is_membership_exempt (clause `ts.require_subscription = false`). The
--   "Admins can update their tenant settings" RLS policy lets a tenant admin
--   UPDATE their own tenant_settings row — including flipping
--   require_subscription to false — which silently exempts the whole tenant
--   from the paywall. That waiver is a staff/platform control, not a
--   self-serve toggle.
--
--   FIX: a BEFORE UPDATE trigger on tenant_settings rejects any change to
--   require_subscription unless the writer is service_role OR is_super_admin().
--   Tenant admins keep updating every OTHER settings column
--   (require_grant_approval / require_budget_approval / require_expense_approval
--   / support_email / support_phone) unchanged. We do NOT touch the RLS policy
--   (never weaken an existing policy) — this is an additive column-level freeze,
--   mirroring the enforce_user_self_update_guard pattern.
--
-- ── Vuln 3 (billing-gate bypass, found in this branch's audit): premium mint ──
--   The "Admins can manage memberships in their tenant" policy on
--   user_memberships is FOR ALL with a matching WITH CHECK, so a tenant admin
--   can INSERT (or UPDATE a basic row into) membership_tier='premium' for any
--   same-tenant user — including themselves. is_membership_exempt's premium
--   clause then exempts the whole tenant: a self-serve, no-Stripe paywall
--   bypass, same class as Vuln 2. Legitimate premium writers are only the
--   Stripe sync (service_role) and platform staff (super_admin); no frontend
--   code path lets a tenant admin write premium (setUserMembership has no
--   callers), so freezing it breaks nothing.
--
--   FIX: BEFORE INSERT OR UPDATE trigger on user_memberships rejects
--   membership_tier='premium' unless service_role / super_admin / a direct DB
--   connection (auth.role() IS NULL — seeds and test fixtures run as postgres
--   with no JWT; PostgREST clients ALWAYS carry anon/authenticated/
--   service_role, so NULL is never reachable from the API surface). Tenant
--   admins keep managing 'basic'/manual memberships unchanged.
--
-- Both guard functions pin search_path per the 20260706044339 conventions.
-- is_super_admin() is a SECURITY DEFINER helper that reads public.users, so the
-- waiver guard is SECURITY DEFINER too (matching how the users self-update guard
-- is defined) so the helper resolves regardless of the writer's grants.
-- ============================================================================

-- ── Vuln 1 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."enforce_user_self_update_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Fully-trusted contexts may change any privilege-bearing column:
  --   * service_role     -> server-side provisioning, admin:promote, webhooks
  --   * is_super_admin() -> platform root (tenant-agnostic)
  IF auth.role() = 'service_role' OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- A NON-super tenant admin may manage their own tenant's users (the RLS
  -- policy already scopes WHICH rows), but may NOT mint a privileged role: only
  -- a super admin / service_role may assign anything other than grantee/admin.
  IF public.is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       AND NEW.role NOT IN ('grantee', 'admin') THEN
      RAISE EXCEPTION 'Only a super admin can assign the % role', NEW.role;
    END IF;
    RETURN NEW;
  END IF;

  -- Everyone else: a user editing their OWN row through the self-update policy.
  -- The privilege-bearing columns stay frozen (unchanged from the baseline).
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Not allowed to change your own role';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Not allowed to change your own tenant';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Not allowed to change your own active status';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_user_self_update_guard"() OWNER TO "postgres";


-- ── Vuln 2 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."enforce_tenant_settings_waiver_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- require_subscription is the tenant-wide paywall waiver. Only the platform
  -- (super_admin) or the backend (service_role) may change it; a tenant admin
  -- must not be able to exempt their own org from billing.
  IF NEW.require_subscription IS DISTINCT FROM OLD.require_subscription
     AND NOT (auth.role() = 'service_role' OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only a super admin can change require_subscription';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_tenant_settings_waiver_guard"() OWNER TO "postgres";

-- Name sorts after the existing tenant_settings triggers (there are none of the
-- trg_* shape on this table today; this establishes the convention).
CREATE OR REPLACE TRIGGER "trg_enforce_tenant_settings_waiver_guard"
  BEFORE UPDATE ON "public"."tenant_settings"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_tenant_settings_waiver_guard"();

GRANT ALL ON FUNCTION "public"."enforce_tenant_settings_waiver_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_tenant_settings_waiver_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_tenant_settings_waiver_guard"() TO "service_role";


-- ── Vuln 3 ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."enforce_premium_membership_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- 'premium' user memberships feed is_membership_exempt's tenant-wide premium
  -- clause. Only the billing backend (service_role), platform staff
  -- (super_admin), or a direct DB connection (seeds/fixtures: no JWT, so
  -- auth.role() IS NULL — unreachable via PostgREST) may write them. A tenant
  -- admin minting premium would self-exempt the org from the paywall.
  IF NEW.membership_tier = 'premium'
     AND NOT (
       auth.role() = 'service_role'
       OR auth.role() IS NULL
       OR public.is_super_admin()
     ) THEN
    RAISE EXCEPTION 'Only a super admin or the billing backend can assign premium memberships';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_premium_membership_guard"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trg_enforce_premium_membership_guard"
  BEFORE INSERT OR UPDATE ON "public"."user_memberships"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_premium_membership_guard"();

GRANT ALL ON FUNCTION "public"."enforce_premium_membership_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_premium_membership_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_premium_membership_guard"() TO "service_role";
