-- ==========================================
-- TFAC GRANT MANAGEMENT SYSTEM
-- Sample Data (Development / Testing)
-- ==========================================
-- Run AFTER 01-Complete-Fresh-Setup.sql
-- Then run 05-After-User-Creation.sql once
-- real Supabase Auth accounts have been created.
--


-- ==========================================
-- SECTION 1: TENANT
-- ==========================================

INSERT INTO tenants (name, slug, tenant_type) VALUES
  ('The Family Advocates Canada', 'tfac', 'managed'),
  ('Bright Horizons Foundation', 'bright-horizons', 'managed'),
  ('Lopez Consulting', 'lopez-consulting', 'self_service'),
  ('Greenleaf Bookkeeping', 'greenleaf', 'self_service');

INSERT INTO tenant_settings (tenant_id) VALUES
  ((SELECT id FROM tenants WHERE slug = 'tfac')),
  ((SELECT id FROM tenants WHERE slug = 'bright-horizons'));

INSERT INTO tenant_settings (tenant_id, require_grant_approval, require_budget_approval, require_expense_approval) VALUES
  ((SELECT id FROM tenants WHERE slug = 'lopez-consulting'), false, false, false),
  ((SELECT id FROM tenants WHERE slug = 'greenleaf'), false, false, false);


-- ==========================================
-- SECTION 2: USERS
-- ==========================================

INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, role, tax_month) VALUES
  ((SELECT id FROM tenants WHERE slug = 'tfac'), 'Maria',  'Smith', 'Helping Hands',               'maria.smith@example.com',  '212-555-0101', 'grantee', 5),
  ((SELECT id FROM tenants WHERE slug = 'tfac'), 'Jacob',  'Soto',  'Bright Future Org',            'jacob.soto@example.com',   '305-555-0102', 'grantee', 6),
  ((SELECT id FROM tenants WHERE slug = 'tfac'), 'Faizan', 'Sharp', 'Hope Foundation',              'faizan.sharp@example.com', '404-555-0103', 'grantee', 5),
  ((SELECT id FROM tenants WHERE slug = 'tfac'), 'Eric',   'Hobbs', 'The Family Advocates Canada',  'eric.hobbs@example.com',   '312-555-0104', 'admin',   NULL),
  ((SELECT id FROM tenants WHERE slug = 'tfac'), 'Sam',    'Reeves','The Family Advocates Canada',  'sam.reeves@example.com',   '312-555-0105', 'super_admin', NULL);

-- Bright Horizons Foundation (managed tenant #2)
INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, role, tax_month) VALUES
  ((SELECT id FROM tenants WHERE slug = 'bright-horizons'), 'Priya',   'Sharma',  'Bright Horizons Foundation', 'priya.sharma@example.com',   '416-555-0201', 'grantee', 4),
  ((SELECT id FROM tenants WHERE slug = 'bright-horizons'), 'David',   'Chen',    'Bright Horizons Foundation', 'david.chen@example.com',     '416-555-0202', 'grantee', 4),
  ((SELECT id FROM tenants WHERE slug = 'bright-horizons'), 'Amara',   'Okafor',  'Bright Horizons Foundation', 'amara.okafor@example.com',   '416-555-0203', 'admin',   NULL);

-- Self-service tenants (one user each, auto-approved)
INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, role, tax_month) VALUES
  ((SELECT id FROM tenants WHERE slug = 'lopez-consulting'), 'Carlos', 'Lopez',   'Lopez Consulting',           'carlos.lopez@example.com',   '647-555-0301', 'grantee', 3),
  ((SELECT id FROM tenants WHERE slug = 'greenleaf'),        'Nadia',  'Park',    'Greenleaf Bookkeeping',      'nadia.park@example.com',     '905-555-0401', 'grantee', 9);


-- ==========================================
-- SECTION 3: GRANTS
-- All inserted as 'pending' first so the
-- status trigger records a clean history.
-- ==========================================

