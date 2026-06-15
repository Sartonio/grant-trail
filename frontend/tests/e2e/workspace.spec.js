const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

test('Flow 3: Workspace Access & Expense Tracking', async ({ page }) => {
  // 1. Setup Supabase Client
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('dummy')) {
    test.skip(true, 'Supabase credentials are not configured');
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 2. Create a fresh user via the UI to establish the Auth session
  const testEmail = `Ryanleong898+flow3_${Date.now()}@gmail.com`;
  
  await page.goto('/signup');
  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');

  await page.waitForURL('**/complete-profile', { timeout: 10000 });
  await page.getByPlaceholder('First name').fill('Workspace');
  await page.getByPlaceholder('Last name').fill('Tester');
  await page.getByPlaceholder('Phone number').fill('555-0300');
  await page.getByPlaceholder('Organization name').fill('Workspace Org');
  await page.getByRole('button', { name: 'Complete Setup' }).click();
  
  await expect(page).toHaveURL(/.*\/home|.*\/subscription/);

  // 3. Inject an active subscription to bypass the subscription wall
  const { data: userRecord } = await supabase
    .from('users')
    .select('id')
    .eq('email', testEmail.toLowerCase())
    .single();
    
  expect(userRecord).not.toBeNull();
  const userId = userRecord.id;

  const { data: sub } = await supabase.from('subscriptions').insert({
    user_id: userId,
    status: 'active',
    membership_tier: 'basic',
    stripe_subscription_id: `sub_mock_${Date.now()}`,
    stripe_customer_id: `cus_mock_${Date.now()}`,
    stripe_product_id: 'prod_UKEACUGjIeg3MU',
    stripe_price_id: 'price_mock_basic',
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }).select().single();

  await supabase.from('user_memberships').insert({
    user_id: userId,
    subscription_id: sub.id,
    membership_tier: 'basic',
    is_active: true,
    source: 'stripe',
    starts_at: new Date().toISOString()
  });

  // Navigate back to home now that we have a subscription
  await page.goto('/home');
  await expect(page).toHaveURL(/.*\/home/); // Verify dashboard loaded

  // 4. Create Grant
  await page.goto('/grants/new');
  
  await page.fill('input[name="grant_name"]', 'Q3 Operations Grant');
  await page.fill('input[name="start_spend_period"]', '2025-01-01');
  await page.fill('input[name="end_spend_period"]', '2025-12-31');
  await page.fill('input[name="grant_amount"]', '10000');
  
  // Add console listener to see what the browser is doing
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  await page.getByRole('button', { name: /Submit Application/i }).click();
  
  // Wait a short moment to see if an error appears
  await page.waitForTimeout(1000);
  const formError = await page.locator('.form-error').textContent({ timeout: 1000 }).catch(() => null);
  if (formError) {
    console.error('CRITICAL FORM SUBMISSION ERROR:', formError);
  }

  // After submission, it redirects to the grants list page
  await page.waitForURL(/\/grants$/);
  
  // Click on the newly created grant to view its details
  await page.getByRole('link', { name: 'Q3 Operations Grant' }).first().click();
  
  // Wait to land on the Grant details page
  await page.waitForURL(/\/grants\/\d+$/);
  
  // Extract the grant ID from the URL
  const urlParts = page.url().split('/');
  const grantId = urlParts[urlParts.length - 1];

  // 5. Navigate to Budget & Expenses and explicitly wait for the API data
  const budgetResponsePromise = page.waitForResponse(response => 
    response.url().includes('budget_items') && response.status() === 200
  );
  await page.goto(`/grants/${grantId}/breakdown`);
  await budgetResponsePromise;

  // 6. Add Budget Item
  // Since the API responded, the React component will render the empty state button
  await page.locator('.add-first-btn').click();

  await page.fill('input[name="item_name"]', 'Software Subscriptions');
  await page.fill('input[name="budget_allocated"]', '3000');
  await page.locator('.modal-footer .btn-submit').click();

  // The modal closes. Wait for it to disappear.
  await expect(page.locator('text=Software Subscriptions').first()).toBeVisible();

  // 7. Add Expense
  // The budget item accordion is collapsed by default. Expand it.
  await page.locator('.budget-item-toggle').first().click();

  // Click the "Add Expense" button inside the budget item row
  await page.locator('.add-expense-btn.small').first().click();

  await page.fill('input[name="item_name"]', 'GitHub Copilot');
  await page.fill('input[name="amount_spent"]', '150');
  await page.fill('input[name="expense_date"]', '2025-06-01'); // Must be within spend period
  
  // Submit expense
  await page.locator('.modal-footer .btn-submit').click();

  // 8. Assertions
  // The UI should show the expense and update the remaining balance
  await expect(page.locator('text=GitHub Copilot').first()).toBeVisible();
  
  // Query DB directly to verify expense
  const { data: expenses } = await supabase
    .from('expenses')
    .select('*')
    .eq('grant_id', grantId)
    .eq('item_name', 'GitHub Copilot');
    
  expect(expenses).toHaveLength(1);
  expect(parseFloat(expenses[0].amount_spent)).toBe(150);

  console.log('Flow 3: Workspace, Budget, and Expense tracking verified!');
});
