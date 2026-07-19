-- ============================================================================
-- Automatic cascade for auth.users deletion.
--
-- WHY: every FK referencing auth.users was NO ACTION, so `DELETE FROM
-- auth.users` failed on the first referencing row. Deleting an account (mainly
-- a test-account concern, but the same path backs a real GDPR/CCPA erasure
-- request) required hand-swapping the FKs, deleting, then reverting them --
-- see the old root-level delete_account_cascade.sql / revert_cascade_fks.sql.
-- That left the remote schema drifted from the migrations between the two
-- steps, so `db:check` flagged drift for as long as the window was open.
--
-- WHAT: make the delete behaviour declarative and permanent.
--   * CASCADE  where the row IS the user's own record and is meaningless
--              without them (profile, authored comments).
--   * SET NULL where the row is history/audit that must SURVIVE the user --
--              we keep the event, we forget who did it. All these columns are
--              already nullable, so no CHECK/NOT NULL conflict.
--
-- Deliberately NOT cascaded: public.users' own dependents. They already carry
-- correct ON DELETE actions (billing_customers, grant_record, notifications,
-- receipts, user_memberships, feature_entitlements CASCADE; subscriptions,
-- fiscal_agent_listings.managed_by_user_id, sponsorship_inquiries.created_by
-- SET NULL), so dropping the auth.users -> public.users domino is enough to
-- run the whole chain.
--
-- NOTE: this changes only referential ACTIONS, not the referenced columns or
-- keys. No data is read or written; no row is deleted by this migration.
-- ============================================================================

-- ── Owned rows: die with the user ───────────────────────────────────────────

-- The profile row. Dropping this is what unlocks every public.* cascade below.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_user_id_fkey,
  ADD CONSTRAINT users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- grant_comments.user_id is NOT NULL, so the row cannot outlive its author.
-- Admin-authored by design (grantees cannot comment), so this only fires when
-- an admin account is removed.
ALTER TABLE public.grant_comments
  DROP CONSTRAINT IF EXISTS grant_comments_user_id_fkey,
  ADD CONSTRAINT grant_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── History / audit: outlive the user, lose the attribution ─────────────────

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_changed_by_fkey,
  ADD CONSTRAINT audit_log_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.grant_attachments
  DROP CONSTRAINT IF EXISTS grant_attachments_uploaded_by_fkey,
  ADD CONSTRAINT grant_attachments_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- The grant survives; it just no longer names the reviewer who touched it.
ALTER TABLE public.grant_record
  DROP CONSTRAINT IF EXISTS grant_record_reviewer_id_fkey,
  ADD CONSTRAINT grant_record_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.grant_status_history
  DROP CONSTRAINT IF EXISTS grant_status_history_changed_by_fkey,
  ADD CONSTRAINT grant_status_history_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.invites
  DROP CONSTRAINT IF EXISTS invites_created_by_fkey,
  ADD CONSTRAINT invites_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS invites_used_by_fkey,
  ADD CONSTRAINT invites_used_by_fkey
    FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── storage.objects.owner ───────────────────────────────────────────────────
-- Newer Supabase storage schemas ship no FK on objects.owner at all, so there
-- is nothing to relax. Older projects carry objects_owner_fkey as NO ACTION,
-- which would block the delete. Relax it only where it actually exists, and
-- only when we own it -- never create it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'objects_owner_fkey'
      AND conrelid = 'storage.objects'::regclass
      AND confdeltype <> 'n'          -- not already SET NULL
  ) THEN
    ALTER TABLE storage.objects
      DROP CONSTRAINT objects_owner_fkey,
      ADD CONSTRAINT objects_owner_fkey
        FOREIGN KEY (owner) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'skipping storage.objects.owner: not owner of the constraint';
  WHEN undefined_table THEN
    RAISE NOTICE 'skipping storage.objects.owner: storage schema absent';
END $$;