INSERT INTO grant_record (user_id, grant_name, description, start_spend_period, end_spend_period, release_date, grant_amount, status, submitted_at)
VALUES

  -- Maria Smith — 2 grants
  ((SELECT id FROM users WHERE email = 'maria.smith@example.com'),
   'Community Outreach Program 2024',
   'Funding for community outreach activities serving low-income families in the Greater Toronto Area.',
   '2024-01-01', '2024-12-31', '2024-01-15', 25000.00, 'pending', '2023-11-15'),

  ((SELECT id FROM users WHERE email = 'maria.smith@example.com'),
   'Youth Education Initiative',
   'After-school tutoring and mentorship program for at-risk youth aged 12–18.',
   '2024-06-01', '2025-05-31', NULL, 15000.00, 'pending', '2024-05-01'),

  -- Jacob Soto — 2 grants
  ((SELECT id FROM users WHERE email = 'jacob.soto@example.com'),
   'After-School Program Funding',
   'Structured after-school activities including arts, sports, and academic support for elementary students.',
   '2024-01-01', '2024-12-31', '2024-01-20', 20000.00, 'pending', '2023-11-20'),

  ((SELECT id FROM users WHERE email = 'jacob.soto@example.com'),
   'Technology Access Grant',
   'Providing refurbished laptops and internet access to underserved households.',
   '2024-03-01', '2024-08-31', NULL, 8500.00, 'pending', '2024-02-10'),

  -- Faizan Sharp — 2 grants
  ((SELECT id FROM users WHERE email = 'faizan.sharp@example.com'),
   'Mental Health Awareness Campaign',
   'Public awareness campaign and free workshops on mental health resources in the community.',
   '2024-04-01', '2024-09-30', NULL, 12000.00, 'pending', '2024-03-01'),

  ((SELECT id FROM users WHERE email = 'faizan.sharp@example.com'),
   'Food Security Initiative',
   'Monthly food bank restocking and volunteer coordination to address food insecurity.',
   '2024-01-01', '2024-12-31', '2024-01-10', 30000.00, 'pending', '2023-12-01');

-- Bright Horizons — Priya Sharma (2 grants)
INSERT INTO grant_record (user_id, grant_name, description, start_spend_period, end_spend_period, release_date, grant_amount, status, submitted_at)
VALUES
  ((SELECT id FROM users WHERE email = 'priya.sharma@example.com'),
   'Women in STEM Scholarship',
   'Scholarships and mentorship for women pursuing STEM education in underserved communities.',
   '2025-01-01', '2025-12-31', NULL, 18000.00, 'pending', '2024-11-15'),

  ((SELECT id FROM users WHERE email = 'priya.sharma@example.com'),
   'Newcomer Language Program',
   'English and French language classes for new immigrants to support workforce integration.',
   '2025-03-01', '2025-09-30', '2025-03-15', 12000.00, 'pending', '2025-02-01');

-- Bright Horizons — David Chen (1 grant)
INSERT INTO grant_record (user_id, grant_name, description, start_spend_period, end_spend_period, release_date, grant_amount, status, submitted_at)
VALUES
  ((SELECT id FROM users WHERE email = 'david.chen@example.com'),
   'Youth Arts Initiative',
   'Art workshops and exhibitions for youth aged 14-21 in the Greater Toronto Area.',
   '2025-04-01', '2026-03-31', NULL, 22000.00, 'pending', '2025-03-10');

-- Carlos Lopez — self-service (auto-approved, 1 grant)
INSERT INTO grant_record (user_id, grant_name, description, start_spend_period, end_spend_period, release_date, grant_amount, status, submitted_at)
VALUES
  ((SELECT id FROM users WHERE email = 'carlos.lopez@example.com'),
   'Client Project Tracking Q1',
   'Tracking expenses for consulting engagement with Maple Corp.',
   '2026-01-01', '2026-03-31', '2026-01-05', 45000.00, 'pending', '2026-01-02');

