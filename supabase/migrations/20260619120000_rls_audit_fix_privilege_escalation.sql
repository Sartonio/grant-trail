-- ============================================================================
-- WS7.1 RLS adversarial audit — isolation/escalation fixes
-- ============================================================================
-- The RLS audit (docs/roadmap/rls-audit.md) found three GENUINE gaps. All are
-- closed here in a single forward migration; no historical migration is edited.
--
-- GAP 1 (CRITICAL — vertical privilege escalation):
--   Policy "Users can update their own user record" on public.users has a USING
--   clause (auth.uid() = user_id) but NO WITH CHECK. Postgres then reuses USING
--   as the check, which only pins user_id — every other column, including role,
--   tenant_id and is_active, is freely writable by the row's owner. A grantee
--   could run `UPDATE users SET role='super_admin'` on their own row and, because
--   is_super_admin() is global (not tenant-scoped), gain full cross-tenant
--   read/write over EVERY tenant. They could likewise self-promote to 'admin' on
--   a managed tenant (enforce_self_service_role only blocks admin on self_service
--   tenants).
--
-- GAP 2 (CRITICAL — horizontal/tenant escalation):
--   The same missing WITH CHECK let a grantee change their own tenant_id, hopping
--   into any other tenant and inheriting that tenant's data via current_tenant_id().
--
-- GAP 3 (cross-tenant write / data poisoning):
--   set_grant_tenant_id() / set_tenant_from_grant() only derived tenant_id when
--   the client passed NULL. The grant INSERT policy checks ownership + membership
--   but never tenant_id, so a grantee could INSERT a grant carrying a *forged*
--   tenant_id belonging to another tenant. The attacker cannot read the row back
--   (SELECT policy is tenant-scoped), but it lands in the victim tenant's table
--   and fires that tenant's audit / notification triggers.
--
-- Fix strategy:
--   * GAPs 1 & 2: a BEFORE UPDATE trigger on users freezes the privilege-bearing
--     columns (role, tenant_id, is_active) for self-service updates. Admins,
--     super_admins and the service_role are unaffected, so the existing
--     "Admins can update users in their tenant" path and backend flows still work.
--   * GAP 3: derive tenant_id authoritatively from the owning user / parent grant
--     on every INSERT, overwriting any client-supplied value instead of trusting
--     a NULL. Legitimate callers already pass NULL, so behaviour is unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- GAPs 1 & 2 — freeze privilege columns on self-update of public.users
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."enforce_user_self_update_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Backend / privileged contexts may legitimately change these columns:
  --   * service_role  -> server-side provisioning, admin:promote, webhooks
  --   * is_admin()    -> tenant admin managing their own tenant's users
  --   * is_super_admin() -> platform root
  -- Everyone else (a user editing their OWN row through the self-update policy)
  -- must not be able to change the privilege-bearing columns.
  IF auth.role() = 'service_role' OR public.is_admin() OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

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

GRANT ALL ON FUNCTION "public"."enforce_user_self_update_guard"() TO "service_role";
GRANT ALL ON FUNCTION "public"."enforce_user_self_update_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_user_self_update_guard"() TO "authenticated";

-- Name is prefixed so it sorts/fires before the audit trigger (trg_audit_users)
-- and rejects the change before it is logged.
CREATE OR REPLACE TRIGGER "trg_aa_enforce_user_self_update_guard"
  BEFORE UPDATE ON "public"."users"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."enforce_user_self_update_guard"();

-- ---------------------------------------------------------------------------
-- GAP 3 — derive tenant_id authoritatively, never trust the client value
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."set_grant_tenant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Always derive from the owning user; ignore any client-supplied tenant_id so
  -- a caller cannot plant a grant inside another tenant.
  NEW.tenant_id := (SELECT tenant_id FROM users WHERE id = NEW.user_id);
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."set_grant_tenant_id"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."set_tenant_from_grant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Always derive from the parent grant; ignore any client-supplied tenant_id.
  NEW.tenant_id := (SELECT tenant_id FROM grant_record WHERE id = NEW.grant_id);
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."set_tenant_from_grant"() OWNER TO "postgres";
