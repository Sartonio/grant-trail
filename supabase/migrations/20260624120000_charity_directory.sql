-- ============================================================================
-- Charity / Fiscal Agent Directory
-- ============================================================================
-- Implements the binding engineering contract in
-- docs/explanation/charity_directory_contract.md.
--
-- Charity Directory entitlements, layered on the existing membership system
-- (user_memberships / subscriptions), NOT a parallel gating mechanism:
--   * basic — seeker: view full directory + send inquiries.
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
-- 3. Entitlement helper functions
-- ----------------------------------------------------------------------------
-- Seeker access uses the pre-existing public.has_basic_membership().
-- Listing OWNERSHIP is NOT a separate tier: a charity operates as a fiscal agent
-- under the existing PREMIUM plan ("Fiscal Agents Plan", STRIPE_PRICE_PRO), so
-- listing publish/triage gates on the pre-existing has_premium_membership()
-- rather than a redundant fiscal_agent SKU.


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
-- Owner of the listing, OR any basic subscriber, OR super_admin.
CREATE POLICY "View full listings with basic access" ON "public"."fiscal_agent_listings"
  FOR SELECT USING (
    ("owner_user_id" IN ( SELECT "users"."id"
       FROM "public"."users"
      WHERE ("users"."user_id" = "auth"."uid"())))
    OR "public"."has_basic_membership"()
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
-- Requires basic membership, and the target listing must be live (published +
-- verified). created_by, when supplied, must map to the caller (no spoofing a
-- different seeker). tenant_id is denormalised by trigger, never trusted here.
CREATE POLICY "Seekers can send inquiries" ON "public"."sponsorship_inquiries"
  FOR INSERT WITH CHECK (
    "public"."has_basic_membership"()
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

GRANT ALL ON FUNCTION "public"."set_inquiry_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_inquiry_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_inquiry_tenant_id"() TO "service_role";