-- Nadia Park — self-service (auto-approved, 1 grant)
INSERT INTO grant_record (user_id, grant_name, description, start_spend_period, end_spend_period, release_date, grant_amount, status, submitted_at)
VALUES
  ((SELECT id FROM users WHERE email = 'nadia.park@example.com'),
   'Annual Operating Budget 2026',
   'Tracking all operating expenses for Greenleaf Bookkeeping.',
   '2026-01-01', '2026-12-31', '2026-01-01', 60000.00, 'pending', '2025-12-20');


-- ==========================================
-- SECTION 4: FINALIZE GRANT STATUSES
-- Updating status triggers automatic entries
-- in grant_status_history.
-- ==========================================

UPDATE grant_record
SET status = 'approved',
    reviewed_at = '2023-12-01',
    approval_notes = 'Strong application with clear community impact. Approved.'
WHERE grant_name = 'Community Outreach Program 2024';

UPDATE grant_record
SET status = 'approved',
    reviewed_at = '2024-01-05',
    approval_notes = 'Well-structured program with measurable outcomes. Approved.'
WHERE grant_name = 'After-School Program Funding';

UPDATE grant_record
SET status = 'needs_changes',
    reviewed_at = '2024-02-20',
    approval_notes = 'Please provide a more detailed device distribution plan and confirm internet provider partnerships before resubmitting.'
WHERE grant_name = 'Technology Access Grant';

UPDATE grant_record
SET status = 'rejected',
    reviewed_at = '2024-03-15',
    approval_notes = 'Marketing budget exceeds program guidelines. Insufficient detail on measurable outcomes. Unable to approve at this time.'
WHERE grant_name = 'Mental Health Awareness Campaign';

UPDATE grant_record
SET status = 'approved',
    reviewed_at = '2024-01-05',
    approval_notes = 'Critical community need with an excellent volunteer coordination plan. Approved.'
WHERE grant_name = 'Food Security Initiative';

-- Youth Education Initiative remains 'pending'

-- Bright Horizons grants
UPDATE grant_record
SET status = 'approved',
    reviewed_at = '2025-03-20',
    approval_notes = 'Excellent program with clear impact metrics. Approved.'
WHERE grant_name = 'Newcomer Language Program';

-- Women in STEM Scholarship and Youth Arts Initiative remain 'pending'

-- Self-service grants (Carlos, Nadia) should already be auto-approved
-- by the trg_zz_auto_approve_grant trigger since their tenant_settings
-- have require_grant_approval = false


-- ==========================================
-- SECTION 5: BUDGET ITEMS
-- ==========================================

-- Maria — Community Outreach Program 2024
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Staff Salaries',      'Program coordinator and part-time staff',            12000.00 FROM grant_record WHERE grant_name = 'Community Outreach Program 2024' UNION ALL
SELECT id, 'Community Events',    'Hosting costs for community events and workshops',    8000.00  FROM grant_record WHERE grant_name = 'Community Outreach Program 2024' UNION ALL
SELECT id, 'Administrative',      'Office supplies, software, and operational expenses', 5000.00  FROM grant_record WHERE grant_name = 'Community Outreach Program 2024';

-- Maria — Youth Education Initiative
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Educational Materials', 'Textbooks, workbooks, and learning supplies',       6000.00 FROM grant_record WHERE grant_name = 'Youth Education Initiative' UNION ALL
SELECT id, 'Tutor Stipends',        'Compensation for volunteer tutors and mentors',     7000.00 FROM grant_record WHERE grant_name = 'Youth Education Initiative' UNION ALL
SELECT id, 'Technology',            'Tablets and software for digital learning',         2000.00 FROM grant_record WHERE grant_name = 'Youth Education Initiative';

