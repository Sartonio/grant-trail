-- ============================================================
--  STAGING USER WIPE — GrantTrail
-- ============================================================
--  Removes all user accounts + user-generated data from a
--  NON-PRODUCTION database, so testers can start from a clean
--  signup slate without re-provisioning tenants.
--
--  KEEPS:   tenants, tenant_settings, platform_settings,
--           fiscal_agent_listings (owner_user_id -> NULL),
--           sponsorship_inquiries (created_by -> NULL).
--  REMOVES: auth.users + public.users and everything that
--           cascades from them (subscriptions, memberships,
--           entitlements, billing_customers, notifications,
--           receipts, grant_record -> budget_items, expenses,
--           receipts, grant_status_history, grant_comments,
--           grant_attachments), plus audit_log and invites.
--
--  This is NOT a migration. It lives outside supabase/migrations/
--  on purpose so it never runs during `db:reset`. Run it by hand
--  as the `postgres`/owner role (e.g. Supabase Studio SQL editor).
--  RLS is bypassed for the owner; this schema has no FORCE RLS.
--
--  Nothing is permanent until COMMIT — inspect the verify output,
--  then COMMIT or ROLLBACK.
-- ============================================================
BEGIN;

-- ---- SAFETY GUARD: refuse to run on a prod-looking DB --------
-- Adjust the pattern if your staging database name differs.
DO $$
BEGIN
  IF current_database() !~* '(staging|stage|dev|local|test)' THEN
    RAISE EXCEPTION
      'Refusing to wipe: database "%" does not look like staging. '
      'Edit the guard in this script if you are sure.', current_database();
  END IF;
END $$;

-- 1) Tenant-scoped tables that pin auth.users but survive the wipe
--    (we are keeping tenants, so these do NOT cascade). Left in place
--    they would block DELETE FROM auth.users via NO ACTION FKs:
--      audit_log.changed_by, invites.created_by, invites.used_by.
DELETE FROM public.audit_log;
DELETE FROM public.invites;

-- 2) Profile rows. CASCADES to subscriptions, user_memberships,
--    feature_entitlements, billing_customers, notifications, receipts,
--    grant_record -> budget_items, expenses, receipts,
--    grant_status_history, grant_comments, grant_attachments.
--    SET NULL on fiscal_agent_listings.owner_user_id and
--    sponsorship_inquiries.created_by (listings/inquiries preserved).
DELETE FROM public.users;

-- 3) Auth identities. Cascades within the auth schema (identities,
--    sessions, refresh_tokens, mfa_*, one_time_tokens).
DELETE FROM auth.users;

-- ---- VERIFY: these should all be 0 ---------------------------
SELECT
  (SELECT count(*) FROM auth.users)              AS auth_users,
  (SELECT count(*) FROM public.users)            AS public_users,
  (SELECT count(*) FROM public.subscriptions)    AS subscriptions,
  (SELECT count(*) FROM public.user_memberships) AS memberships,
  (SELECT count(*) FROM public.grant_record)     AS grants,
  (SELECT count(*) FROM public.audit_log)        AS audit_log,
  (SELECT count(*) FROM public.invites)          AS invites;

-- ---- VERIFY: preserved data (non-zero if you had it) ---------
SELECT
  (SELECT count(*) FROM public.tenants)               AS tenants_kept,
  (SELECT count(*) FROM public.fiscal_agent_listings) AS listings_kept;

-- Inspect the two result sets above, then finish with one of:
COMMIT;      -- keep the wipe
-- ROLLBACK; -- undo everything (comment out COMMIT above first)
