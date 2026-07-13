-- ============================================================================
-- Tenant-owned premium billing
--
-- The premium ("Fiscal Agents Plan") tier becomes TENANT-owned; the basic tier
-- stays per-user. Entitlement is already tenant-scoped (is_membership_exempt
-- clause 4, tenants.accepts_sponsorships) but every billing object was keyed
-- UNIQUE(user_id) ON DELETE CASCADE from users — so offboarding the admin who
-- paid cascaded the org's subscription away and silently dropped the tenant's
-- exemption, the portal/invoices lived under one person, and two admins could
-- double-pay with nothing to dedup. See docs/explanation/tenant_billing_redesign.md.
--
-- This migration implements the "New/changed schema" section of that plan:
--   1. billing_customers: nullable user_id + nullable tenant_id, exactly-one-
--      owner CHECK, partial unique index on tenant_id, tenant-admin SELECT RLS.
--   2. subscriptions: nullable user_id (FK CASCADE -> SET NULL so payer
--      offboarding no longer destroys the org sub), nullable tenant_id,
--      at-least-one-owner CHECK, tenant_id backfill + index, tenant-admin
--      SELECT RLS.
--   3. tenant_memberships: new table mirroring user_memberships but keyed
--      UNIQUE(tenant_id), tier CHECK 'premium' only. Tenant-scoped RLS in the
--      SAME migration (mandatory): service_role manages, members read their own
--      tenant's row, super_admin reads all, NO authenticated writes.
--   4. Backfill tenant_memberships from active premium user_memberships (one
--      row per tenant, most-recently-updated wins).
--   5/6. is_membership_exempt(int) clause 4 + has_premium_membership(int) check
--      tenant_memberships FIRST, keeping the legacy premium user_memberships
--      clause TEMPORARILY for deploy-order safety (the webhook may still write
--      the old shape until edge functions deploy). A follow-up cleanup migration
--      drops the legacy clause. ends_at semantics preserved from
--      20260703120000_membership_checks_respect_ends_at.sql exactly.
--   7. get_session_context surfaces the tenant membership + tenant-owned active
--      subscription so the SPA can show "organization plan" state.
--
-- Security note: no policy is dropped or loosened. Every added SELECT policy is
-- strictly narrower (tenant admins over their OWN tenant's billing rows) and
-- there are ZERO new write policies for authenticated — all billing writes stay
-- service_role-only. tenant_memberships has RLS enabled in this migration.
-- Helper wrappers keep STABLE SECURITY DEFINER + search_path identical to the
-- 20260703120000 versions; helper calls in policies are (SELECT ...)-wrapped per
-- the 20260630191700 initplan convention.
-- ============================================================================


-- ── 1. billing_customers: dual-owner (user OR tenant) ───────────────────────
ALTER TABLE "public"."billing_customers"
  ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "public"."billing_customers"
  ADD COLUMN IF NOT EXISTS "tenant_id" integer;

ALTER TABLE "public"."billing_customers"
  ADD CONSTRAINT "billing_customers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;

-- Exactly one owner: user-owned (basic) XOR tenant-owned (premium). All existing
-- rows are user-owned (tenant_id NULL) and satisfy this.
ALTER TABLE "public"."billing_customers"
  ADD CONSTRAINT "chk_billing_customers_one_owner"
  CHECK (("user_id" IS NULL) <> ("tenant_id" IS NULL));

-- One Stripe customer per tenant. Partial index also serves the tenant_id lookup.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_billing_customers_tenant_id"
  ON "public"."billing_customers" USING "btree" ("tenant_id")
  WHERE ("tenant_id" IS NOT NULL);

-- Tenant admins may READ their tenant's billing customer (portal / status UX).
CREATE POLICY "Tenant admins can read their tenant billing customer"
  ON "public"."billing_customers" FOR SELECT
  USING ((("tenant_id" = ( SELECT "public"."current_tenant_id"() )) AND ( SELECT "public"."is_admin"() )));


-- ── 2. subscriptions: nullable user_id, FK SET NULL, tenant owner ───────────
ALTER TABLE "public"."subscriptions"
  ALTER COLUMN "user_id" DROP NOT NULL;

-- Payer offboarding must NOT destroy the org's subscription row: CASCADE -> SET NULL.
ALTER TABLE "public"."subscriptions"
  DROP CONSTRAINT "subscriptions_user_id_fkey";

ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;

ALTER TABLE "public"."subscriptions"
  ADD COLUMN IF NOT EXISTS "tenant_id" integer;

ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "subscriptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;

-- At least one owner (a row may be BOTH: user_id = initiator, tenant_id = org).
ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "chk_subscriptions_has_owner"
  CHECK (("user_id" IS NOT NULL) OR ("tenant_id" IS NOT NULL));

CREATE INDEX IF NOT EXISTS "idx_subscriptions_tenant_id"
  ON "public"."subscriptions" USING "btree" ("tenant_id");

-- Backfill: stamp the payer's tenant onto existing premium subscription rows.
UPDATE "public"."subscriptions" s
   SET "tenant_id" = u."tenant_id"
  FROM "public"."users" u
 WHERE s."user_id" = u."id"
   AND s."membership_tier" = 'premium'
   AND s."tenant_id" IS NULL;

-- NB: enforce_subscription_tier_product_match (trg_enforce_subscription_tier_
-- product_match) validates NEW.membership_tier vs NEW.stripe_product_id only —
-- it never references user_id, so it is unaffected by the nullable user_id.

-- Tenant admins may READ their tenant's subscription rows (status UX).
CREATE POLICY "Tenant admins can read their tenant subscriptions"
  ON "public"."subscriptions" FOR SELECT
  USING ((("tenant_id" = ( SELECT "public"."current_tenant_id"() )) AND ( SELECT "public"."is_admin"() )));


-- ── 3. tenant_memberships: tenant-owned premium entitlement ─────────────────
CREATE TABLE IF NOT EXISTS "public"."tenant_memberships" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "subscription_id" integer,
    "membership_tier" character varying(20) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone,
    "source" character varying(20) DEFAULT 'stripe'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_tenant_memberships_dates" CHECK ((("ends_at" IS NULL) OR ("ends_at" >= "starts_at"))),
    CONSTRAINT "tenant_memberships_membership_tier_check" CHECK ((("membership_tier")::"text" = 'premium'::"text")),
    CONSTRAINT "tenant_memberships_source_check" CHECK ((("source")::"text" = ANY (ARRAY[('stripe'::character varying)::"text", ('manual'::character varying)::"text", ('legacy'::character varying)::"text"])))
);

