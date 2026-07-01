-- Close the fiscal-sponsorship loop: accepting a directory inquiry onboards the
-- seeker as a grantee of the sponsoring (listing's) tenant and files a pending
-- grant_record there, feeding the existing intra-tenant review workflow.
--
-- Design:
--   * `sponsorship_inquiries.grant_id` links an accepted inquiry to the
--     grant_record it produced (idempotency anchor + frontend "view grant" link).
--   * `accept_sponsorship_inquiry(p_inquiry_id)` is a SECURITY DEFINER RPC so the
--     cross-tenant write (the seeker is not yet a member of the sponsor tenant)
--     happens atomically server-side. Explicit checks:
--       - caller must be an active admin of the inquiry's (= listing's) tenant,
--         or a super_admin — checked against tenant membership in `users`, NOT
--         the listing's owner_user_id (listing ownership is being re-anchored).
--       - inquiry must not be declined.
--       - idempotent: a second accept returns the existing grant_id.
--   * "Membership" in GrantTrail is the seeker's single `users` row (email is
--     globally unique; session context resolves one row per auth uid), so
--     onboarding re-homes that row into the sponsor tenant as role 'grantee' —
--     the same shape register_invited_user/provision_self_service_tenant create.
--     Seekers whose users row is an admin of another org are refused (manual
--     onboarding), so we never silently strip someone's admin role.
--   * The grant's tenant_id is derived by the existing trg_set_grant_tenant_id
--     trigger from the (just moved) seeker's users row.

ALTER TABLE "public"."sponsorship_inquiries"
  ADD COLUMN IF NOT EXISTS "grant_id" integer REFERENCES "public"."grant_record"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."sponsorship_inquiries"."grant_id" IS
  'grant_record created when this inquiry was accepted (see accept_sponsorship_inquiry).';

CREATE OR REPLACE FUNCTION "public"."accept_sponsorship_inquiry"("p_inquiry_id" integer) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_inquiry sponsorship_inquiries%ROWTYPE;
  v_seeker  users%ROWTYPE;
  v_grant_id INT;
BEGIN
  -- Lock the inquiry row so concurrent double-accepts serialize.
  SELECT * INTO v_inquiry
  FROM sponsorship_inquiries
  WHERE id = p_inquiry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inquiry not found';
  END IF;

  -- Caller must be an active admin member of the inquiry's tenant (or super
  -- admin). Tenant membership, deliberately not listing.owner_user_id.
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = auth.uid()
      AND is_active = true
      AND (role = 'super_admin' OR (role = 'admin' AND tenant_id = v_inquiry.tenant_id))
  ) THEN
    RAISE EXCEPTION 'Only an admin of the sponsoring tenant can accept this inquiry'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotent double-accept: return the grant we already created.
  IF v_inquiry.status = 'accepted' AND v_inquiry.grant_id IS NOT NULL THEN
    RETURN json_build_object(
      'grant_id', v_inquiry.grant_id,
      'tenant_id', v_inquiry.tenant_id,
      'already_accepted', true
    );
  END IF;

  IF v_inquiry.status = 'declined' THEN
    RAISE EXCEPTION 'Cannot accept a declined inquiry';
  END IF;

  IF v_inquiry.created_by IS NULL THEN
    RAISE EXCEPTION 'Inquiry has no linked seeker account; onboard manually';
  END IF;

  SELECT * INTO v_seeker FROM users WHERE id = v_inquiry.created_by;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seeker account no longer exists; onboard manually';
  END IF;

  -- Onboard: re-home the seeker's users row into the sponsor tenant as a
  -- grantee (skip when they already belong to it). Refuse to demote an admin
  -- of another org — that needs a human decision.
  IF v_seeker.tenant_id <> v_inquiry.tenant_id THEN
    IF v_seeker.role <> 'grantee' THEN
      RAISE EXCEPTION 'Seeker administers another organization; onboard manually';
    END IF;
    UPDATE users
    SET tenant_id = v_inquiry.tenant_id
    WHERE id = v_seeker.id;
  END IF;

  -- File the grant in the sponsor tenant, entering the normal pending ->
  -- approved/needs_changes/rejected review pipeline. tenant_id is derived by
  -- trg_set_grant_tenant_id from the seeker's (now sponsor-tenant) users row.
  -- ponytail: estAnnualBudget is free text ("$85,000"), so grant_amount stays 0
  -- for the admin to set during review.
  INSERT INTO grant_record (user_id, grant_name, description, status, submitted_at)
  VALUES (
    v_seeker.id,
    left(coalesce(nullif(v_inquiry.project->>'name', ''), 'Sponsored project'), 100),
    concat_ws(E'\n\n',
      nullif(v_inquiry.project->>'mission', ''),
      nullif('Est. annual budget: ' || nullif(v_inquiry.project->>'estAnnualBudget', ''), 'Est. annual budget: '),
      nullif(v_inquiry.message, '')
    ),
    'pending',
    now()
  )
  RETURNING id INTO v_grant_id;

  UPDATE sponsorship_inquiries
  SET status = 'accepted', grant_id = v_grant_id
  WHERE id = p_inquiry_id;

  RETURN json_build_object(
    'grant_id', v_grant_id,
    'tenant_id', v_inquiry.tenant_id,
    'already_accepted', false
  );
END;
$$;

ALTER FUNCTION "public"."accept_sponsorship_inquiry"(integer) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."accept_sponsorship_inquiry"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."accept_sponsorship_inquiry"(integer) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."accept_sponsorship_inquiry"(integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."accept_sponsorship_inquiry"(integer) TO "service_role";
