-- ============================================================================
-- Charity / Fiscal Agent Directory
-- ============================================================================
-- Implements the binding engineering contract in
-- docs/explanation/charity_directory_contract.md.
--
-- Charity Directory entitlements, layered on the existing membership system
-- (user_memberships / subscriptions), NOT a parallel gating mechanism:
--   * directory_access — seeker: view full directory + send inquiries (NEW SKU).
--   * premium ("Fiscal Agents Plan") — charity: publish/maintain a listing +
--     triage inquiries. Reuses the existing org-admin premium plan rather than a
--     separate fiscal_agent SKU (see docs/explanation/charity_directory_contract.md).
--
-- RLS follows the lesson of migration 20260617150000: every WRITE path carries
-- the entitlement predicate in WITH CHECK. The public teaser view is the only
-- ungated read surface and exposes no contact columns.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."fiscal_agent_listings" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "owner_user_id" integer,
    "name" character varying(200),
    "location" character varying(200),
    "region" character varying(100),
    "ein" character varying(50),
    "focus" "text"[] DEFAULT '{}'::"text"[],
    "blurb" "text",
    "about" "text",
    "services" "text"[] DEFAULT '{}'::"text"[],
    "projects" "text"[] DEFAULT '{}'::"text"[],
    "website" character varying(255),
    "email" character varying(255),
    "phone" character varying(50),
    "response_time" character varying(100),
    "accepting" boolean DEFAULT true NOT NULL,
    "fee_admin_pct" numeric(6,2),
    "rating" numeric(3,2) DEFAULT 0 NOT NULL,
    "reviews" integer DEFAULT 0 NOT NULL,
    "sponsored" integer DEFAULT 0 NOT NULL,
    "assets_managed" character varying(50),
    "verified" boolean DEFAULT false NOT NULL,
    "status" character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    "verification" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "fiscal_agent_listings_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'hidden'::character varying])::"text"[]))),
    CONSTRAINT "fiscal_agent_listings_verification_check" CHECK ((("verification")::"text" = ANY ((ARRAY['pending'::character varying, 'verified'::character varying, 'rejected'::character varying])::"text"[])))
);

ALTER TABLE "public"."fiscal_agent_listings" OWNER TO "postgres";

CREATE SEQUENCE IF NOT EXISTS "public"."fiscal_agent_listings_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."fiscal_agent_listings_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."fiscal_agent_listings_id_seq" OWNED BY "public"."fiscal_agent_listings"."id";
ALTER TABLE ONLY "public"."fiscal_agent_listings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."fiscal_agent_listings_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."fiscal_agent_listings"
    ADD CONSTRAINT "fiscal_agent_listings_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."fiscal_agent_listings"
    ADD CONSTRAINT "fiscal_agent_listings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."fiscal_agent_listings"
    ADD CONSTRAINT "fiscal_agent_listings_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;

CREATE INDEX "idx_fiscal_agent_listings_tenant_id" ON "public"."fiscal_agent_listings" USING "btree" ("tenant_id");
CREATE INDEX "idx_fiscal_agent_listings_owner_user_id" ON "public"."fiscal_agent_listings" USING "btree" ("owner_user_id");
CREATE INDEX "idx_fiscal_agent_listings_public" ON "public"."fiscal_agent_listings" USING "btree" ("status", "verification");


CREATE TABLE IF NOT EXISTS "public"."sponsorship_inquiries" (
    "id" integer NOT NULL,
    "listing_id" integer NOT NULL,
    "tenant_id" integer,
    "created_by" integer,
    "status" character varying(20) DEFAULT 'new'::character varying NOT NULL,
    "project" "jsonb" NOT NULL,
    "contact" "jsonb" NOT NULL,
    "message" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sponsorship_inquiries_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['new'::character varying, 'reviewing'::character varying, 'accepted'::character varying, 'declined'::character varying, 'waitlisted'::character varying])::"text"[])))
);

ALTER TABLE "public"."sponsorship_inquiries" OWNER TO "postgres";

CREATE SEQUENCE IF NOT EXISTS "public"."sponsorship_inquiries_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."sponsorship_inquiries_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."sponsorship_inquiries_id_seq" OWNED BY "public"."sponsorship_inquiries"."id";
ALTER TABLE ONLY "public"."sponsorship_inquiries" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sponsorship_inquiries_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."sponsorship_inquiries"
    ADD CONSTRAINT "sponsorship_inquiries_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."sponsorship_inquiries"
    ADD CONSTRAINT "sponsorship_inquiries_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."fiscal_agent_listings"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."sponsorship_inquiries"
    ADD CONSTRAINT "sponsorship_inquiries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."sponsorship_inquiries"
    ADD CONSTRAINT "sponsorship_inquiries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;

