-- NOTE: user_id (UUID) is left NULL because
-- these are not real Supabase Auth accounts.
-- Link them to real auth users after signup.
-- ==========================================

-- run after creating the users via the Supabase Authentication UI
update users set user_id = (select id from auth.users where email = 'maria.smith@example.com') where email = 'maria.smith@example.com';
update users set user_id = (select id from auth.users where email = 'jacob.soto@example.com') where email = 'jacob.soto@example.com';
update users set user_id = (select id from auth.users where email = 'faizan.sharp@example.com') where email = 'faizan.sharp@example.com';
update users set user_id = (select id from auth.users where email = 'eric.hobbs@example.com') where email = 'eric.hobbs@example.com';
update users set user_id = (select id from auth.users where email = 'sam.reeves@example.com') where email = 'sam.reeves@example.com';
update users set user_id = (select id from auth.users where email = 'alex.tan@example.com') where email = 'alex.tan@example.com';

-- Bright Horizons (managed tenant #2)
update users set user_id = (select id from auth.users where email = 'priya.sharma@example.com') where email = 'priya.sharma@example.com';
update users set user_id = (select id from auth.users where email = 'david.chen@example.com') where email = 'david.chen@example.com';
update users set user_id = (select id from auth.users where email = 'amara.okafor@example.com') where email = 'amara.okafor@example.com';

-- Self-service tenants
update users set user_id = (select id from auth.users where email = 'carlos.lopez@example.com') where email = 'carlos.lopez@example.com';
update users set user_id = (select id from auth.users where email = 'nadia.park@example.com') where email = 'nadia.park@example.com';

-- ==========================================
-- SECTION 2: ADMIN COMMENTS
-- Comments from Eric (admin) on reviewed grants.
-- Looks up his auth UUID from auth.users by email.
-- ==========================================

INSERT INTO grant_comments (grant_id, user_id, comment)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Technology Access Grant'),
   (SELECT id FROM auth.users WHERE email = 'eric.hobbs@example.com'),
   'Your application shows real potential. Please resubmit with a confirmed list of internet providers and a detailed distribution schedule by postal code.'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Mental Health Awareness Campaign'),
   (SELECT id FROM auth.users WHERE email = 'eric.hobbs@example.com'),
   'We encourage you to revise your budget to stay within the 30% marketing cap and reapply in the next funding cycle with SMART outcome metrics.');

