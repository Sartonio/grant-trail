-- ==========================================
-- Check which sample users still need Auth accounts
-- Run this BEFORE 05-After-User-Creation.sql
-- to see which users you still need to create
-- in Supabase Dashboard → Authentication → Users
-- ==========================================

-- Users that need Auth accounts created
SELECT
  u.email,
  u.role,
  (SELECT name FROM tenants WHERE id = u.tenant_id) AS tenant,
  CASE
    WHEN u.user_id IS NOT NULL THEN 'Already linked'
    WHEN EXISTS (SELECT 1 FROM auth.users a WHERE a.email = u.email) THEN 'Auth exists — run 05 to link'
    ELSE 'CREATE THIS USER in Auth'
  END AS status
FROM users u
ORDER BY
  CASE
    WHEN u.user_id IS NOT NULL THEN 3
    WHEN EXISTS (SELECT 1 FROM auth.users a WHERE a.email = u.email) THEN 2
    ELSE 1
  END,
  u.tenant_id, u.role;