ALTER TABLE "public"."tenant_memberships" OWNER TO "postgres";

CREATE SEQUENCE IF NOT EXISTS "public"."tenant_memberships_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."tenant_memberships_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."tenant_memberships_id_seq" OWNED BY "public"."tenant_memberships"."id";
ALTER TABLE ONLY "public"."tenant_memberships"
    ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tenant_memberships_id_seq"'::"regclass");

ALTER TABLE ONLY "public"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id");

-- One premium membership per tenant.
ALTER TABLE ONLY "public"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_tenant_id_key" UNIQUE ("tenant_id");

ALTER TABLE ONLY "public"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL;

-- Indexes on the FK and on columns RLS / entitlement predicates filter by.
CREATE INDEX IF NOT EXISTS "idx_tenant_memberships_subscription_id"
  ON "public"."tenant_memberships" USING "btree" ("subscription_id");
CREATE INDEX IF NOT EXISTS "idx_tenant_memberships_active"
  ON "public"."tenant_memberships" USING "btree" ("is_active");

-- updated_at touch trigger — mirrors user_memberships (set_billing_updated_at).
CREATE OR REPLACE TRIGGER "trg_tenant_memberships_updated_at"
  BEFORE UPDATE ON "public"."tenant_memberships"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_billing_updated_at"();

-- RLS (mandatory in the same migration).
ALTER TABLE "public"."tenant_memberships" ENABLE ROW LEVEL SECURITY;

-- Backend/webhook provisioning (mirrors the billing tables).
CREATE POLICY "Service role can manage tenant memberships"
  ON "public"."tenant_memberships"
  USING (("auth"."role"() = 'service_role'::"text"))
  WITH CHECK (("auth"."role"() = 'service_role'::"text"));

-- Members of a tenant may READ their own tenant's membership row (org-plan UX).
CREATE POLICY "Members can read their tenant membership"
  ON "public"."tenant_memberships" FOR SELECT
  USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() )));

-- Platform root reads all (tenant-agnostic).
CREATE POLICY "Super admins can read all tenant memberships"
  ON "public"."tenant_memberships" FOR SELECT
  USING (( SELECT "public"."is_super_admin"() ));

-- No INSERT/UPDATE/DELETE policy for authenticated => writes denied. Only
-- service_role (above) writes tenant_memberships.


-- ── 4. Backfill tenant_memberships from active premium user_memberships ─────
-- One row per tenant; most-recently-updated premium membership per tenant wins.
INSERT INTO "public"."tenant_memberships"
  ("tenant_id", "subscription_id", "membership_tier", "is_active", "starts_at", "ends_at", "source")
SELECT DISTINCT ON (u."tenant_id")
       u."tenant_id",
       um."subscription_id",
       'premium',
       um."is_active",
       um."starts_at",
       um."ends_at",
       'stripe'
  FROM "public"."user_memberships" um
  JOIN "public"."users" u ON u."id" = um."user_id"
 WHERE um."membership_tier" = 'premium'
   AND um."is_active" = true
 ORDER BY u."tenant_id", um."updated_at" DESC