CREATE INDEX "idx_sponsorship_inquiries_listing_id" ON "public"."sponsorship_inquiries" USING "btree" ("listing_id");
CREATE INDEX "idx_sponsorship_inquiries_tenant_id" ON "public"."sponsorship_inquiries" USING "btree" ("tenant_id");
CREATE INDEX "idx_sponsorship_inquiries_status" ON "public"."sponsorship_inquiries" USING "btree" ("status");


-- ----------------------------------------------------------------------------
-- 2. Triggers — updated_at maintenance + tenant-defaulting for inquiries
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER "trg_fiscal_agent_listings_updated_at"
    BEFORE UPDATE ON "public"."fiscal_agent_listings"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- Denormalise the inquiry's tenant_id from its listing (for RLS scoping), the
-- same pattern as set_tenant_from_grant / set_notification_tenant_id.
CREATE OR REPLACE FUNCTION "public"."set_inquiry_tenant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Always derive from the listing; never trust a client-supplied tenant_id (the
  -- inquiry INSERT is seeker-facing). Force-overwrite, matching the derive pattern
  -- and closing the forgeable-denormalised-value bug (QA finding #3).
  NEW.tenant_id := (SELECT tenant_id FROM fiscal_agent_listings WHERE id = NEW.listing_id);
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."set_inquiry_tenant_id"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trg_sponsorship_inquiries_tenant_id"
    BEFORE INSERT ON "public"."sponsorship_inquiries"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_inquiry_tenant_id"();


-- ----------------------------------------------------------------------------
-- 3. Entitlement helper functions (mirror has_basic_membership() style)
-- ----------------------------------------------------------------------------
-- directory_access (the seeker entitlement) passes ONLY on an active
-- directory_access membership (or exempt). Listing OWNERSHIP is NOT a separate
-- tier: a charity operates as a fiscal agent under the existing PREMIUM plan
-- ("Fiscal Agents Plan", STRIPE_PRICE_PRO), so listing publish/triage gates on the
-- pre-existing has_premium_membership() rather than a redundant fiscal_agent SKU.

CREATE OR REPLACE FUNCTION "public"."has_directory_access"("p_user_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    CASE
      WHEN is_membership_exempt(p_user_id) THEN true
      ELSE EXISTS (
        SELECT 1
        FROM user_memberships
        WHERE user_id = p_user_id
          AND is_active = true
          AND membership_tier = 'directory_access'
      )
    END;
$$;

ALTER FUNCTION "public"."has_directory_access"("p_user_id" integer) OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."has_directory_access"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT has_directory_access(u.id)
  FROM users u
  WHERE u.user_id = auth.uid()
  LIMIT 1;
$$;

ALTER FUNCTION "public"."has_directory_access"() OWNER TO "postgres";

-- NOTE: there is intentionally NO has_fiscal_agent_access() helper. Listing
-- ownership folds into the existing premium plan, so the listing/inquiry write
-- policies below use the pre-existing public.has_premium_membership().


-- ----------------------------------------------------------------------------
-- 4. Public teaser view — anyone (anon + authenticated) may SELECT
-- ----------------------------------------------------------------------------
-- Only teaser-safe columns; only published + verified rows. NO contact / email /
-- phone / website / about / services columns ever leak here. The view runs with
-- the privileges of its owner (postgres), so it bypasses the base table's RLS
-- but is hard-limited to the teaser projection + published/verified filter.

CREATE OR REPLACE VIEW "public"."fiscal_agent_listings_public" AS
  SELECT
    l.id,
    l.name,
    l.location,
    l.region,
    l.verified,
    l.focus,
    l.blurb,
    l.accepting,
    l.rating,
    l.reviews,
    l.sponsored
  FROM public.fiscal_agent_listings l
  WHERE l.status = 'published'
    AND l.verification = 'verified';

ALTER VIEW "public"."fiscal_agent_listings_public" OWNER TO "postgres";

GRANT SELECT ON "public"."fiscal_agent_listings_public" TO "anon";
GRANT SELECT ON "public"."fiscal_agent_listings_public" TO "authenticated";


-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------

ALTER TABLE "public"."fiscal_agent_listings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sponsorship_inquiries" ENABLE ROW LEVEL SECURITY;

-- Service role bypass (webhook provisioning), mirroring billing tables.
CREATE POLICY "Service role can manage listings" ON "public"."fiscal_agent_listings"
  USING (("auth"."role"() = 'service_role'::"text"))
  WITH CHECK (("auth"."role"() = 'service_role'::"text"));

CREATE POLICY "Service role can manage inquiries" ON "public"."sponsorship_inquiries"
  USING (("auth"."role"() = 'service_role'::"text"))
  WITH CHECK (("auth"."role"() = 'service_role'::"text"));

-- --- fiscal_agent_listings: SELECT (full row) ---
-- Owner of the listing, OR any directory_access subscriber, OR super_admin.
CREATE POLICY "View full listings with directory access" ON "public"."fiscal_agent_listings"
  FOR SELECT USING (
    ("owner_user_id" IN ( SELECT "users"."id"
       FROM "public"."users"
      WHERE ("users"."user_id" = "auth"."uid"())))
    OR "public"."has_directory_access"()
    OR "public"."is_super_admin"()
  );

-- --- fiscal_agent_listings: INSERT ---
-- Must hold the premium ("Fiscal Agents Plan") entitlement, own the row, and write
-- into own tenant.
CREATE POLICY "Owners can insert their listing" ON "public"."fiscal_agent_listings"
  FOR INSERT WITH CHECK (
    "public"."has_premium_membership"()
    AND ("owner_user_id" IN ( SELECT "users"."id"
       FROM "public"."users"
      WHERE ("users"."user_id" = "auth"."uid"())))
    AND ("tenant_id" = "public"."current_tenant_id"())
  );

-- --- fiscal_agent_listings: UPDATE ---
-- Same entitlement + ownership + tenant gate on both the visible row (USING) and
-- the post-update row (WITH CHECK) so ownership/tenant cannot be reassigned away.
CREATE POLICY "Owners can update their listing" ON "public"."fiscal_agent_listings"
  FOR UPDATE
  USING (
    "public"."has_premium_membership"()
    AND ("owner_user_id" IN ( SELECT "users"."id"
       FROM "public"."users"
      WHERE ("users"."user_id" = "auth"."uid"())))
    AND ("tenant_id" = "public"."current_tenant_id"())
  )
  WITH CHECK (
    "public"."has_premium_membership"()
    AND ("owner_user_id" IN ( SELECT "users"."id"
       FROM "public"."users"
      WHERE ("users"."user_id" = "auth"."uid"())))
    AND ("tenant_id" = "public"."current_tenant_id"())
  );

-- --- fiscal_agent_listings: super_admin moderation/verification ---
-- Separate permissive policy: staff can SELECT (covered above) and UPDATE any
-- listing (e.g. flip verification = 'verified').
CREATE POLICY "Super admins can update any listing" ON "public"."fiscal_agent_listings"
  FOR UPDATE USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());

-- --- Guard: moderation columns are staff-controlled ----------------------------
-- Closes a self-verification bypass (security review finding #1): the owner INSERT
-- and UPDATE policies intentionally let a paying charity create/edit its own listing,
-- but the trust columns (`verification`, `verified`) must stay under super_admin
-- control — otherwise any owner could self-grant the "platform-verified" badge and
-- surface in the public teaser view (which keys on verification = 'verified') without
-- review. This fires on BOTH write paths:
--   * INSERT — force the moderation columns to their unverified defaults, so an owner
--     cannot create a row that is born 'published'+'verified'. (The owner UPDATE-only
--     guard left this path open; see review follow-up.)
--   * UPDATE — preserve the prior moderation state, so an owner can publish
--     (status = 'published') but the listing only becomes publicly visible once a
--     super_admin verifies it.
-- Service role (webhook provisioning) and super_admin are exempt.
-- Mirrors the self-update guard pattern in 20260619120000.
CREATE OR REPLACE FUNCTION "public"."enforce_listing_moderation_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT (public.is_super_admin() OR auth.role() = 'service_role') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verification := 'pending';
      NEW.verified := false;
    ELSE
      NEW.verification := OLD.verification;
      NEW.verified := OLD.verified;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_listing_moderation_guard"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trg_enforce_listing_moderation_guard"
    BEFORE INSERT OR UPDATE ON "public"."fiscal_agent_listings"
    FOR EACH ROW EXECUTE FUNCTION "public"."enforce_listing_moderation_guard"();

-- --- sponsorship_inquiries: INSERT (seeker sends an inquiry) ---
-- Requires directory_access, and the target listing must be live (published +
-- verified). created_by, when supplied, must map to the caller (no spoofing a
-- different seeker). tenant_id is denormalised by trigger, never trusted here.
CREATE POLICY "Seekers can send inquiries" ON "public"."sponsorship_inquiries"
  FOR INSERT WITH CHECK (
    "public"."has_directory_access"()
    AND ("listing_id" IN ( SELECT "l"."id"
       FROM "public"."fiscal_agent_listings" "l"
      WHERE ("l"."status" = 'published' AND "l"."verification" = 'verified')))
    AND (
      "created_by" IS NULL
      OR "created_by" IN ( SELECT "users"."id"
         FROM "public"."users"
        WHERE ("users"."user_id" = "auth"."uid"()))
    )
  );

-- --- sponsorship_inquiries: SELECT (listing owner triages their inbox) ---
-- Scoped to inquiries whose listing the caller owns, OR super_admin. No IDOR
-- across listings/tenants.
CREATE POLICY "Owners can view their inquiries" ON "public"."sponsorship_inquiries"
  FOR SELECT USING (
    ("listing_id" IN ( SELECT "l"."id"
       FROM "public"."fiscal_agent_listings" "l"
       JOIN "public"."users" "u" ON ("l"."owner_user_id" = "u"."id")
      WHERE ("u"."user_id" = "auth"."uid"())))
    OR "public"."is_super_admin"()
  );

-- --- sponsorship_inquiries: UPDATE (status triage) ---
-- Caller must own the listing AND hold an active premium entitlement (lapse
-- => read-only inbox). listing_id cannot be moved to a listing the caller does
-- not own (enforced in WITH CHECK).
CREATE POLICY "Owners can triage their inquiries" ON "public"."sponsorship_inquiries"
  FOR UPDATE
  USING (
    "public"."has_premium_membership"()
    AND ("listing_id" IN ( SELECT "l"."id"
       FROM "public"."fiscal_agent_listings" "l"
       JOIN "public"."users" "u" ON ("l"."owner_user_id" = "u"."id")
      WHERE ("u"."user_id" = "auth"."uid"())))
  )
  WITH CHECK (
    "public"."has_premium_membership"()
    AND ("listing_id" IN ( SELECT "l"."id"
       FROM "public"."fiscal_agent_listings" "l"
       JOIN "public"."users" "u" ON ("l"."owner_user_id" = "u"."id")
      WHERE ("u"."user_id" = "auth"."uid"())))
  );


-- ----------------------------------------------------------------------------
-- 6. Table / sequence grants (mirror existing public tables)
-- ----------------------------------------------------------------------------

GRANT ALL ON TABLE "public"."fiscal_agent_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."fiscal_agent_listings" TO "service_role";
GRANT ALL ON SEQUENCE "public"."fiscal_agent_listings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."fiscal_agent_listings_id_seq" TO "service_role";

GRANT ALL ON TABLE "public"."sponsorship_inquiries" TO "authenticated";
GRANT ALL ON TABLE "public"."sponsorship_inquiries" TO "service_role";
GRANT ALL ON SEQUENCE "public"."sponsorship_inquiries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sponsorship_inquiries_id_seq" TO "service_role";

GRANT ALL ON FUNCTION "public"."has_directory_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."has_directory_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_directory_access"() TO "service_role";
GRANT ALL ON FUNCTION "public"."has_directory_access"("p_user_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."has_directory_access"("p_user_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_directory_access"("p_user_id" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_inquiry_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_inquiry_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_inquiry_tenant_id"() TO "service_role";


-- ----------------------------------------------------------------------------
-- 7. Extend membership tier CHECK constraints for the two new tiers
-- ----------------------------------------------------------------------------

ALTER TABLE "public"."subscriptions"
  DROP CONSTRAINT IF EXISTS "subscriptions_membership_tier_check";
ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "subscriptions_membership_tier_check"
  CHECK ((("membership_tier")::"text" = ANY ((ARRAY['basic'::character varying, 'premium'::character varying, 'directory_access'::character varying])::"text"[])));

ALTER TABLE "public"."user_memberships"
  DROP CONSTRAINT IF EXISTS "user_memberships_membership_tier_check";
ALTER TABLE "public"."user_memberships"
  ADD CONSTRAINT "user_memberships_membership_tier_check"
  CHECK ((("membership_tier")::"text" = ANY ((ARRAY['basic'::character varying, 'premium'::character varying, 'directory_access'::character varying])::"text"[])));


-- ----------------------------------------------------------------------------
-- 8. Gate the product-match trigger to basic/premium only
-- ----------------------------------------------------------------------------
-- platform_settings only stores basic/premium product IDs. The new tiers have no
-- configured product ID, so the product-match check must skip them (otherwise it
-- would raise "Platform membership product IDs are not configured" for every
-- directory_access subscription).

CREATE OR REPLACE FUNCTION "public"."enforce_subscription_tier_product_match"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  basic_product_id TEXT;
  premium_product_id TEXT;
BEGIN
  -- Only basic/premium are product-matched; the directory_access
  -- tiers are validated by the membership CHECK constraint and the checkout
  -- function's env-configured price, not by platform_settings product IDs.
  IF NEW.membership_tier NOT IN ('basic', 'premium') THEN
    RETURN NEW;
  END IF;

  SELECT basic_membership_product_id, premium_membership_product_id
  INTO basic_product_id, premium_product_id
  FROM platform_settings
  WHERE id = 1;

  IF basic_product_id IS NULL OR premium_product_id IS NULL THEN
    RAISE EXCEPTION 'Platform membership product IDs are not configured';
  END IF;

  IF NEW.membership_tier = 'basic' AND NEW.stripe_product_id <> basic_product_id THEN
    RAISE EXCEPTION 'Basic subscription must use product ID %', basic_product_id;
  END IF;

  IF NEW.membership_tier = 'premium' AND NEW.stripe_product_id <> premium_product_id THEN
    RAISE EXCEPTION 'Premium subscription must use product ID %', premium_product_id;
  END IF;

  RETURN NEW;
END;
$$;

-- NOTE: enforce_membership_eligibility is unchanged — it gates by the target
-- user's ROLE/tenant (rejects super_admin and TFAC admins) and is tier-agnostic,
-- so it already accepts the new tiers without modification.


-- ----------------------------------------------------------------------------
-- 8b. Guard: the new PAID directory_access tier may only be granted by checkout/staff
-- ----------------------------------------------------------------------------
-- Closes a paywall bypass (security review finding #2): the pre-existing policy
-- "Admins can manage memberships in their tenant" lets any tenant admin INSERT/UPDATE
-- user_memberships rows for users in their tenant (incl. themselves) with NO tier
-- restriction in its WITH CHECK. Because has_directory_access() reads entitlement
-- straight from an active user_memberships row, an admin could self-grant
-- `directory_access` (is_active = true) and obtain the seeker paywall for free,
-- never touching Stripe.
--
-- Entitlement to the paid directory tier must trace to a real checkout: the Stripe
-- webhook writes these rows as the service_role, and a super_admin may deliberately
-- comp one. Any other writer attempting an ACTIVE directory_access membership is
-- rejected. Scope is deliberately limited to directory_access so the pre-existing
-- basic/premium grant behavior is left untouched. (Listing ownership now folds into
-- premium, whose self-grant surface is pre-existing and out of scope for this fix.)
--
-- (auth.role() reflects the request's JWT role: 'service_role' for the webhook,
-- 'authenticated' for a real user, NULL for a trusted superuser/psql context — so
-- direct postgres seeding/migrations are unaffected.)
CREATE OR REPLACE FUNCTION "public"."enforce_directory_tier_grant_source"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.is_active = true
     AND NEW.membership_tier = 'directory_access'
     AND NOT (public.is_super_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Directory entitlement % can only be granted via checkout or by a super_admin', NEW.membership_tier
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_directory_tier_grant_source"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trg_enforce_directory_tier_grant_source"
    BEFORE INSERT OR UPDATE ON "public"."user_memberships"
    FOR EACH ROW EXECUTE FUNCTION "public"."enforce_directory_tier_grant_source"();


-- ----------------------------------------------------------------------------
-- 9. Extend get_session_context membership object
-- ----------------------------------------------------------------------------
-- Adds hasDirectoryAccess / hasFiscalAgentAccess; all existing keys retained.

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
      'isExempt',             COALESCE(public.is_membership_exempt(v_user.id), false),
      'hasBasicAccess',       COALESCE(public.has_basic_membership(v_user.id), false),
      'hasPremiumAccess',     COALESCE(public.has_premium_membership(v_user.id), false),
      'hasDirectoryAccess',   COALESCE(public.has_directory_access(v_user.id), false),
      'membership',           v_membership,
      'activeSubscription',   v_subscription
    )
  );
END;
$$;