-- Jacob — After-School Program Funding
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Instructor Fees',     'Lead and assistant instructor compensation',             10000.00 FROM grant_record WHERE grant_name = 'After-School Program Funding' UNION ALL
SELECT id, 'Supplies & Materials','Art supplies, sports equipment, and learning materials',  5000.00 FROM grant_record WHERE grant_name = 'After-School Program Funding' UNION ALL
SELECT id, 'Snacks & Nutrition',  'Healthy snacks and meals for students',                   5000.00 FROM grant_record WHERE grant_name = 'After-School Program Funding';

-- Jacob — Technology Access Grant
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Devices',        'Refurbished laptops for household distribution', 6000.00 FROM grant_record WHERE grant_name = 'Technology Access Grant' UNION ALL
SELECT id, 'Internet Access','Subsidized internet plans for 12 months',       2500.00 FROM grant_record WHERE grant_name = 'Technology Access Grant';

-- Faizan — Mental Health Awareness Campaign (rejected — budget items recorded, no expenses)
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Marketing Materials',   'Flyers, posters, and digital advertising',         5000.00 FROM grant_record WHERE grant_name = 'Mental Health Awareness Campaign' UNION ALL
SELECT id, 'Workshop Facilitators', 'Fees for professional mental health facilitators', 7000.00 FROM grant_record WHERE grant_name = 'Mental Health Awareness Campaign';

-- Faizan — Food Security Initiative
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Food Purchases',         'Monthly bulk food purchases for the food bank', 15000.00 FROM grant_record WHERE grant_name = 'Food Security Initiative' UNION ALL
SELECT id, 'Volunteer Coordination', 'Coordinator stipends and training costs',         8000.00 FROM grant_record WHERE grant_name = 'Food Security Initiative' UNION ALL
SELECT id, 'Equipment & Facilities', 'Refrigeration, shelving, and storage equipment',  7000.00 FROM grant_record WHERE grant_name = 'Food Security Initiative';

-- Priya — Newcomer Language Program (Bright Horizons, approved)
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Instructor Fees',     'Language instructor compensation',        6000.00 FROM grant_record WHERE grant_name = 'Newcomer Language Program' UNION ALL
SELECT id, 'Classroom Supplies',  'Textbooks, workbooks, and materials',    3000.00 FROM grant_record WHERE grant_name = 'Newcomer Language Program' UNION ALL
SELECT id, 'Facility Costs',      'Room rental and utilities',              3000.00 FROM grant_record WHERE grant_name = 'Newcomer Language Program';

-- Carlos — Client Project Tracking Q1 (self-service, auto-approved)
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Consulting Fees',     'Billable hours for Maple Corp engagement', 30000.00 FROM grant_record WHERE grant_name = 'Client Project Tracking Q1' UNION ALL
SELECT id, 'Travel & Expenses',   'Client site visits and accommodation',      10000.00 FROM grant_record WHERE grant_name = 'Client Project Tracking Q1' UNION ALL
SELECT id, 'Software Licenses',   'Project management and analytics tools',     5000.00 FROM grant_record WHERE grant_name = 'Client Project Tracking Q1';

-- Nadia — Annual Operating Budget 2026 (self-service, auto-approved)
INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
SELECT id, 'Payroll',             'Staff salaries and benefits',             36000.00 FROM grant_record WHERE grant_name = 'Annual Operating Budget 2026' UNION ALL
SELECT id, 'Office Expenses',     'Rent, utilities, and office supplies',    18000.00 FROM grant_record WHERE grant_name = 'Annual Operating Budget 2026' UNION ALL
SELECT id, 'Professional Development', 'Training and certification costs',    6000.00 FROM grant_record WHERE grant_name = 'Annual Operating Budget 2026';


-- ==========================================
-- SECTION 6: EXPENSES
-- Only for approved grants.
-- expense_date must be within the grant's
-- start_spend_period / end_spend_period.
-- Triggers auto-update grant and budget
-- item totals after each insert.
-- ==========================================