ON CONFLICT ("tenant_id") DO NOTHING;


-- ── 5. is_membership_exempt(int): clause 4 -> tenant_memberships first ──────
-- Only clause 4 changes; super_admin / platform-root / require_subscription
-- clauses and the STABLE SECURITY DEFINER + search_path stay identical to
-- 20260703120000_membership_checks_respect_ends_at.sql.
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
        -- Tenant-owned premium entitlement (new canonical source).
        OR EXISTS (
          SELECT 1
          FROM tenant_memberships tm
          WHERE tm.tenant_id = u.tenant_id
            AND tm.is_active = true
            AND (tm.ends_at IS NULL OR tm.ends_at > now())
            AND tm.membership_tier = 'premium'
        )
        -- Legacy clause: any tenant user holding an active premium
        -- user_memberships row. Kept verbatim for deploy-order safety (the
        -- Stripe webhook may still write the old per-user shape until the edge
        -- functions deploy). Dropped in a follow-up cleanup migration.
        OR EXISTS (
          SELECT 1
          FROM users tenant_users
          JOIN user_memberships um ON um.user_id = tenant_users.id
          WHERE tenant_users.tenant_id = u.tenant_id
            AND um.is_active = true
            AND (um.ends_at IS NULL OR um.ends_at > now())
            AND um.membership_tier = 'premium'
        )
      )
  );
$$;

ALTER FUNCTION "public"."is_membership_exempt"("p_user_id" integer) OWNER TO "postgres";


-- ── 6. has_premium_membership(int): tenant membership first, legacy own-row ──
CREATE OR REPLACE FUNCTION "public"."has_premium_membership"("p_user_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    CASE
      WHEN is_membership_exempt(p_user_id) THEN true
      ELSE (
        -- Tenant-owned premium: caller's tenant has an active unexpired row.
        EXISTS (
          SELECT 1
          FROM users u
          JOIN tenant_memberships tm ON tm.tenant_id = u.tenant_id
          WHERE u.id = p_user_id
            AND tm.is_active = true
            AND (tm.ends_at IS NULL OR tm.ends_at > now())
            AND tm.membership_tier = 'premium'
        )
        -- Legacy own-row premium user_membership. Kept verbatim for deploy-order
        -- safety; dropped in a follow-up cleanup migration.
        OR EXISTS (
          SELECT 1
          FROM user_memberships
          WHERE user_id = p_user_id
            AND is_active = true
            AND (ends_at IS NULL OR ends_at > now())
            AND membership_tier = 'premium'
        )
      )
    END;
$$;

ALTER FUNCTION "public"."has_premium_membership"("p_user_id" integer) OWNER TO "postgres";


-- ── 7. get_session_context(): surface tenant membership + tenant-owned sub ──
CREATE OR REPLACE FUNCTION "public"."get_session_context"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user             public.users%ROWTYPE;
  v_tenant           jsonb;
  v_settings         jsonb;
  v_membership       jsonb;
  v_tenant_membership jsonb;
  v_subscription     jsonb;
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

  -- The caller's tenant-owned premium membership (org plan), if any.
  SELECT to_jsonb(tm) INTO v_tenant_membership
  FROM public.tenant_memberships tm
  WHERE tm.tenant_id = v_user.tenant_id
  LIMIT 1;

  -- Live subscription: the caller's OWN sub OR their tenant-owned sub.
  SELECT to_jsonb(s) INTO v_subscription
  FROM public.subscriptions s
  WHERE (s.user_id = v_user.id OR s.tenant_id = v_user.tenant_id)
    AND s.status IN ('active', 'trialing', 'past_due')
  ORDER BY s.updated_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'user', to_jsonb(v_user),
    'tenant', v_tenant,
    'tenantSettings', v_settings,
    'membership', jsonb_build_object(
      'isExempt',          COALESCE(public.is_membership_exempt(v_user.id), false),
      'hasBasicAccess',    COALESCE(public.has_basic_membership(v_user.id), false),
      'hasPremiumAccess',  COALESCE(public.has_premium_membership(v_user.id), false),
      'membership',        v_membership,
      'tenantMembership',  v_tenant_membership,
      'activeSubscription', v_subscription
    )
  );
END;
$$;

ALTER FUNCTION "public"."get_session_context"() OWNER TO "postgres";


-- ── Grants (match sibling billing/membership tables) ────────────────────────
GRANT ALL ON TABLE "public"."tenant_memberships" TO "anon";
GRANT ALL ON TABLE "public"."tenant_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_memberships" TO "service_role";

GRANT ALL ON SEQUENCE "public"."tenant_memberships_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenant_memberships_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenant_memberships_id_seq" TO "service_role";
