-- ==========================================
-- PRODUCTION SETUP
-- ==========================================
-- Run AFTER 01-Complete-Fresh-Setup.sql
-- Do NOT run any other sample data scripts (02, 03, 05, 06)
--
-- This script bootstraps the minimum data needed
-- for a production deployment:
--   1. The first managed tenant
--   2. A super_admin user (after Auth account is created)
--
-- After running this script:
--   1. Create a super_admin Auth account in Supabase Dashboard
--      (Authentication → Users → Add User)
--   2. Run the UPDATE below to link the Auth UUID
--   3. Log in as super_admin → create tenants → share invite links
-- ==========================================


-- ==========================================
-- STEP 1: Create the first tenant
-- ==========================================

-- slug: a short, URL-safe identifier for the tenant (lowercase, no spaces, hyphens only).
-- Used internally as a unique key. Not shown to end users.
INSERT INTO tenants (name, slug, tenant_type)
VALUES ('The Family Advocates Canada', 'tfac', 'managed'); -- ← if slug is changed here, ensure it is updated below also to match

INSERT INTO tenant_settings (tenant_id)
VALUES ((SELECT id FROM tenants WHERE slug = 'tfac')); -- ← ensure this matches the slug from the previous query


-- ==========================================
-- STEP 2: Create the super_admin user
-- ==========================================
-- Replace the email and name below with
-- the actual super admin's details.

INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, role)
VALUES (
  (SELECT id FROM tenants WHERE slug = 'tfac'), -- ← change to actual slug from previous query
  'Sam',                              -- ← change to actual first name
  'Reeves',                           -- ← change to actual last name
  'The Family Advocates Canada',      -- ← change to actual org name
  'sam.reeves@example.com',           -- ← change to actual email
  '312-555-0105',                     -- ← change to actual phone
  'super_admin'
);


-- ==========================================
-- STEP 3: Link Auth UUID
-- ==========================================
-- a. Create the new user listed above in Supabase Dashboard → Authentication → Users.
------ From Supabase, you can either send an invite to the email address or set a temporary 
------ password and share it securely with the super admin. 
------ If you send an invite, you MUST wait till the super admin accepts the invite and creates 
------ their account before running the UPDATE statement below, as you need the Auth UUID to link 
------ the accounts. If you set a temporary password, the user is immediately created in Supabase, 
------ and you can run the below UPDATE statement right away. 

-- b. Then run this UPDATE statement
-- c. Ensure the email below matches the one in step 2 above and the one used in #a.

-- UPDATE users
-- SET user_id = (SELECT id FROM auth.users WHERE email = 'sam.reeves@example.com')
-- WHERE email = 'sam.reeves@example.com';


-- ==========================================
-- OPTIONAL: TRAINING TENANT
-- ==========================================
-- To let staff explore the system before going live,
-- create a "Training" tenant from the super admin UI:
--
--   1. Log in as super_admin → /super/tenants
--   2. Click Create Tenant → name it "Training" → enter a real admin email
--   3. Share the invite link with staff who need to test
--   4. They sign up with real emails (email verification works normally)
--   5. Staff can create grants, expenses, etc. without affecting real data
--   6. When done, disable or delete the Training tenant
--
-- This approach avoids fake email issues and tests the full onboarding flow.


-- ==========================================
-- VERIFICATION
-- ==========================================

SELECT
  t.name AS tenant,
  u.firstname || ' ' || u.lastname AS super_admin,
  u.email,
  u.role,
  CASE WHEN u.user_id IS NOT NULL THEN 'Linked' ELSE 'NOT LINKED — create Auth account and run Step 3' END AS auth_status
FROM users u
JOIN tenants t ON t.id = u.tenant_id
WHERE u.role = 'super_admin';
