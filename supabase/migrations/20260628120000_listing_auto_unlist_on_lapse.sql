-- ============================================================================
-- Charity Directory — auto-unlist on premium lapse (TASK A5)
-- ============================================================================
-- When a charity's premium ("Fiscal Agents Plan") subscription lapses
-- (Stripe status past_due / canceled / unpaid) the stripe-webhook demotes the
-- owner's PUBLISHED listing to a new 'unlisted' state, so it falls out of the
-- public teaser view (which keys on status = 'published'). Re-subscribing
-- (status active/trialing) restores 'unlisted' -> 'published'. Data is never
-- deleted; only the status flips, and only between these two states.
--
-- 'unlisted' is distinct from the super_admin-controlled 'hidden' moderation
-- state on purpose: it marks a publish that was auto-suspended for non-payment
-- and is the ONLY state the webhook flips back to 'published' on reactivation.
-- The status flip is performed by the service role (webhook), which bypasses
-- RLS and the moderation guard, so no owner entitlement is required to demote
-- or restore.
-- ============================================================================

ALTER TABLE "public"."fiscal_agent_listings"
  DROP CONSTRAINT IF EXISTS "fiscal_agent_listings_status_check";

ALTER TABLE "public"."fiscal_agent_listings"
  ADD CONSTRAINT "fiscal_agent_listings_status_check"
  CHECK ((("status")::"text" = ANY ((ARRAY[
    'draft'::character varying,
    'published'::character varying,
    'unlisted'::character varying,
    'hidden'::character varying
  ])::"text"[])));
