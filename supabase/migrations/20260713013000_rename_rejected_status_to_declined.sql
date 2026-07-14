-- ============================================================================
-- Rename the status VALUE 'rejected' -> 'declined' for four columns.
--
-- WHAT:
--   * grant_record.status
--   * budget_items.status
--   * expenses.status
--   * fiscal_agent_listings.verification
--   The stored enum-like value 'rejected' becomes 'declined' across data,
--   CHECK constraints, and the SECURITY DEFINER notification triggers that
--   branch on that value. sponsorship_inquiries already uses 'declined' and is
--   deliberately untouched.
--
-- WHY:
--   Product renamed the review outcome from "rejected" to "declined" for a
--   softer tone. RLS/constraints are the enforcement boundary, so the value
--   must be migrated at the DB layer: existing rows updated, the CHECK
--   constraints re-enumerated (drop + re-add with 'declined' substituted for
--   'rejected', all other allowed values identical), and the trigger functions
--   that compare NEW.status / NEW.verification to the old value recreated.
--
-- SCOPE / WHAT IS NOT CHANGED:
--   * Column DEFAULTs are 'pending' / 'draft' — none default to 'rejected', so
--     no default changes are needed.
--   * notification `type` string values ('grant_rejected', 'budget_rejected',
--     'expense_rejected', 'listing_rejected') and human-facing titles/messages
--     are NOT one of the four status columns and are left as-is to avoid
--     breaking frontend notification-type handling and test assertions.
--   * grant_status_history.old_status / new_status have NO CHECK constraint but
--     mirror grant_record.status; its historical rows are migrated for
--     consistency (no constraint to alter).
--   * This is a new forward migration; historical migrations are the immutable
--     baseline and are not edited.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. grant_record.status
-- ----------------------------------------------------------------------------
UPDATE public.grant_record SET status = 'declined' WHERE status = 'rejected';

ALTER TABLE public.grant_record DROP CONSTRAINT IF EXISTS grant_record_status_check;
ALTER TABLE public.grant_record
  ADD CONSTRAINT grant_record_status_check
  CHECK (((status)::text = ANY (ARRAY[
    ('pending'::character varying)::text,
    ('approved'::character varying)::text,
    ('needs_changes'::character varying)::text,
    ('declined'::character varying)::text
  ])));

-- ----------------------------------------------------------------------------
-- 2. budget_items.status
-- ----------------------------------------------------------------------------
UPDATE public.budget_items SET status = 'declined' WHERE status = 'rejected';

ALTER TABLE public.budget_items DROP CONSTRAINT IF EXISTS budget_items_status_check;
ALTER TABLE public.budget_items
  ADD CONSTRAINT budget_items_status_check
  CHECK (((status)::text = ANY (ARRAY[
    ('pending'::character varying)::text,
    ('approved'::character varying)::text,
    ('declined'::character varying)::text
  ])));

-- ----------------------------------------------------------------------------
-- 3. expenses.status
-- ----------------------------------------------------------------------------
UPDATE public.expenses SET status = 'declined' WHERE status = 'rejected';

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_status_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (((status)::text = ANY (ARRAY[
    ('pending'::character varying)::text,
    ('approved'::character varying)::text,
    ('declined'::character varying)::text
  ])));

-- ----------------------------------------------------------------------------
-- 4. fiscal_agent_listings.verification
-- ----------------------------------------------------------------------------
UPDATE public.fiscal_agent_listings SET verification = 'declined' WHERE verification = 'rejected';

ALTER TABLE public.fiscal_agent_listings DROP CONSTRAINT IF EXISTS fiscal_agent_listings_verification_check;
ALTER TABLE public.fiscal_agent_listings
  ADD CONSTRAINT fiscal_agent_listings_verification_check
  CHECK (((verification)::text = ANY (ARRAY[
    ('pending'::character varying)::text,
    ('verified'::character varying)::text,
    ('declined'::character varying)::text
  ])));

