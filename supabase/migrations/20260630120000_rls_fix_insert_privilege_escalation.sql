-- ============================================================================
-- Security audit (docs/architecture-review/security.md) — INSERT-side escalation
-- ============================================================================
-- The prior RLS-audit migration (20260619120000) closed the UPDATE-side
-- privilege-escalation holes on public.users but left the INSERT path open, and
-- two vestigial `WITH CHECK (true)` policies remained. This forward migration
-- closes the three confirmed findings; no historical migration is edited and no
-- existing policy is weakened.
--
-- F1 (CRITICAL — self-INSERT privilege escalation):
--   Policy "Users can insert their own user record" pinned only `user_id` in its
--   WITH CHECK; `role`, `tenant_id`, `is_active` were attacker-chosen. Any authed
--   user could `INSERT INTO users (user_id=<self>, role='super_admin', ...)`. The
--   only INSERT trigger (enforce_self_service_role) blocked just admin-on-
--   self_service — never super_admin, never admin-on-managed. Because
--   is_super_admin() is global, that = full cross-tenant takeover.
--
--   Fix (mirrors the BEFORE UPDATE self-guard from 20260619120000):
--     * A BEFORE INSERT guard freezes the privilege-bearing columns. An ordinary
--       authenticated self-insert is rejected outright — every legitimate
--       self-insert now flows through a SECURITY DEFINER RPC that derives role +
--       tenant authoritatively (server-side), so a direct client insert has no
--       legitimate reason to exist.
--     * The two trusted RPCs (provision_self_service_tenant for self-service,
--       register_invited_user for invites) flag a transaction-local trusted
--       context that the guard honours. A PostgREST client cannot set that GUC
--       (it can only call RPCs / run table ops — never a raw SET), so the flag
--       is unforgeable from the outside.
--     * The self-insert policy WITH CHECK is tightened (defense-in-depth) to also
--       pin role='grantee' and is_active=true for the direct-client path.
--     * The client (CompleteProfile) stops sending a client-chosen `role`; the
--       invite's role is read from the validated invite row inside the RPC.
--
-- F2 (HIGH — invite tampering): "System can update invites" USING(true)
--   WITH CHECK(true) let any authed user rewrite ANY invite's role/email/used_at
--   cross-tenant. Consumption now goes through the consume_invite SECURITY
--   DEFINER RPC (20260619170000), which bypasses RLS — so this broad policy is
--   vestigial. Dropped. (Admins still create invites via the INSERT policy;
--   no client UPDATE path exists in the app.)
--
-- F3 (MEDIUM — notification / status-history forgery):
--   "System can insert notifications" / "System can insert status history"
--   WITH CHECK(true) let any authed user forge notifications (phishing links) or
--   status rows for any user_id. The real writers are SECURITY DEFINER triggers
--   (notify_*_status, log_grant_status_change) that bypass RLS, so no client
--   INSERT grant is needed. Both dropped; the triggers keep working unchanged.
--
-- NOT addressed here (flagged for human review in the PR): F4 storage IDOR,
-- F5 xlsx advisory, F6 CSP report-only, F7 notify-inquiry rate limit.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- F1 — freeze privilege columns on self-INSERT of public.users
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."enforce_user_self_insert_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Privileged / trusted contexts may set the privilege-bearing columns:
  --   * service_role         -> server-side provisioning, webhooks
  --   * is_admin()/super      -> tenant admin / platform root managing users
  --   * app.user_insert_trusted = '1' -> a SECURITY DEFINER signup RPC that has
  --       already derived role + tenant authoritatively from a trusted source
  --       (provision_self_service_tenant, register_invited_user). This GUC is
  --       transaction-local and cannot be set by a PostgREST client.
  --   * auth.uid() IS NULL    -> no authenticated end-user identity at all:
  --       seed.sql, migrations, raw psql, and backend code that does not
  --       impersonate a user. Every HOSTILE case is an authenticated client whose
  --       auth.uid() is its own (non-null) uid; anon (also null uid) has no INSERT
  --       privilege on public.users, so it can never reach this guard.
  IF auth.role() = 'service_role'
     OR auth.uid() IS NULL
     OR public.is_admin()
     OR public.is_super_admin()
     OR current_setting('app.user_insert_trusted', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- An ordinary authenticated user inserting their OWN row through the
  -- self-insert policy must never elevate. The only legitimate self-insert paths
  -- are the trusted RPCs above, so a direct client insert is rejected: this
  -- blocks role escalation (super_admin/admin) AND tenant hopping at once.
  RAISE EXCEPTION 'Direct self-insert into users is not permitted; sign up through the signup/invite flow';
END;
$$;

ALTER FUNCTION "public"."enforce_user_self_insert_guard"() OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."enforce_user_self_insert_guard"() TO "service_role";
GRANT ALL ON FUNCTION "public"."enforce_user_self_insert_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_user_self_insert_guard"() TO "authenticated";

-- Name prefixed "aa" so it fires before trg_audit_users / trg_enforce_self_service_role.
CREATE OR REPLACE TRIGGER "trg_aa_enforce_user_self_insert_guard"
  BEFORE INSERT ON "public"."users"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."enforce_user_self_insert_guard"();

-- Defense-in-depth at the policy layer: the direct-client self-insert path may
-- only ever create the lowest-privilege, active row for the caller's own uid.
-- (SECURITY DEFINER RPCs bypass RLS, so this does not constrain them.)
DROP POLICY IF EXISTS "Users can insert their own user record" ON "public"."users";
CREATE POLICY "Users can insert their own user record" ON "public"."users"
  FOR INSERT
  WITH CHECK (
    ("auth"."uid"() = "user_id")
    AND (("role")::text = 'grantee')
    AND ("is_active" = true)
  );

-- ---------------------------------------------------------------------------
-- F1 — derive the invite role/tenant server-side (DB authoritative)
-- ---------------------------------------------------------------------------
-- Replaces the client upsert in CompleteProfile that wrote `role: invite.role`
-- straight from the client. role + tenant_id come from the validated, unused
-- invite row; email comes from the verified auth identity. Consumption reuses
-- the existing consume_invite RPC. Idempotent re-submits update profile fields
-- only — never role/tenant.
CREATE OR REPLACE FUNCTION "public"."register_invited_user"(
    "p_token" "text",
    "p_firstname" "text",
    "p_lastname" "text",
    "p_organization" "text",
    "p_phone" "text",
    "p_tax_month" integer DEFAULT NULL::integer)
    RETURNS json
    LANGUAGE "plpgsql" VOLATILE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_invite invites%ROWTYPE;
  v_email text;
  v_user_record json;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authoritatively resolve the invite by its unguessable token; role + tenant
  -- are taken from THIS row, never from the client.
  SELECT * INTO v_invite
    FROM invites
   WHERE token = p_token::uuid
     AND used_at IS NULL
     AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid, expired, or already-used invite';
  END IF;

  -- Email is the verified auth identity, lowercased (matches users_email_key).
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  -- Trusted context: role/tenant on this row are server-derived, so the
  -- self-insert guard lets it through.
  PERFORM set_config('app.user_insert_trusted', '1', true);

  INSERT INTO users (tenant_id, email, user_id, firstname, lastname,
                     organization_name, phone_number, tax_month, role, is_active)
  VALUES (v_invite.tenant_id, v_email, v_uid, p_firstname, p_lastname,
          p_organization, p_phone, p_tax_month, v_invite.role, true)
  ON CONFLICT (email) DO UPDATE SET
       firstname         = EXCLUDED.firstname,
       lastname          = EXCLUDED.lastname,
       organization_name = EXCLUDED.organization_name,
       phone_number      = EXCLUDED.phone_number,
       tax_month         = EXCLUDED.tax_month
  RETURNING row_to_json(users.*) INTO v_user_record;

  -- Consume the invite via the existing token-scoped RPC (idempotent, unused-only).
  PERFORM public.consume_invite(p_token, v_uid);

  RETURN v_user_record;
END;
$$;

ALTER FUNCTION "public"."register_invited_user"("p_token" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."register_invited_user"("p_token" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."register_invited_user"("p_token" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."register_invited_user"("p_token" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) TO "service_role";

-- ---------------------------------------------------------------------------
-- F1 — flag the self-service provisioning RPC as a trusted insert context
-- ---------------------------------------------------------------------------
-- Re-create provision_self_service_tenant verbatim plus one line: it inserts the
-- first user into a freshly-created tenant (role forced 'grantee'), so it must
-- be exempt from the self-insert guard.
CREATE OR REPLACE FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer DEFAULT NULL::integer) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  new_tenant_id INT;
  new_user_record JSON;
  tenant_slug TEXT;
BEGIN
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
  VALUES (new_tenant_id, lower(p_email), p_auth_uid, p_firstname, p_lastname, p_organization, p_phone, p_tax_month, 'grantee')
  RETURNING row_to_json(users.*) INTO new_user_record;

  RETURN new_user_record;
END;
$$;

-- ---------------------------------------------------------------------------
-- F2 — drop the vestigial broad invite-UPDATE policy
-- ---------------------------------------------------------------------------
-- Consumption goes through consume_invite (SECURITY DEFINER, bypasses RLS); the
-- app has no client-side invite UPDATE path. Removing this closes invite
-- tampering / cross-tenant role flipping. Admin INSERT + admin/super SELECT
-- policies are untouched.
DROP POLICY IF EXISTS "System can update invites" ON "public"."invites";

-- ---------------------------------------------------------------------------
-- F3 — drop the forgeable notification / status-history INSERT policies
-- ---------------------------------------------------------------------------
-- The legitimate writers are SECURITY DEFINER triggers that bypass RLS, so no
-- client INSERT grant is needed. Dropping these prevents an authed user from
-- forging notifications (phishing) or planting status-history rows. Client
-- SELECT / "update/delete own notifications" policies are untouched.
DROP POLICY IF EXISTS "System can insert notifications" ON "public"."notifications";
DROP POLICY IF EXISTS "System can insert status history" ON "public"."grant_status_history";
