-- ============================================================================
-- TEMPORARY: swap the no-action FKs referencing auth.users to automatic ones
-- (CASCADE for owned rows, SET NULL for nullable history/audit columns), then
-- delete the account by email. Run in the Supabase SQL editor (as postgres).
--
-- Revert the FK changes afterwards with revert_cascade_fks.sql — until then
-- the remote schema drifts from the migrations (db:check will flag it).
-- ============================================================================

BEGIN;

-- Profile row dies with the auth user (unlocks all the public.* cascades)
ALTER TABLE public.users
  DROP CONSTRAINT users_user_id_fkey,
  ADD CONSTRAINT users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_id is NOT NULL here, so rows must be deleted, not nulled
ALTER TABLE public.grant_comments
  DROP CONSTRAINT grant_comments_user_id_fkey,
  ADD CONSTRAINT grant_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- History/audit columns are nullable — keep the rows, null the author
ALTER TABLE public.audit_log
  DROP CONSTRAINT audit_log_changed_by_fkey,
  ADD CONSTRAINT audit_log_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.grant_attachments
  DROP CONSTRAINT grant_attachments_uploaded_by_fkey,
  ADD CONSTRAINT grant_attachments_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.grant_record
  DROP CONSTRAINT grant_record_reviewer_id_fkey,
  ADD CONSTRAINT grant_record_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.grant_status_history
  DROP CONSTRAINT grant_status_history_changed_by_fkey,
  ADD CONSTRAINT grant_status_history_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.invites
  DROP CONSTRAINT invites_created_by_fkey,
  ADD CONSTRAINT invites_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  DROP CONSTRAINT invites_used_by_fkey,
  ADD CONSTRAINT invites_used_by_fkey
    FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;

-- ── Delete the account ──────────────────────────────────────────────────────
-- public.users cascades to billing_customers, grant_record (→ budget items,
-- expenses, receipts, attachments, comments, status history), notifications,
-- receipts, user_memberships, feature_entitlements; fiscal_agent_listings
-- .owner_user_id and sponsorship_inquiries.created_by go SET NULL; the
-- trg_cleanup_user_owned_billing trigger removes user-owned subscription rows.
--
-- If this errors on storage.objects (older projects have objects_owner_fkey
-- with no delete action), first run:
--   UPDATE storage.objects SET owner = NULL
--   WHERE owner = '85df7f8b-85af-49c4-a14b-5c4cf76f8d22';

DELETE FROM auth.users
WHERE lower(email) = 'ryanleo2006@gmail.com';
