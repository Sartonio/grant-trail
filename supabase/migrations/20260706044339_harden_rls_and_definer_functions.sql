-- ============================================================================
-- Harden RLS + SECURITY DEFINER functions (audited follow-ups)
--
-- This migration is a pure security-hardening pass. No feature tables are
-- added; every change closes an escalation / disclosure gap in the existing
-- schema. Reference points: 20260630130000_squashed_schema.sql (baseline) and
-- 20260630191700_rls_wrap_helpers_in_select_for_initplan.sql (current, initplan-
-- wrapped policy text). Predicates below are reproduced verbatim from the
-- current definitions modulo the specific hardening described.
--
-- ── Fix 1: admin UPDATE policies missing WITH CHECK ─────────────────────────
--   "Admins can update all {budget items|expenses|grants} in their tenant" were
--   created with a USING clause but NO WITH CHECK. Postgres then reuses USING as
--   the implicit WITH CHECK — BUT the USING predicate is
--     (tenant_id = current_tenant_id() AND is_admin()) OR is_super_admin()
--   which, evaluated against the NEW row, is still satisfied when an admin sets
--   NEW.tenant_id to ANOTHER tenant they are NOT admin of, because the
--   is_super_admin() arm (for supers) and — more importantly for a plain admin —
--   the row is re-checked with the NEW tenant_id, so a tenant-A admin who does
--   `UPDATE ... SET tenant_id = <B>` fails the check (good) ONLY by luck of the
--   USING reuse. To make the guarantee explicit and auditable, we restate the
--   full predicate as an explicit WITH CHECK so tenant_id can never be reassigned
--   away from the admin's own tenant. Drop+recreate (Postgres has no ALTER POLICY
--   for predicates); text matches the initplan-wrapped current definition.
--
-- ── Fix 2: users self-update ────────────────────────────────────────────────
--   "Users can update their own user record" had only USING (auth.uid()=user_id)
--   and no WITH CHECK. The privilege-bearing columns (role/tenant_id/is_active)
--   are already frozen by the enforce_user_self_update_guard trigger, but that
--   guard does NOT freeze user_id. We add an explicit WITH CHECK so a self-update
--   cannot re-point the row's user_id, and initplan-wrap auth.uid() to match the
--   repo's perf convention.
--
-- ── Fix 3: pin search_path on unpinned SECURITY DEFINER functions ───────────
--   A SECURITY DEFINER function with no `SET search_path` resolves unqualified
--   names against the CALLER's search_path — a classic privilege-escalation
--   vector (attacker plants a `public`-shadowing object). Most helpers in the
--   baseline are already pinned; the ones below were not. We pin them to
--   `public, pg_temp`. (Functions already pinned to `public[, auth, extensions]`
--   are intentionally LEFT ALONE — re-pinning them to `public, pg_temp` would
--   strip the `auth`/`extensions` schemas they legitimately need and break them.)
--   Every function below references only `public` objects plus schema-qualified
--   `auth.uid()`/`auth.role()`, so `public, pg_temp` is sufficient and safe.
--
-- ── Fix 4: fiscal_agent_listings_public — DELIBERATELY NOT flipped ──────────
--   The audit item asked to `SET (security_invoker = true)` on this view. That
--   change is UNSAFE here and is intentionally NOT applied. Reasoning:
--     * The view is the ONLY teaser path for anon AND logged-in non-subscribers
--       (frontend: useFiscalAgentDirectory / FiscalAgentProfile call it for every
--       "locked" visitor). It runs as its postgres owner today, exposing ONLY the
--       11 curated teaser columns of published+verified rows — it discloses
--       strictly LESS than the base table, so it is safe by construction.
--     * supabase/tests/charity-directory-rls.test.sh:139-143 ASSERTS that anon
--       gets `permission denied` querying the base fiscal_agent_listings table.
--       security_invoker=true would run the view AS the invoker, requiring us to
--       GRANT anon SELECT on the base table — directly contradicting that test
--       and re-opening a base-table read surface.
--     * The contact/EIN/fee columns are a membership PAYWALL the app enforces as
--       an RLS invariant ("RLS returns full rows only to subscribers"). Members
--       and non-member seekers share the `authenticated` role and are entitled to
--       the SAME rows (published+verified) but DIFFERENT columns; RLS cannot
--       express a per-column paywall, so the definer-view projection is the only
--       mechanism that enforces it. Flipping the view would force either a base
--       policy that leaks paywalled columns to any authenticated user, or an
--       empty directory for logged-in non-subscribers. Neither is acceptable.
--   Net: leaving this view as a curated SECURITY DEFINER projection is the
--   correct, test-backed decision. Flagged here for the reviewer.
--
-- ── Fix 5: platform_settings — stop world-reading the alert webhook secret ──
--   "Anyone can read platform settings" used USING(true), exposing the
--   alert_webhook_url secret (a Slack-style incoming webhook) to anon and every
--   authenticated user. We:
--     * Restrict base-table SELECT to super_admins (they manage the full row,
--       incl. the secret, via the /super Platform Defaults card; service_role and
--       the SECURITY DEFINER helpers bypass RLS as before).
--     * Publish a curated `platform_settings_public` view (all columns EXCEPT
--       alert_webhook_url) that the public/authenticated app reads for support
--       contact + Stripe product IDs. Same definer-projection pattern as the
--       fiscal teaser view: it discloses only non-secret columns.
--     * Revoke anon's base-table grant; anon reads only the public view.
--   Frontend reads that used the base table for non-secret columns
--   (hooks/usePlatformSettings.js, lib/billing.js) are repointed to the view in
--   the same change-set; the super-admin card (lib/data/tenants.js) stays on the
--   base table.
-- ============================================================================


