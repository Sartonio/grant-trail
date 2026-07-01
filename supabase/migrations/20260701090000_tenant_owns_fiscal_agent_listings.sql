-- Tenant is the sole ownership authority for Fiscal Agent / Charity Directory
-- listings.
--
-- Before: fiscal_agent_listings anchored ownership to an individual user via
-- owner_user_id (FK -> users, ON DELETE SET NULL). That orphaned listings when
-- the owning user was deleted, mismatched org-vs-individual identity, and let
-- "my listing" diverge from "my tenant's listing".
--
-- After:
--   * owner_user_id is DEMOTED to managed_by_user_id — a nullable display /
--     contact fallback only (notify-inquiry uses it to find a recipient email).
--     It carries no ownership semantics and appears in no RLS policy.
--   * RLS manage rights key on tenant-admin membership: ANY active admin of the
--     listing's tenant (is_admin() + current_tenant_id(), the same helpers used
--     across the schema) can insert/update the listing and view/triage its
--     inquiries. The premium billing gate on writes is unchanged, as is the
--     super_admin moderation path and tenant isolation (tenant_id checks stay).
--   * sponsorship_inquiries policies use the denormalised, trigger-enforced
--     tenant_id instead of joining through owner_user_id.

-- ----------------------------------------------------------------------------
-- 1. Demote the column
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."fiscal_agent_listings"
  RENAME COLUMN "owner_user_id" TO "managed_by_user_id";
ALTER TABLE "public"."fiscal_agent_listings"
  RENAME CONSTRAINT "fiscal_agent_listings_owner_user_id_fkey" TO "fiscal_agent_listings_managed_by_user_id_fkey";

-- Ownership lookups by user are gone; the column is only read via the listing
-- row itself (contact fallback), so the index has no remaining consumer.
DROP INDEX IF EXISTS "public"."idx_fiscal_agent_listings_owner_user_id";

-- ----------------------------------------------------------------------------
-- 2. fiscal_agent_listings policies: owner-user -> tenant-admin
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners can insert their listing" ON "public"."fiscal_agent_listings";
CREATE POLICY "Tenant admins can insert their listing" ON "public"."fiscal_agent_listings"
  FOR INSERT WITH CHECK (
    ( SELECT "public"."has_premium_membership"() )
    AND ( SELECT "public"."is_admin"() )
    AND ("tenant_id" = ( SELECT "public"."current_tenant_id"() ))
  );

DROP POLICY IF EXISTS "Owners can update their listing" ON "public"."fiscal_agent_listings";
CREATE POLICY "Tenant admins can update their listing" ON "public"."fiscal_agent_listings"
  FOR UPDATE USING (
    ( SELECT "public"."has_premium_membership"() )
    AND ( SELECT "public"."is_admin"() )
    AND ("tenant_id" = ( SELECT "public"."current_tenant_id"() ))
  ) WITH CHECK (
    ( SELECT "public"."has_premium_membership"() )
    AND ( SELECT "public"."is_admin"() )
    AND ("tenant_id" = ( SELECT "public"."current_tenant_id"() ))
  );

-- SELECT: the "see my own listing even while lapsed" carve-out becomes
-- tenant-admin scoped instead of owner-user scoped.
DROP POLICY IF EXISTS "View full listings with basic access" ON "public"."fiscal_agent_listings";
CREATE POLICY "View full listings with basic access" ON "public"."fiscal_agent_listings"
  FOR SELECT USING (
    (( SELECT "public"."is_admin"() ) AND ("tenant_id" = ( SELECT "public"."current_tenant_id"() )))
    OR ( SELECT "public"."has_basic_membership"() )
    OR ( SELECT "public"."is_super_admin"() )
  );

-- ----------------------------------------------------------------------------
-- 3. sponsorship_inquiries policies: owner-user join -> denormalised tenant_id
--    (set_inquiry_tenant_id force-fills tenant_id from the listing, so it is
--    trustworthy — see the 3e-FIXED test in charity-directory-rls.test.sh)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners can view their inquiries" ON "public"."sponsorship_inquiries";
CREATE POLICY "Tenant admins can view their inquiries" ON "public"."sponsorship_inquiries"
  FOR SELECT USING (
    (( SELECT "public"."is_admin"() ) AND ("tenant_id" = ( SELECT "public"."current_tenant_id"() )))
    OR ( SELECT "public"."is_super_admin"() )
  );

DROP POLICY IF EXISTS "Owners can triage their inquiries" ON "public"."sponsorship_inquiries";
CREATE POLICY "Tenant admins can triage their inquiries" ON "public"."sponsorship_inquiries"
  FOR UPDATE USING (
    ( SELECT "public"."has_premium_membership"() )
    AND ( SELECT "public"."is_admin"() )
    AND ("tenant_id" = ( SELECT "public"."current_tenant_id"() ))
  ) WITH CHECK (
    ( SELECT "public"."has_premium_membership"() )
    AND ( SELECT "public"."is_admin"() )
    AND ("tenant_id" = ( SELECT "public"."current_tenant_id"() ))
  );

-- ----------------------------------------------------------------------------
-- 4. provision_fiscal_agent_tenant: re-create against the renamed column.
--    Body identical to 20260630192000 except the listing INSERT now records the
--    creator only as the managed_by contact, not as an owner.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."provision_fiscal_agent_tenant"(
  "p_auth_uid" "uuid",
  "p_email" "text",
  "p_firstname" "text",
  "p_lastname" "text",
  "p_organization" "text",
  "p_phone" "text"
) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  new_tenant_id INT;
  new_user_id INT;
  new_user_record JSON;
  tenant_slug TEXT;
BEGIN
  -- Generate slug from organization name
  tenant_slug := lower(regexp_replace(p_organization, '[^a-z0-9]+', '-', 'gi'));
  tenant_slug := trim(both '-' from tenant_slug);

  -- Ensure slug uniqueness by appending a random suffix if needed
  IF tenant_slug = '' THEN
    tenant_slug := 'charity';
  END IF;
  IF EXISTS (SELECT 1 FROM tenants WHERE slug = tenant_slug) THEN
    tenant_slug := tenant_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  -- Create the charity's tenant (managed, matching prior fiscal-agent tenants)
  INSERT INTO tenants (name, slug, tenant_type)
  VALUES (p_organization, tenant_slug, 'managed')
  RETURNING id INTO new_tenant_id;

  INSERT INTO tenant_settings (tenant_id)
  VALUES (new_tenant_id);

  -- Trusted context: role is forced 'admin' on the just-created tenant, so this
  -- self-insert is exempt from the self-insert guard (same as the grantee path).
  PERFORM set_config('app.user_insert_trusted', '1', true);

  INSERT INTO users (tenant_id, email, user_id, firstname, lastname, organization_name, phone_number, role)
  VALUES (new_tenant_id, lower(p_email), p_auth_uid, p_firstname, p_lastname, p_organization, p_phone, 'admin')
  RETURNING id, row_to_json(users.*) INTO new_user_id, new_user_record;

  -- Seed a draft listing. The TENANT owns it; the creator is only the default
  -- managed_by contact for inquiry-notification fallback.
  INSERT INTO fiscal_agent_listings (tenant_id, managed_by_user_id, name, email)
  VALUES (new_tenant_id, new_user_id, p_organization, lower(p_email));

  RETURN new_user_record;
END;
$$;
