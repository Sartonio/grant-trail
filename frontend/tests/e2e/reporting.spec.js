const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

/**
 * Flow 4: Premium Reporting & Excel Export
 *
 * Tests the Expense Reports page (/expenses) with a premium-tier user.
 * Validates:
 *   - Summary strip shows correct totals (chip-value elements)
 *   - Expense table renders the seeded expense row
 *   - Excel export button is visible (gated by hasFeature → hasBasicAccess)
 *   - Clicking "Export Excel" triggers an .xlsx file download
 *
 * Data setup (all via service-role Supabase client, no UI):
 *   1. auth.admin.createUser → auth user
 *   2. provision_self_service_tenant RPC → users row + tenant + tenant_settings
 *   3. subscriptions INSERT (all 7 NOT NULL cols) → active premium subscription
 *   4. user_memberships INSERT → is_active basic/premium tier
 *   5. grant_record INSERT → approved grant
 *   6. budget_items INSERT → approved budget item
 *   7. expenses INSERT → approved expense
 *
 * Key schema constraints (from 01-Complete-Fresh-Setup.sql):
 *   - subscriptions: stripe_customer_id, stripe_subscription_id,
 *     stripe_product_id, stripe_price_id, membership_tier, status are NOT NULL
 *   - trg_enforce_subscription_tier_product_match validates product ID matches
 *     platform_settings (premium = 'prod_UDClBMtvFLKyNW')
 *   - trg_enforce_membership_eligibility rejects super_admin / TFAC admin
 *   - has_basic_membership() checks user_memberships.is_active + tier
 *   - hasFeature(session, 'excel_export') → session.membership.hasBasicAccess
 *
 * UI locators (from ExpenseReports.js):
 *   - Summary strip: .stat-chip > .chip-value (3 chips: count, total, grants)
 *   - Export Excel: button.admin-approve-btn with text "Export Excel"
 *   - Table: .expenses-table-main with td.item-name, td.amount, td.date
 */
