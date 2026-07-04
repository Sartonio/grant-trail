-- ============================================================================
-- Fiscal Agent listings: RLS must enforce verified-only public visibility.
--
-- Bug (root cause): the SELECT policy "View full listings with basic access"
-- (20260701091000) granted a plain `has_basic_membership()` caller EVERY row —
-- including draft / pending / rejected listings with full contact, EIN, and fee
-- data. Verified-only visibility was enforced ONLY by client-side filters
-- (.eq('status','published').eq('verification','verified')) in the data layer,
-- NOT by RLS. A subscribed seeker issuing their own query saw unverified rows.
-- That breaks the repo invariant: RLS is the enforcement boundary.
--
-- Fix: drop and recreate that single SELECT policy so the basic-membership arm
-- is scoped to publicly-visible rows. Three access paths, unchanged helpers:
--   * Tenant admins  -> their own tenant's listing in ANY status/verification
--                       (dashboard/editor need drafts + lapsed carve-out).
--   * Super admins    -> ALL rows (they run /super listing verification).
--   * Everyone else with basic membership -> only published + verified rows.
--
-- No INSERT / UPDATE / moderation-trigger logic is touched; no other policy is
-- weakened.
-- ============================================================================

DROP POLICY IF EXISTS "View full listings with basic access" ON "public"."fiscal_agent_listings";
CREATE POLICY "View full listings with basic access" ON "public"."fiscal_agent_listings"
  FOR SELECT USING (
    (( SELECT "public"."is_admin"() ) AND ("tenant_id" = ( SELECT "public"."current_tenant_id"() )))
    OR ( SELECT "public"."is_super_admin"() )
    OR (
      ( SELECT "public"."has_basic_membership"() )
      AND ("status" = 'published')
      AND ("verification" = 'verified')
    )
  );