-- ----------------------------------------------------------------------------
-- 5. grant_status_history (no CHECK constraint; migrate data for consistency)
-- ----------------------------------------------------------------------------
UPDATE public.grant_status_history SET old_status = 'declined' WHERE old_status = 'rejected';
UPDATE public.grant_status_history SET new_status = 'declined' WHERE new_status = 'rejected';

-- ----------------------------------------------------------------------------
-- 6. Notification triggers that branch on the migrated status/verification
--    value. Recreated verbatim from the baseline except the value comparison
--    'rejected' -> 'declined'. notif_type / titles / messages are intentionally
--    left unchanged (see header).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_budget_item_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  grant_owner INT;
  g_name TEXT;
  notif_title TEXT;
  notif_message TEXT;
  notif_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    grant_owner := get_grant_owner(NEW.grant_id);
    g_name := get_grant_name(NEW.grant_id);

    IF NEW.status = 'approved' THEN
      notif_type := 'budget_approved';
      notif_title := 'Budget Item Approved';
      notif_message := 'Budget item "' || COALESCE(NEW.item_name, 'Item #' || NEW.id::text) || '" for grant "' || g_name || '" has been approved.';
    ELSIF NEW.status = 'declined' THEN
      notif_type := 'budget_rejected';
      notif_title := 'Budget Item Declined';
      notif_message := 'Budget item "' || COALESCE(NEW.item_name, 'Item #' || NEW.id::text) || '" for grant "' || g_name || '" has been declined.';
    ELSE
      RETURN NEW;
    END IF;

    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (grant_owner, notif_type, notif_title, notif_message, '/grants/' || NEW.grant_id || '/breakdown');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_expense_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $_$
DECLARE
  grant_owner INT;
  g_name TEXT;
  notif_title TEXT;
  notif_message TEXT;
  notif_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    grant_owner := get_grant_owner(NEW.grant_id);
    g_name := get_grant_name(NEW.grant_id);

    IF NEW.status = 'approved' THEN
      notif_type := 'expense_approved';
      notif_title := 'Expense Approved';
      notif_message := 'Expense "' || COALESCE(NEW.item_name, 'Expense #' || NEW.id::text) || '" ($' || NEW.amount_spent::text || ') for grant "' || g_name || '" has been approved.';
    ELSIF NEW.status = 'declined' THEN
      notif_type := 'expense_rejected';
      notif_title := 'Expense Declined';
      notif_message := 'Expense "' || COALESCE(NEW.item_name, 'Expense #' || NEW.id::text) || '" ($' || NEW.amount_spent::text || ') for grant "' || g_name || '" has been declined.';
    ELSE
      RETURN NEW;
    END IF;

    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (grant_owner, notif_type, notif_title, notif_message, '/grants/' || NEW.grant_id || '/breakdown');
  END IF;

  RETURN NEW;
END;
$_$;

CREATE OR REPLACE FUNCTION public.notify_grant_status_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  grant_owner INT;
  g_name TEXT;
  notif_title TEXT;
  notif_message TEXT;
  notif_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    grant_owner := NEW.user_id;
    g_name := COALESCE(NEW.grant_name, 'Grant #' || NEW.id::text);

    IF NEW.status = 'approved' THEN
      notif_type := 'grant_approved';
      notif_title := 'Grant Approved';
      notif_message := 'Your grant "' || g_name || '" has been approved.';
    ELSIF NEW.status = 'declined' THEN
      notif_type := 'grant_rejected';
      notif_title := 'Grant Declined';
      notif_message := 'Your grant "' || g_name || '" has been declined.';
    ELSIF NEW.status = 'needs_changes' THEN
      notif_type := 'grant_needs_changes';
      notif_title := 'Changes Requested';
      notif_message := 'Your grant "' || g_name || '" requires changes. Please review and resubmit.';
    ELSIF NEW.status = 'pending' AND OLD.status = 'needs_changes' THEN
      PERFORM NULL;  -- handled by notify_grant_submitted trigger
      RETURN NEW;
    END IF;

    IF notif_type IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (grant_owner, notif_type, notif_title, notif_message, '/grants/' || NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_listing_verification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
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
    ELSIF NEW.verification = 'declined' THEN
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

COMMIT;