-- Maria — Community Outreach Program 2024 — Staff Salaries (period: 2024-01-01 to 2024-12-31)
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Community Outreach Program 2024'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Community Outreach Program 2024' AND bi.item_name = 'Staff Salaries'),
   'Program Coordinator Salary - Jan to Mar', 2800.00, '2024-03-29'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Community Outreach Program 2024'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Community Outreach Program 2024' AND bi.item_name = 'Staff Salaries'),
   'Program Coordinator Salary - Apr to Jun', 3000.00, '2024-06-28');

-- Maria — Community Outreach Program 2024 — Community Events
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Community Outreach Program 2024'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Community Outreach Program 2024' AND bi.item_name = 'Community Events'),
   'Summer Community Festival', 2200.00, '2024-07-20'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Community Outreach Program 2024'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Community Outreach Program 2024' AND bi.item_name = 'Community Events'),
   'Holiday Gala', 1950.00, '2024-12-14');

-- Maria — Community Outreach Program 2024 — Administrative
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Community Outreach Program 2024'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Community Outreach Program 2024' AND bi.item_name = 'Administrative'),
   'Office Supplies Q1', 450.00, '2024-03-15'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Community Outreach Program 2024'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Community Outreach Program 2024' AND bi.item_name = 'Administrative'),
   'Software Licenses - Annual', 750.00, '2024-02-01');

-- Jacob — After-School Program Funding — Instructor Fees (period: 2024-01-01 to 2024-12-31)
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'After-School Program Funding'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'After-School Program Funding' AND bi.item_name = 'Instructor Fees'),
   'Lead Instructor - Sep to Dec', 4000.00, '2024-12-01'),

  ((SELECT id FROM grant_record WHERE grant_name = 'After-School Program Funding'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'After-School Program Funding' AND bi.item_name = 'Instructor Fees'),
   'Assistant Instructor - Sep to Dec', 2500.00, '2024-11-15');

-- Jacob — After-School Program Funding — Supplies & Materials
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'After-School Program Funding'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'After-School Program Funding' AND bi.item_name = 'Supplies & Materials'),
   'Art Supplies', 780.00, '2024-09-10'),

  ((SELECT id FROM grant_record WHERE grant_name = 'After-School Program Funding'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'After-School Program Funding' AND bi.item_name = 'Supplies & Materials'),
   'Sports Equipment', 1150.00, '2024-10-05');

-- Jacob — After-School Program Funding — Snacks & Nutrition
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'After-School Program Funding'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'After-School Program Funding' AND bi.item_name = 'Snacks & Nutrition'),
   'Catering Service - Q3', 1500.00, '2024-09-30'),

  ((SELECT id FROM grant_record WHERE grant_name = 'After-School Program Funding'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'After-School Program Funding' AND bi.item_name = 'Snacks & Nutrition'),
   'Catering Service - Q4', 1350.00, '2024-12-20');

-- Faizan — Food Security Initiative — Food Purchases (period: 2024-01-01 to 2024-12-31)
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Food Security Initiative'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Food Security Initiative' AND bi.item_name = 'Food Purchases'),
   'Food Bank Restocking - January', 3000.00, '2024-01-31'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Food Security Initiative'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Food Security Initiative' AND bi.item_name = 'Food Purchases'),
   'Food Bank Restocking - February', 3000.00, '2024-02-29'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Food Security Initiative'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Food Security Initiative' AND bi.item_name = 'Food Purchases'),
   'Food Bank Restocking - March', 2800.00, '2024-03-29');

-- Faizan — Food Security Initiative — Volunteer Coordination
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Food Security Initiative'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Food Security Initiative' AND bi.item_name = 'Volunteer Coordination'),
   'Coordinator Stipend - Q1', 2000.00, '2024-03-31'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Food Security Initiative'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Food Security Initiative' AND bi.item_name = 'Volunteer Coordination'),
   'Coordinator Stipend - Q2', 1800.00, '2024-06-28');