test('Flow 4: Premium Reporting & Excel Export', async ({ page }) => {
  // ── 1. Supabase admin client ──────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('dummy')) {
    test.skip(true, 'Supabase credentials are not configured');
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── 2. Create auth user ───────────────────────────────────────────────
  const testEmail = `reporting_${Date.now()}@test.com`;
  const { data: authData } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: 'password123',
    email_confirm: true
  });
  const user = authData.user;

  // ── 3. Provision tenant (creates users row with integer id) ───────────
  const { data: userRecord, error: provisionError } = await supabase.rpc(
    'provision_self_service_tenant',
    {
      p_auth_uid: user.id,
      p_email: testEmail,
      p_firstname: 'Premium',
      p_lastname: 'Reporter',
      p_organization: 'Data Analytics Inc',
      p_phone: '555-1000',
      p_tax_month: 4
    }
  );
  expect(provisionError).toBeNull();
  expect(userRecord).not.toBeNull();

  // ── 4. Insert subscription (all 7 NOT NULL columns) ───────────────────
  // membership_tier='premium', stripe_product_id must match platform_settings
  const { data: sub, error: subError } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userRecord.id,                          // INT FK → users.id
      stripe_customer_id: `cus_test_${Date.now()}`,    // NOT NULL
      stripe_subscription_id: `sub_test_${Date.now()}`,// NOT NULL UNIQUE
      stripe_product_id: 'prod_UDClBMtvFLKyNW',       // NOT NULL, must match premium in platform_settings
      stripe_price_id: `price_test_${Date.now()}`,     // NOT NULL
      membership_tier: 'premium',                      // NOT NULL CHECK
      status: 'active',                                // NOT NULL
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
    .select()
    .single();
  expect(subError).toBeNull();
  expect(sub).not.toBeNull();

  // ── 5. Insert user_membership ─────────────────────────────────────────
  // has_basic_membership() checks: is_active=true AND tier IN ('basic','premium')
  const { error: memError } = await supabase.from('user_memberships').insert({
    user_id: userRecord.id,
    subscription_id: sub.id,
    membership_tier: 'premium',
    is_active: true,
    source: 'stripe',
    starts_at: new Date().toISOString()
  });
  expect(memError).toBeNull();

  // ── 6. Seed grant + budget item + expense ─────────────────────────────
  const { data: grant, error: grantError } = await supabase
    .from('grant_record')
    .insert({
      user_id: userRecord.id,
      grant_name: 'Reporting Seed Grant',
      start_spend_period: '2025-01-01',
      end_spend_period: '2025-12-31',
      grant_amount: 50000
      // tenant_id auto-populated by trg_set_grant_tenant_id
      // status defaults to 'pending', auto-approved by trg_zz_auto_approve_grant
      // (tenant_settings.require_grant_approval = false for self_service)
    })
    .select()
    .single();
  expect(grantError).toBeNull();

  const { data: budget, error: budgetError } = await supabase
    .from('budget_items')
    .insert({
      grant_id: grant.id,
      item_name: 'Marketing',
      budget_allocated: 10000
      // tenant_id auto-populated by trg_set_budget_items_tenant_id
      // status auto-approved by trg_zz_auto_approve_budget_item
    })
    .select()
    .single();
  expect(budgetError).toBeNull();

  const { error: expenseError } = await supabase.from('expenses').insert({
    grant_id: grant.id,
    budget_item_id: budget.id,
    item_name: 'Billboard Ad',
    expense_date: '2025-06-15',
    amount_spent: 2500
    // tenant_id auto-populated by trg_set_expenses_tenant_id
    // status auto-approved by trg_zz_auto_approve_expense
  });
  expect(expenseError).toBeNull();

  // ── 7. Login via browser ──────────────────────────────────────────────
  await page.goto('/login');
  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', 'password123');
  // Login.js: button is type="submit" with text "Log In" (two words, inside a <span>)
  // Login.js line 46: navigate(role === 'admin' ? '/admin' : '/') → grantees go to "/"
  await page.click('button[type="submit"]');
  // Wait for login redirect to settle (goes to "/" for grantee role)
  await page.waitForURL('http://localhost:3000/');

  // ── 8. Navigate to Expense Reports, wait for API ──────────────────────
  // ExpenseReports.js fetches: grant_record, expenses, budget_items
  const expensesResponsePromise = page.waitForResponse(
    response => response.url().includes('expenses') && response.status() === 200
  );
  await page.goto('/expenses');
  await expensesResponsePromise;

  // ── 9. Validate summary strip ─────────────────────────────────────────
  // .stat-chip has .chip-value children: [count, $total, grants_with_expenses]
  // We seeded 1 expense of $2,500 across 1 grant
  const chipValues = page.locator('.chip-value');
  await expect(chipValues.nth(0)).toHaveText('1');          // 1 expense
  await expect(chipValues.nth(1)).toHaveText('$2,500');     // total spent
  await expect(chipValues.nth(2)).toHaveText('1');          // 1 grant with expenses

  // ── 10. Validate expense row in table ─────────────────────────────────
  await expect(page.locator('td.item-name', { hasText: 'Billboard Ad' })).toBeVisible();
  await expect(page.locator('td.amount', { hasText: '$2,500.00' })).toBeVisible();

  // ── 11. Excel export (download event) ─────────────────────────────────
  // hasFeature checks session.membership.hasBasicAccess which is true
  // because has_basic_membership() finds our active user_membership
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export Excel/i }).click();
  const download = await downloadPromise;

  // downloadExcel() produces: expense-report-excel_{from}_to_{to}.xlsx
  expect(download.suggestedFilename()).toMatch(/expense-report-excel.*\.xlsx/);

  console.log('Flow 4: Premium Reporting & Excel Export verified!');
});
