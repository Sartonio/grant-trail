-- ==========================================
-- FULL TEARDOWN — Safe to run in any state
-- Drops all TFAC tables, functions, and
-- storage config so you can start fresh.
-- ==========================================
-- IF EXISTS on everything means this is safe
-- to run even on a partially-set-up database.
-- ==========================================

-- Realtime (remove before dropping table)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE notifications;
  END IF;
END $$;

-- Billing tables
DROP TABLE IF EXISTS user_memberships       CASCADE;
DROP TABLE IF EXISTS subscriptions          CASCADE;
DROP TABLE IF EXISTS billing_customers      CASCADE;
DROP TABLE IF EXISTS billing_webhook_events CASCADE;

-- Tables (CASCADE drops all dependent FK constraints and policies automatically)
-- Drop in reverse dependency order
DROP TABLE IF EXISTS notifications         CASCADE;
DROP TABLE IF EXISTS grant_comments        CASCADE;
DROP TABLE IF EXISTS grant_status_history  CASCADE;
DROP TABLE IF EXISTS audit_log             CASCADE;
DROP TABLE IF EXISTS grant_attachments     CASCADE;
DROP TABLE IF EXISTS receipts              CASCADE;
DROP TABLE IF EXISTS expenses              CASCADE;
DROP TABLE IF EXISTS budget_items          CASCADE;
DROP TABLE IF EXISTS grant_record          CASCADE;
DROP TABLE IF EXISTS users                 CASCADE;
DROP TABLE IF EXISTS invites               CASCADE;
DROP TABLE IF EXISTS platform_settings     CASCADE;
DROP TABLE IF EXISTS tenant_settings       CASCADE;
DROP TABLE IF EXISTS tenants               CASCADE;

-- Functions (CASCADE drops any triggers that depend on them)
DROP FUNCTION IF EXISTS set_updated_at()                    CASCADE;
DROP FUNCTION IF EXISTS set_grant_tenant_id()               CASCADE;
DROP FUNCTION IF EXISTS set_tenant_from_grant()             CASCADE;
DROP FUNCTION IF EXISTS set_notification_tenant_id()        CASCADE;
DROP FUNCTION IF EXISTS set_audit_log_tenant_id()           CASCADE;
DROP FUNCTION IF EXISTS auto_approve_grant()                CASCADE;
DROP FUNCTION IF EXISTS auto_approve_budget_item()          CASCADE;
DROP FUNCTION IF EXISTS auto_approve_expense()              CASCADE;
DROP FUNCTION IF EXISTS enforce_self_service_role()         CASCADE;
DROP FUNCTION IF EXISTS provision_self_service_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INT) CASCADE;
DROP FUNCTION IF EXISTS update_grant_record_totals()        CASCADE;
DROP FUNCTION IF EXISTS update_grant_remaining_balance()    CASCADE;
DROP FUNCTION IF EXISTS update_budget_item_totals()         CASCADE;
DROP FUNCTION IF EXISTS log_grant_status_change()           CASCADE;
DROP FUNCTION IF EXISTS log_grant_record_changes()          CASCADE;
DROP FUNCTION IF EXISTS log_expenses_changes()              CASCADE;
DROP FUNCTION IF EXISTS log_budget_items_changes()          CASCADE;
DROP FUNCTION IF EXISTS log_users_changes()                 CASCADE;
DROP FUNCTION IF EXISTS current_tenant_id()                 CASCADE;
DROP FUNCTION IF EXISTS is_admin()                          CASCADE;
DROP FUNCTION IF EXISTS is_super_admin()                    CASCADE;
DROP FUNCTION IF EXISTS calculate_grant_budget_totals(INT)  CASCADE;
DROP FUNCTION IF EXISTS get_grant_owner(INT)                CASCADE;
DROP FUNCTION IF EXISTS get_admin_user_ids()                CASCADE;
DROP FUNCTION IF EXISTS get_grant_name(INT)                 CASCADE;
DROP FUNCTION IF EXISTS notify_grant_status_change()        CASCADE;
DROP FUNCTION IF EXISTS notify_grant_submitted()            CASCADE;
DROP FUNCTION IF EXISTS notify_budget_item_status()         CASCADE;
DROP FUNCTION IF EXISTS notify_expense_status()             CASCADE;
DROP FUNCTION IF EXISTS notify_grant_comment()              CASCADE;

-- Billing functions
DROP FUNCTION IF EXISTS set_billing_updated_at()                    CASCADE;
DROP FUNCTION IF EXISTS enforce_subscription_tier_product_match()   CASCADE;
DROP FUNCTION IF EXISTS enforce_membership_eligibility()            CASCADE;
DROP FUNCTION IF EXISTS is_membership_exempt()                      CASCADE;
DROP FUNCTION IF EXISTS is_membership_exempt(INT)                   CASCADE;
DROP FUNCTION IF EXISTS has_basic_membership()                      CASCADE;
DROP FUNCTION IF EXISTS has_basic_membership(INT)                   CASCADE;
DROP FUNCTION IF EXISTS has_premium_membership()                    CASCADE;
DROP FUNCTION IF EXISTS has_premium_membership(INT)                 CASCADE;

-- Storage policies — receipts bucket
DROP POLICY IF EXISTS "Users can upload receipts"              ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own receipts"      ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own receipts"    ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all receipts in storage" ON storage.objects;

-- Storage policies — grant-documents bucket
DROP POLICY IF EXISTS "Users can upload grant documents"           ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own grant documents"   ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own grant documents"  ON storage.objects;
DROP POLICY IF EXISTS "Admins can view all grant documents"        ON storage.objects;

-- Storage bucket contents — must be done manually via Dashboard
-- (SQL editor does not allow DELETE from storage.objects/buckets)
-- Steps:
--   1. Supabase Dashboard → Storage → receipts → select all → delete
--   2. Supabase Dashboard → Storage → grant-documents → select all → delete
--   3. Then delete the buckets themselves if desired

-- Verify everything is gone
SELECT schemaname, tablename, policyname, cmd AS operation
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- If any policies remain, drop them individually:
-- DROP POLICY IF EXISTS "policy name here" ON table_name;
-- DROP POLICY IF EXISTS "policy name here" ON storage.objects;
