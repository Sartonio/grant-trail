BEGIN;

-- 1) Tenant-scoped tables pinning auth.users (won't cascade; tenants kept).
DELETE FROM public.audit_log;
DELETE FROM public.invites;

-- 2) Profile rows — cascades to subscriptions, memberships, entitlements,
--    billing_customers, notifications, receipts, grant_record -> budget_items,
--    expenses, receipts, grant_status_history, grant_comments, grant_attachments.
--    SET NULL on fiscal_agent_listings.owner_user_id + sponsorship_inquiries.created_by.
DELETE FROM public.users;

-- 3) Auth identities — cascades to auth.identities/sessions/refresh_tokens/mfa_*.
DELETE FROM auth.users;

-- VERIFY — should all be 0:
SELECT
  (SELECT count(*) FROM auth.users)   AS auth_users,
  (SELECT count(*) FROM public.users) AS public_users;

COMMIT;