-- ─── Fix 1: explicit WITH CHECK on admin UPDATE policies ────────────────────
DROP POLICY IF EXISTS "Admins can update all budget items in their tenant" ON "public"."budget_items";
CREATE POLICY "Admins can update all budget items in their tenant" ON "public"."budget_items"
  FOR UPDATE
  USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() )) AND ( SELECT "public"."is_admin"() )) OR ( SELECT "public"."is_super_admin"() )))
  WITH CHECK (((("tenant_id" = ( SELECT "public"."current_tenant_id"() )) AND ( SELECT "public"."is_admin"() )) OR ( SELECT "public"."is_super_admin"() )));

DROP POLICY IF EXISTS "Admins can update all expenses in their tenant" ON "public"."expenses";
CREATE POLICY "Admins can update all expenses in their tenant" ON "public"."expenses"
  FOR UPDATE
  USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() )) AND ( SELECT "public"."is_admin"() )) OR ( SELECT "public"."is_super_admin"() )))
  WITH CHECK (((("tenant_id" = ( SELECT "public"."current_tenant_id"() )) AND ( SELECT "public"."is_admin"() )) OR ( SELECT "public"."is_super_admin"() )));

DROP POLICY IF EXISTS "Admins can update all grants in their tenant" ON "public"."grant_record";
CREATE POLICY "Admins can update all grants in their tenant" ON "public"."grant_record"
  FOR UPDATE
  USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() )) AND ( SELECT "public"."is_admin"() )) OR ( SELECT "public"."is_super_admin"() )))
  WITH CHECK (((("tenant_id" = ( SELECT "public"."current_tenant_id"() )) AND ( SELECT "public"."is_admin"() )) OR ( SELECT "public"."is_super_admin"() )));


-- ─── Fix 2: explicit WITH CHECK on users self-update ────────────────────────
DROP POLICY IF EXISTS "Users can update their own user record" ON "public"."users";
CREATE POLICY "Users can update their own user record" ON "public"."users"
  FOR UPDATE
  USING ((( SELECT "auth"."uid"() ) = "user_id"))
  WITH CHECK ((( SELECT "auth"."uid"() ) = "user_id"));


-- ─── Fix 3: pin search_path on the remaining unpinned SECURITY DEFINER fns ──
ALTER FUNCTION public.auto_approve_budget_item()                    SET search_path = public, pg_temp;
ALTER FUNCTION public.auto_approve_expense()                        SET search_path = public, pg_temp;
ALTER FUNCTION public.auto_approve_grant()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.calculate_grant_budget_totals(integer)        SET search_path = public, pg_temp;
ALTER FUNCTION public.current_tenant_id()                           SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_membership_eligibility()              SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_self_service_role()                   SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_subscription_tier_product_match()     SET search_path = public, pg_temp;
ALTER FUNCTION public.get_admin_user_ids()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.get_grant_name(integer)                       SET search_path = public, pg_temp;
ALTER FUNCTION public.get_grant_owner(integer)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.has_basic_membership()                        SET search_path = public, pg_temp;
ALTER FUNCTION public.has_basic_membership(integer)                 SET search_path = public, pg_temp;
ALTER FUNCTION public.has_feature_access(text)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.has_premium_membership()                      SET search_path = public, pg_temp;
ALTER FUNCTION public.has_premium_membership(integer)               SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin()                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.is_membership_exempt()                        SET search_path = public, pg_temp;
ALTER FUNCTION public.is_membership_exempt(integer)                 SET search_path = public, pg_temp;
ALTER FUNCTION public.is_super_admin()                              SET search_path = public, pg_temp;
ALTER FUNCTION public.log_grant_status_change()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.set_audit_log_tenant_id()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.set_grant_tenant_id()                         SET search_path = public, pg_temp;
ALTER FUNCTION public.set_notification_tenant_id()                  SET search_path = public, pg_temp;
ALTER FUNCTION public.set_tenant_from_grant()                       SET search_path = public, pg_temp;


-- ─── Fix 5: platform_settings secret containment ────────────────────────────
-- Replace the world-readable row policy with a super-admin-only one. The row
-- carries alert_webhook_url; only staff who manage it should read the base table.
DROP POLICY IF EXISTS "Anyone can read platform settings" ON "public"."platform_settings";
CREATE POLICY "Super admins can read platform settings" ON "public"."platform_settings"
  FOR SELECT
  USING (( SELECT "public"."is_super_admin"() ));

-- Curated public projection: every column EXCEPT the alert_webhook_url secret.
-- Definer view (runs as owner) so anon/authenticated read the non-secret columns
-- without any base-table grant — same safe pattern as fiscal_agent_listings_public.
CREATE OR REPLACE VIEW "public"."platform_settings_public" AS
  SELECT "id",
         "default_support_email",
         "default_support_phone",
         "basic_membership_product_id",
         "premium_membership_product_id",
         "platform_root_slug"
    FROM "public"."platform_settings"
   WHERE "id" = 1;

ALTER VIEW "public"."platform_settings_public" OWNER TO "postgres";

-- anon no longer needs (and must not have) base-table access; it reads the view.
REVOKE ALL ON TABLE "public"."platform_settings" FROM "anon";

GRANT SELECT ON TABLE "public"."platform_settings_public" TO "anon";
GRANT SELECT ON TABLE "public"."platform_settings_public" TO "authenticated";
GRANT SELECT ON TABLE "public"."platform_settings_public" TO "service_role";
