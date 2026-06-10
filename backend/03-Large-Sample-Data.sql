-- ==========================================
-- TFAC GRANT MANAGEMENT SYSTEM
-- Large Sample Dataset — Pagination / UI Testing
-- ==========================================
-- Run AFTER 01-Complete-Fresh-Setup.sql
-- Can be run alongside 02-Sample-Data.sql
--
-- Creates 1 user with:
--   50 grants  (mixed statuses)
--   150 budget items  (3 per grant)
--   ~405 expenses  (3 per budget item on approved grants)
--   + 1 stress-test grant: 25 budget items,
--     item #1 has 100 expenses
-- ==========================================

DO $$
DECLARE
  v_user_id         INT;
  v_grant_id        INT;
  v_budget_item_id  INT;
  v_status          VARCHAR(30);
  v_amount          DECIMAL(12,2);
  v_grant_num       INT;
  v_bi_num          INT;
  v_exp_num         INT;
  v_grant_start     DATE;
  v_expense_date    DATE;

  -- Cycles through statuses: ~62% approved, ~12% each for others
  statuses TEXT[] := ARRAY[
    'approved', 'approved', 'approved', 'approved', 'approved',
    'pending',
    'approved', 'approved',
    'needs_changes',
    'approved', 'approved', 'approved',
    'rejected',
    'approved', 'approved', 'approved',
    'pending'
  ];

  grant_prefixes TEXT[] := ARRAY[
    'Community Development',
    'Youth Empowerment',
    'Senior Support Services',
    'Mental Health Outreach',
    'Food Security',
    'Educational Access',
    'Housing Stability',
    'Employment Training',
    'Digital Literacy',
    'Environmental Awareness',
    'Family Wellness',
    'Newcomer Integration',
    'Indigenous Support',
    'Disability Services',
    'Early Childhood'
  ];

  budget_item_names TEXT[] := ARRAY[
    'Staff Salaries',
    'Program Supplies',
    'Administrative Costs',
    'Instructor Fees',
    'Materials & Equipment',
    'Venue Rental',
    'Outreach Expenses',
    'Coordinator Stipend',
    'Marketing & Awareness',
    'Food & Nutrition',
    'Transportation',
    'Volunteer Support',
    'Technology & Software',
    'Training Materials',
    'Operational Costs'
  ];

  expense_labels TEXT[] := ARRAY[
    'Q1 Payment',
    'Q2 Payment',
    'Q3 Payment',
    'Monthly Invoice',
    'One-time Purchase',
    'Service Contract'
  ];