-- Faizan — Food Security Initiative — Equipment & Facilities
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Food Security Initiative'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Food Security Initiative' AND bi.item_name = 'Equipment & Facilities'),
   'Refrigeration Unit Purchase', 3500.00, '2024-02-10'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Food Security Initiative'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Food Security Initiative' AND bi.item_name = 'Equipment & Facilities'),
   'Shelving Installation', 1200.00, '2024-03-05');

-- Priya — Newcomer Language Program (period: 2025-03-01 to 2025-09-30)
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Newcomer Language Program'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Newcomer Language Program' AND bi.item_name = 'Instructor Fees'),
   'Instructor Payment - Mar', 2000.00, '2025-03-31'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Newcomer Language Program'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Newcomer Language Program' AND bi.item_name = 'Instructor Fees'),
   'Instructor Payment - Apr', 2000.00, '2025-04-30'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Newcomer Language Program'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Newcomer Language Program' AND bi.item_name = 'Classroom Supplies'),
   'Textbook Order', 1500.00, '2025-03-15');

-- Carlos — Client Project Tracking Q1 (self-service, period: 2026-01-01 to 2026-03-31)
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Client Project Tracking Q1'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Client Project Tracking Q1' AND bi.item_name = 'Consulting Fees'),
   'Maple Corp - January Invoice', 10000.00, '2026-01-31'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Client Project Tracking Q1'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Client Project Tracking Q1' AND bi.item_name = 'Travel & Expenses'),
   'Client Site Visit - Toronto', 1200.00, '2026-02-15');

-- Nadia — Annual Operating Budget 2026 (self-service, period: 2026-01-01 to 2026-12-31)
INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
VALUES
  ((SELECT id FROM grant_record WHERE grant_name = 'Annual Operating Budget 2026'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Annual Operating Budget 2026' AND bi.item_name = 'Payroll'),
   'January Payroll', 3000.00, '2026-01-31'),

  ((SELECT id FROM grant_record WHERE grant_name = 'Annual Operating Budget 2026'),
   (SELECT bi.id FROM budget_items bi JOIN grant_record gr ON bi.grant_id = gr.id WHERE gr.grant_name = 'Annual Operating Budget 2026' AND bi.item_name = 'Office Expenses'),
   'Office Rent - January', 1500.00, '2026-01-05');


-- ==========================================
-- SECTION 7: SET APPROVAL STATUS
-- Budget items and expenses for already-approved
-- grants are set to 'approved' so totals and
-- charts reflect real data. Items for pending /
-- needs_changes / rejected grants remain 'pending'
-- to demo the admin approval workflow.
-- ==========================================

UPDATE budget_items SET status = 'approved'
WHERE grant_id IN (SELECT id FROM grant_record WHERE status = 'approved');

UPDATE expenses SET status = 'approved'
WHERE grant_id IN (SELECT id FROM grant_record WHERE status = 'approved');


-- ==========================================
-- VERIFICATION
-- ==========================================

SELECT
  (SELECT COUNT(*) FROM users)                AS users,
  (SELECT COUNT(*) FROM grant_record)         AS grants,
  (SELECT COUNT(*) FROM budget_items)         AS budget_items,
  (SELECT COUNT(*) FROM expenses)             AS expenses,
  (SELECT COUNT(*) FROM grant_status_history) AS status_history_entries,
  (SELECT COUNT(*) FROM grant_comments)       AS comments;

SELECT
  u.firstname || ' ' || u.lastname AS grantee,
  gr.grant_name,
  gr.status,
  gr.grant_amount,
  gr.disbursed_funds,
  gr.total_spent,
  gr.remaining_balance
FROM grant_record gr
JOIN users u ON gr.user_id = u.id
ORDER BY u.lastname, gr.grant_name;
