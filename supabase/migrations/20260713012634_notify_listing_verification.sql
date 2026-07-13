-- ============================================================================
-- Notify a tenant's admins when a super admin decides a Charity Directory
-- listing's verification (verified / rejected).
--
-- WHY:
--   fiscal_agent_listings.verification is staff-controlled — only
--   super_admin / service_role can change it (enforced by
--   trg_enforce_listing_moderation_guard). The owning tenant's admins have no
--   in-app signal when that decision lands, so they don't know to publish a
--   newly-verified listing (or that a rejection needs addressing). This adds an
--   AFTER UPDATE trigger that fans a notification out to the tenant's active
--   admins on a verification transition.
--
-- BEHAVIOR:
--   Fires only on UPDATE when verification actually changes
--   (OLD.verification IS DISTINCT FROM NEW.verification).
--     * verified + published    -> 'listing_verified' : "... is now live ..."
--     * verified + not published -> 'listing_verified' : "... publish it to go live ..."
--     * rejected                 -> 'listing_rejected' : "... was not approved ..."
--     * any other value          -> no notification
--   Recipients: every active admin of NEW.tenant_id (same fan-out loop as
--   notify_grant_submitted). Link for all: '/fiscal-agents/me' (owner dashboard).
--
-- NOTES:
--   * SECURITY DEFINER + pinned search_path, matching the sibling notify_*
--     functions in the squashed baseline (lines ~780-965).
--   * notifications.tenant_id is auto-filled by the BEFORE INSERT trigger
--     trg_set_notifications_tenant_id — this fn does not set it.
--   * No new table, so no RLS changes. Does NOT touch existing policies or the
--     moderation guard. This is a new forward migration; do not edit history.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."notify_listing_verification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  l_name TEXT;
  notif_type TEXT;
  notif_title TEXT;
  notif_message TEXT;
  admin_id INT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.verification IS DISTINCT FROM NEW.verification THEN
    l_name := COALESCE(NEW.name, 'Listing #' || NEW.id::text);

    IF NEW.verification = 'verified' THEN
      notif_type := 'listing_verified';
      notif_title := 'Listing Verified';
      IF NEW.status = 'published' THEN
        notif_message := 'Your listing "' || l_name || '" has been verified and is now live in the Charity Directory.';
      ELSE
        notif_message := 'Your listing "' || l_name || '" has been verified — publish it to go live in the Charity Directory.';
      END IF;
    ELSIF NEW.verification = 'rejected' THEN
      notif_type := 'listing_rejected';
      notif_title := 'Listing Not Approved';
      notif_message := 'Your listing "' || l_name || '" was not approved for the Charity Directory.';
    ELSE
      -- e.g. reset to 'pending' — no notification
      RETURN NEW;
    END IF;

    FOR admin_id IN SELECT id FROM users WHERE role = 'admin' AND is_active = true AND tenant_id = NEW.tenant_id LOOP
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (admin_id, notif_type, notif_title, notif_message, '/fiscal-agents/me');
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_listing_verification"() OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."notify_listing_verification"() TO "service_role";
GRANT ALL ON FUNCTION "public"."notify_listing_verification"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_listing_verification"() TO "authenticated";


DROP TRIGGER IF EXISTS "trg_notify_listing_verification" ON "public"."fiscal_agent_listings";
CREATE TRIGGER "trg_notify_listing_verification"
  AFTER UPDATE ON "public"."fiscal_agent_listings"
  FOR EACH ROW EXECUTE FUNCTION "public"."notify_listing_verification"();