BEGIN
  -- ----------------------------------------
  -- Insert the test user
  -- ----------------------------------------
  INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, role)
  VALUES (
    (SELECT id FROM tenants WHERE slug = 'tfac'),
    'Alex', 'Tan',
    'Test Organization Inc.',
    'alex.tan@example.com',
    '999-555-0001',
    'grantee'
  )
  RETURNING id INTO v_user_id;

  -- ----------------------------------------
  -- Generate 50 grants
  -- ----------------------------------------
  FOR v_grant_num IN 1..50 LOOP

    v_status      := statuses[((v_grant_num - 1) % array_length(statuses, 1)) + 1];
    v_amount      := (5000 + (v_grant_num * 800))::DECIMAL(12,2);
    v_grant_start := (CURRENT_DATE - ((13 - (v_grant_num % 13)) || ' months')::INTERVAL)::DATE;

    -- Insert as 'pending' first so the status trigger records a clean history
    INSERT INTO grant_record (
      user_id,
      grant_name,
      description,
      start_spend_period,
      end_spend_period,
      release_date,
      grant_amount,
      status,
      submitted_at
    )
    VALUES (
      v_user_id,
      grant_prefixes[((v_grant_num - 1) % array_length(grant_prefixes, 1)) + 1]
        || ' Program ' || LPAD(v_grant_num::TEXT, 2, '0'),
      'Sample grant ' || v_grant_num || ' of 50. Created for pagination and UI testing. '
        || 'Organization: Test Organization Inc.',
      v_grant_start,
      (CURRENT_DATE + ((6 + (v_grant_num % 18)) || ' months')::INTERVAL)::DATE,
      CASE WHEN v_status = 'approved'
        THEN (v_grant_start + INTERVAL '15 days')::DATE
        ELSE NULL
      END,
      v_amount,
      'pending',
      (CURRENT_DATE - ((60 - (v_grant_num % 55)) || ' days')::INTERVAL)::TIMESTAMPTZ
    )
    RETURNING id INTO v_grant_id;

    -- Update to final status (triggers grant_status_history entry)
    IF v_status <> 'pending' THEN
      UPDATE grant_record
      SET
        status         = v_status,
        reviewed_at    = (CURRENT_DATE - ((55 - (v_grant_num % 50)) || ' days')::INTERVAL)::TIMESTAMPTZ,
        approval_notes = CASE v_status
          WHEN 'approved'      THEN 'Application meets all requirements. Approved.'
          WHEN 'needs_changes' THEN 'Please provide additional supporting documentation and resubmit.'
          WHEN 'rejected'      THEN 'Application does not meet current funding criteria for this cycle.'
        END
      WHERE id = v_grant_id;
    END IF;

    -- ----------------------------------------
    -- 3 budget items per grant
    -- ----------------------------------------
    FOR v_bi_num IN 1..3 LOOP

      INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
      VALUES (
        v_grant_id,
        budget_item_names[(((v_grant_num - 1) * 3 + v_bi_num - 1) % array_length(budget_item_names, 1)) + 1],
        'Budget line ' || v_bi_num || ' of 3 for grant ' || LPAD(v_grant_num::TEXT, 2, '0'),
        ROUND(v_amount / 3, 2)
      )
      RETURNING id INTO v_budget_item_id;

      -- ----------------------------------------
      -- 3 expenses per budget item (approved only)
      -- expense_date spread within the grant's spend period
      -- ----------------------------------------
      IF v_status = 'approved' THEN
        FOR v_exp_num IN 1..3 LOOP

          v_expense_date := (v_grant_start + ((v_bi_num * 30 + v_exp_num * 15) || ' days')::INTERVAL)::DATE;

          INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
          VALUES (
            v_grant_id,
            v_budget_item_id,
            expense_labels[((v_exp_num - 1) % array_length(expense_labels, 1)) + 1]
              || ' — '
              || budget_item_names[(((v_grant_num - 1) * 3 + v_bi_num - 1) % array_length(budget_item_names, 1)) + 1],
            ROUND(v_amount / 9 * (0.75 + (v_grant_num % 4) * 0.07), 2),
            v_expense_date
          );
        END LOOP;
      END IF;

    END LOOP; -- budget items

  END LOOP; -- grants

  -- ----------------------------------------
  -- Stress-test grant: 25 budget items,
  -- one of which has 100 expenses
  -- ----------------------------------------
  INSERT INTO grant_record (
    user_id, grant_name, description,
    start_spend_period, end_spend_period, release_date,
    grant_amount, status, submitted_at
  )
  VALUES (
    v_user_id,
    'Large Budget Stress Test Grant',
    'Grant with 25 budget items for testing pagination and scrolling of budget item lists. One budget item contains 100 expenses to test expense list pagination.',
    CURRENT_DATE - INTERVAL '6 months',
    CURRENT_DATE + INTERVAL '6 months',
    CURRENT_DATE - INTERVAL '6 months',
    500000.00,
    'pending',
    CURRENT_DATE - INTERVAL '7 months'
  )
  RETURNING id INTO v_grant_id;

  UPDATE grant_record
  SET status = 'approved',
      reviewed_at = CURRENT_DATE - INTERVAL '6 months' + INTERVAL '5 days',
      approval_notes = 'Large grant approved for stress testing purposes.'
  WHERE id = v_grant_id;

  -- Insert 25 budget items
  FOR v_bi_num IN 1..25 LOOP

    INSERT INTO budget_items (grant_id, item_name, description, budget_allocated)
    VALUES (
      v_grant_id,
      budget_item_names[((v_bi_num - 1) % array_length(budget_item_names, 1)) + 1]
        || ' (Line ' || v_bi_num || ')',
      'Budget line item ' || v_bi_num || ' of 25 — stress test grant',
      20000.00
    )
    RETURNING id INTO v_budget_item_id;

    -- Budget item #1 gets 100 expenses; all others get 3
    IF v_bi_num = 1 THEN
      FOR v_exp_num IN 1..100 LOOP
        v_expense_date := ((CURRENT_DATE - INTERVAL '6 months') + ((v_exp_num * 2) || ' days')::INTERVAL)::DATE;
        INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
        VALUES (
          v_grant_id,
          v_budget_item_id,
          expense_labels[((v_exp_num - 1) % array_length(expense_labels, 1)) + 1]
            || ' #' || v_exp_num || ' — '
            || budget_item_names[((v_bi_num - 1) % array_length(budget_item_names, 1)) + 1],
          ROUND((200.00 - (v_exp_num % 5) * 10) * 0.90, 2),
          v_expense_date
        );
      END LOOP;
    ELSE
      FOR v_exp_num IN 1..3 LOOP
        v_expense_date := ((CURRENT_DATE - INTERVAL '6 months') + ((v_bi_num * 10 + v_exp_num * 3) || ' days')::INTERVAL)::DATE;
        INSERT INTO expenses (grant_id, budget_item_id, item_name, amount_spent, expense_date)
        VALUES (
          v_grant_id,
          v_budget_item_id,
          expense_labels[((v_exp_num - 1) % array_length(expense_labels, 1)) + 1]
            || ' — '
            || budget_item_names[((v_bi_num - 1) % array_length(budget_item_names, 1)) + 1]
            || ' (Line ' || v_bi_num || ')',
          ROUND((1000.00 + (v_bi_num * 50)) * 0.88, 2),
          v_expense_date
        );
      END LOOP;
    END IF;

  END LOOP; -- 25 budget items

