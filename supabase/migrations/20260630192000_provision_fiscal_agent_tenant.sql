-- Account-first Fiscal Agent onboarding.
--
-- Background: charities used to become fiscal agents via a PAY-FIRST funnel —
-- anonymous checkout, then a Stripe webhook provisioned the tenant + admin user
-- + draft listing + invite, and emailed a one-time signup link. That asymmetry
-- (basic = account-first, charity = pay-first) is now removed: a charity signs
-- up exactly like a basic user (account + profile), and the LAST step of profile
-- completion is the premium "Fiscal Agents Plan" checkout.
--
-- This RPC is the fiscal-agent analogue of provision_self_service_tenant. It runs
-- in the authenticated CompleteProfile flow and atomically creates:
--   * a fresh tenant (the charity's own org)
--   * its admin user (the caller — linked to their auth.users uid)
--   * a draft fiscal_agent_listings row the owner finishes in the listing editor
--
-- Self-elevation is NOT a concern here: the admin role is scoped to a brand-new
-- tenant that has no other users, created in the same call — identical trust to
-- the prior webhook provisioning. The caller never supplies role or tenant_id.

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

  -- Seed a draft listing the owner finishes in the listing editor post-checkout.
  INSERT INTO fiscal_agent_listings (tenant_id, owner_user_id, name, email)
  VALUES (new_tenant_id, new_user_id, p_organization, lower(p_email));

  RETURN new_user_record;
END;
$$;

ALTER FUNCTION "public"."provision_fiscal_agent_tenant"(
  "uuid", "text", "text", "text", "text", "text"
) OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."provision_fiscal_agent_tenant"(
  "uuid", "text", "text", "text", "text", "text"
) TO "service_role";
GRANT ALL ON FUNCTION "public"."provision_fiscal_agent_tenant"(
  "uuid", "text", "text", "text", "text", "text"
) TO "authenticated";
