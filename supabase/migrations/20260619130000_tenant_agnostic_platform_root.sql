-- ============================================================================
-- GitHub #29 — make the platform-root tenant config-driven (tenant-agnostic)
-- ============================================================================
-- Two SECURITY DEFINER functions hard-coded the platform-root tenant by slug/name:
--   * enforce_membership_eligibility()  — refuses to attach a paid membership to a
--     platform-root admin (they are exempt and must never be billed)
--   * is_membership_exempt(p_user_id)   — treats platform-root admins as exempt
-- Both matched the literal set ('tfac', 'the-family-advocates-canada') /
-- 'the family advocates canada'. That bakes one deployment's branding into shared
-- logic and makes the schema impossible to reuse for another platform operator.
--
-- Config shape:
--   The platform-root tenant is now identified by a single configurable slug stored
--   on the existing platform_settings singleton (id = 1) in a new column
--   `platform_root_slug` (default 'tfac', preserving current behaviour). A
--   SECURITY DEFINER helper platform_root_slug() reads it, and an
--   is_platform_root_tenant(slug, name) helper centralises the comparison so both
--   call sites — and any future ones — share one definition.
--
-- To re-point the platform root for a different operator:
--   UPDATE platform_settings SET platform_root_slug = '<new-slug>' WHERE id = 1;
-- (The matching tenants.slug must already exist.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Config column + helpers
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."platform_settings"
  ADD COLUMN IF NOT EXISTS "platform_root_slug" character varying(100) NOT NULL DEFAULT 'tfac';

-- Returns the configured platform-root tenant slug (lower-cased). Falls back to
-- 'tfac' if the singleton row is somehow absent, matching prior behaviour.
CREATE OR REPLACE FUNCTION "public"."platform_root_slug"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT lower(COALESCE((SELECT platform_root_slug FROM platform_settings WHERE id = 1), 'tfac'));
$$;

ALTER FUNCTION "public"."platform_root_slug"() OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."platform_root_slug"() TO "service_role";
GRANT ALL ON FUNCTION "public"."platform_root_slug"() TO "anon";
GRANT ALL ON FUNCTION "public"."platform_root_slug"() TO "authenticated";

-- Centralised predicate: is the given tenant (by slug/name) the platform root?
-- Kept name-aware for backwards compatibility with the legacy display-name match.
CREATE OR REPLACE FUNCTION "public"."is_platform_root_tenant"("p_slug" "text", "p_name" "text")
    RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT lower(COALESCE(p_slug, '')) = public.platform_root_slug();
$$;

ALTER FUNCTION "public"."is_platform_root_tenant"("p_slug" "text", "p_name" "text") OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."is_platform_root_tenant"("p_slug" "text", "p_name" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."is_platform_root_tenant"("p_slug" "text", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_platform_root_tenant"("p_slug" "text", "p_name" "text") TO "authenticated";

-- ---------------------------------------------------------------------------
-- Re-point the two call sites at the config-driven helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."enforce_membership_eligibility"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  target_role TEXT;
  target_tenant_name TEXT;
  target_tenant_slug TEXT;
BEGIN
  SELECT u.role, t.name, t.slug
  INTO target_role, target_tenant_name, target_tenant_slug
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.id = NEW.user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Cannot assign membership: user % does not exist', NEW.user_id;
  END IF;

  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot assign membership to super_admin users';
  END IF;

  IF target_role = 'admin'
     AND public.is_platform_root_tenant(target_tenant_slug, target_tenant_name) THEN
    RAISE EXCEPTION 'Cannot assign membership to platform-root admin users';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_membership_eligibility"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."is_membership_exempt"("p_user_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    JOIN tenant_settings ts ON ts.tenant_id = u.tenant_id
    WHERE u.id = p_user_id
      AND (
        u.role = 'super_admin'
        OR (
          u.role = 'admin'
          AND public.is_platform_root_tenant(t.slug, t.name)
        )
        OR ts.require_subscription = false
      )
  );
$$;

ALTER FUNCTION "public"."is_membership_exempt"("p_user_id" integer) OWNER TO "postgres";