END $$;


-- ==========================================
-- SET APPROVAL STATUS
-- Budget items and expenses for approved grants
-- are set to 'approved' so totals and charts
-- reflect real data. Items for pending /
-- needs_changes / rejected grants remain 'pending'
-- to demo the admin approval workflow.
-- ==========================================

UPDATE budget_items SET status = 'approved'
WHERE grant_id IN (
  SELECT id FROM grant_record
  WHERE status = 'approved'
    AND user_id = (SELECT id FROM users WHERE email = 'alex.tan@example.com')
);

UPDATE expenses SET status = 'approved'
WHERE grant_id IN (
  SELECT id FROM grant_record
  WHERE status = 'approved'
    AND user_id = (SELECT id FROM users WHERE email = 'alex.tan@example.com')
);


-- ==========================================
-- VERIFICATION
-- ==========================================

SELECT
  'alex.tan@example.com'  AS test_user,
  (SELECT COUNT(*) FROM grant_record  WHERE user_id = (SELECT id FROM users WHERE email = 'alex.tan@example.com')) AS grants,
  (SELECT COUNT(*) FROM budget_items  WHERE grant_id IN (SELECT id FROM grant_record WHERE user_id = (SELECT id FROM users WHERE email = 'alex.tan@example.com'))) AS budget_items,
  (SELECT COUNT(*) FROM expenses      WHERE grant_id IN (SELECT id FROM grant_record WHERE user_id = (SELECT id FROM users WHERE email = 'alex.tan@example.com'))) AS expenses;

SELECT status, COUNT(*) AS count
FROM grant_record
WHERE user_id = (SELECT id FROM users WHERE email = 'alex.tan@example.com')
GROUP BY status
ORDER BY count DESC;

SELECT
  gr.grant_name,
  gr.status,
  gr.grant_amount,
  gr.disbursed_funds,
  gr.total_spent,
  gr.remaining_balance
FROM grant_record gr
WHERE gr.user_id = (SELECT id FROM users WHERE email = 'alex.tan@example.com')
ORDER BY gr.id
LIMIT 10;
