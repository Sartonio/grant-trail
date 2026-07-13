-- ============================================================================
-- Revert of delete_account_cascade.sql: restore the original NO ACTION FKs
-- exactly as defined in 20260630130000_squashed_schema.sql, so the remote
-- schema matches the migrations again.
-- ============================================================================

BEGIN;

ALTER TABLE public.users
  DROP CONSTRAINT users_user_id_fkey,
  ADD CONSTRAINT users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.grant_comments
  DROP CONSTRAINT grant_comments_user_id_fkey,
  ADD CONSTRAINT grant_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.audit_log
  DROP CONSTRAINT audit_log_changed_by_fkey,
  ADD CONSTRAINT audit_log_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id);

ALTER TABLE public.grant_attachments
  DROP CONSTRAINT grant_attachments_uploaded_by_fkey,
  ADD CONSTRAINT grant_attachments_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);

ALTER TABLE public.grant_record
  DROP CONSTRAINT grant_record_reviewer_id_fkey,
  ADD CONSTRAINT grant_record_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES auth.users(id);

ALTER TABLE public.grant_status_history
  DROP CONSTRAINT grant_status_history_changed_by_fkey,
  ADD CONSTRAINT grant_status_history_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id);

ALTER TABLE public.invites
  DROP CONSTRAINT invites_created_by_fkey,
  ADD CONSTRAINT invites_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id),
  DROP CONSTRAINT invites_used_by_fkey,
  ADD CONSTRAINT invites_used_by_fkey
    FOREIGN KEY (used_by) REFERENCES auth.users(id);

COMMIT;
