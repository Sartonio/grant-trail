-- ============================================================================
-- Harden the signup system: provisioning RPCs bind to the caller's verified
-- auth identity; drop a dead self-INSERT policy; expiry check in consume_invite
--
-- Security-audit follow-ups (adversarial proofs added to
-- supabase/tests/rls-adversarial.test.sh in the same change):
--
-- ── B1 (critical): provisioning RPCs trusted client-supplied identity ───────
--   provision_self_service_tenant and provision_fiscal_agent_tenant are
--   SECURITY DEFINER and previously trusted p_auth_uid / p_email verbatim. An
--   authenticated attacker could provision a tenant AGAINST ANY auth uid (or a
--   fabricated one) with an arbitrary email, and — worse —
--   provision_self_service_tenant was EXECUTE-granted to anon, so an
--   unauthenticated client could mint tenants + users rows at will.
--
--   Fix (signatures UNCHANGED — frontend/src/components/auth/CompleteProfile.js
--   calls both with p_auth_uid/p_email and must keep working):
--     * refuse callers with no identity: auth.uid() IS NULL -> 'Not authenticated';
--     * refuse impersonation: p_auth_uid IS DISTINCT FROM auth.uid() -> error;
--     * refuse duplicate provisioning: a caller who already has a public.users
--       row cannot create a second tenant/users row;
--     * ignore p_email for trust purposes: the stored email is derived
--       authoritatively as lower(email) from auth.users for auth.uid()
--       (mirrors register_invited_user; auth is already on the search_path);
--     * service_role EXCEPTION: backend/webhook/seed provisioning runs with NO
--       end-user JWT (auth.uid() IS NULL, auth.role() = 'service_role') and
--       must keep working — that branch bypasses the three checks and trusts
--       p_auth_uid/p_email as given, exactly the pre-existing behavior. This is
--       safe because service_role is server-side only (never shipped to a
--       browser) and already bypasses RLS everywhere else.
--   Grants: EXECUTE on provision_self_service_tenant is REVOKED from anon —
--   both RPCs are now authenticated + service_role only. (A brand-new signup
--   HAS a session before completing their profile, so anon never needs it.)
--   Everything else — slug generation, tenant_settings defaults, the
--   transaction-local app.user_insert_trusted GUC, forced roles ('grantee' /
--   'admin'), the draft fiscal_agent_listings row, json return shape — is
--   preserved byte-for-byte from the current definitions
--   (20260630130000_squashed_schema.sql for the self-service RPC;
--   20260701091000_tenant_owns_fiscal_agent_listings.sql for the fiscal-agent
--   RPC, which is the latest body, re-created there against managed_by_user_id).
--
-- ── B3: dead policy "Users can insert their own user record" ────────────────
--   The policy passed rows with (auth.uid() = user_id AND role = 'grantee' AND
--   is_active), but trg_aa_enforce_user_self_insert_guard rejects EVERY direct
--   self-insert before the policy is even evaluated, and the only legitimate
--   insert paths are the SECURITY DEFINER RPCs, which run as the table owner
--   and bypass RLS. The policy therefore authorizes nothing — it is dead code
--   that misleads audits into thinking clients may self-insert. DROP it; no
--   INSERT policy remains on public.users for authenticated, which is the
--   intended deny-by-default (service-role/definer paths are unaffected).
--   Verified: no test depended on the policy existing; the adversarial suite
--   asserts the guard still rejects a policy-shaped row after the drop.
--
-- ── B4: consume_invite ignored expires_at ───────────────────────────────────
--   The UPDATE consumed any invite with used_at IS NULL, even one past its
--   expires_at. register_invited_user pre-checks expiry, but consume_invite is
--   independently EXECUTE-granted to authenticated — defense in depth demands
--   the expiry check live in the consuming statement itself. Add
--   `AND expires_at > now()` so an expired invite is never stamped used.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B4: consume_invite — refuse expired invites
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."consume_invite"("p_token" "text", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  -- A caller may only consume an invite on their OWN behalf.
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed to consume an invite on behalf of another user';
  END IF;

  -- Hard-scoped by the unguessable token; only an unused, UNEXPIRED invite is
  -- consumed (B4: expiry enforced here, not just in register_invited_user).
  UPDATE public.invites
     SET used_by = p_user_id,
         used_at = now()
   WHERE token = p_token::uuid
     AND used_at IS NULL
     AND expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- ----------------------------------------------------------------------------
-- B1: provision_self_service_tenant — bind to the caller's auth identity
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer DEFAULT NULL::integer) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  new_tenant_id INT;
  new_user_record JSON;
  tenant_slug TEXT;
  v_email TEXT;
BEGIN
  IF auth.role() = 'service_role' THEN
    -- Backend provisioning (webhooks/seed): no end-user JWT, args are trusted.
    v_email := lower(p_email);
  ELSE
    -- End-user path: the SECURITY DEFINER boundary trusts ONLY the JWT.
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF p_auth_uid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Not allowed to provision a tenant on behalf of another user';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Caller already has a user record; duplicate tenant provisioning is not permitted';
    END IF;
    -- Email is the verified auth identity, lowercased (p_email is untrusted).
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;

  -- Generate slug from organization name
  tenant_slug := lower(regexp_replace(p_organization, '[^a-z0-9]+', '-', 'gi'));
  tenant_slug := trim(both '-' from tenant_slug);

  -- Ensure slug uniqueness by appending a random suffix if needed
  IF EXISTS (SELECT 1 FROM tenants WHERE slug = tenant_slug) THEN
    tenant_slug := tenant_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  -- Create tenant
  INSERT INTO tenants (name, slug, tenant_type)
  VALUES (p_organization, tenant_slug, 'self_service')
  RETURNING id INTO new_tenant_id;

  -- Create tenant settings with all approvals off
  INSERT INTO tenant_settings (tenant_id, require_grant_approval, require_budget_approval, require_expense_approval)
  VALUES (new_tenant_id, false, false, false);

  -- Trusted context: role is forced 'grantee' and tenant is the one just created,
  -- so this self-insert is exempt from the self-insert guard.
  PERFORM set_config('app.user_insert_trusted', '1', true);

  -- Create user record
  INSERT INTO users (tenant_id, email, user_id, firstname, lastname, organization_name, phone_number, tax_month, role)
  VALUES (new_tenant_id, v_email, p_auth_uid, p_firstname, p_lastname, p_organization, p_phone, p_tax_month, 'grantee')
  RETURNING row_to_json(users.*) INTO new_user_record;

  RETURN new_user_record;
END;
$$;

-- ----------------------------------------------------------------------------
-- B1: provision_fiscal_agent_tenant — same identity binding
--     (body base: 20260701091000_tenant_owns_fiscal_agent_listings.sql)
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
  v_email TEXT;
BEGIN
  IF auth.role() = 'service_role' THEN
    -- Backend provisioning (webhooks/seed): no end-user JWT, args are trusted.
    v_email := lower(p_email);
  ELSE
    -- End-user path: the SECURITY DEFINER boundary trusts ONLY the JWT.
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF p_auth_uid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Not allowed to provision a tenant on behalf of another user';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Caller already has a user record; duplicate tenant provisioning is not permitted';
    END IF;
    -- Email is the verified auth identity, lowercased (p_email is untrusted).
    SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  END IF;

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
  VALUES (new_tenant_id, v_email, p_auth_uid, p_firstname, p_lastname, p_organization, p_phone, 'admin')
  RETURNING id, row_to_json(users.*) INTO new_user_id, new_user_record;

  -- Seed a draft listing. The TENANT owns it; the creator is only the default
  -- managed_by contact for inquiry-notification fallback.
  INSERT INTO fiscal_agent_listings (tenant_id, managed_by_user_id, name, email)
  VALUES (new_tenant_id, new_user_id, p_organization, v_email);

  RETURN new_user_record;
END;
$$;

-- ----------------------------------------------------------------------------
-- B1: grants — no anon execution of either provisioning RPC
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) FROM PUBLIC, "anon";
GRANT ALL ON FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."provision_fiscal_agent_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text") FROM PUBLIC, "anon";
GRANT ALL ON FUNCTION "public"."provision_fiscal_agent_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."provision_fiscal_agent_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text") TO "service_role";

-- ----------------------------------------------------------------------------
-- B3: drop the dead (and misleading) self-INSERT policy on public.users.
-- Deny-by-default is the INTENDED state: the guard trigger rejects every direct
-- self-insert anyway, and legitimate signups flow through the SECURITY DEFINER
-- RPCs above (which bypass RLS as the definer). No policy is loosened by this —
-- a policy that could never authorize a row is removed.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert their own user record" ON "public"."users";
