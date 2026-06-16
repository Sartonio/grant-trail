const { test, expect } = require('./fixtures');

test('Flow 3: Workspace Access & Expense Tracking', async ({ page, supabase, testData }) => {
  const testEmail = `Ryanleong898+flow3_${Date.now()}@gmail.com`;
  
  // 1. Create a fresh user via the UI
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

  // 2. Register UI-created user for cleanup
  const userRecord = await testData.registerUIUser(testEmail);
  expect(userRecord).toBeTruthy();

  // 3. Inject an active subscription to bypass the subscription wall
  await testData.createSubscription(userRecord.id, 'basic', 'active');

  // Navigate back to home now that we have a subscription
  await page.goto('/home');
  await expect(page).toHaveURL(/.*\/home/);

  // 4. Create Grant
  await page.goto('/grants/new');
  await page.fill('input[name="grant_name"]', 'Q3 Operations Grant');
  await page.fill('input[name="start_spend_period"]', '2025-01-01');
  await page.fill('input[name="end_spend_period"]', '2025-12-31');
  await page.fill('input[name="grant_amount"]', '10000');
  
  await page.getByRole('button', { name: /Submit Application/i }).click();
  
  await page.waitForURL(/\/grants$/);
  await page.getByRole('link', { name: 'Q3 Operations Grant' }).first().click();
  await page.waitForURL(/\/grants\/\d+$/);
  
  const urlParts = page.url().split('/');
  const grantId = urlParts[urlParts.length - 1];

  // Register grant for cleanup
  testData.registry.grantIds.push(parseInt(grantId, 10));

  // 5. Navigate to Budget & Expenses and explicitly wait for the API data
  const budgetResponsePromise = page.waitForResponse(response => 
    response.url().includes('budget_items') && response.status() === 200
  );
  await page.goto(`/grants/${grantId}/breakdown`);
  await budgetResponsePromise;

  // 6. Add Budget Item
  await page.locator('.add-first-btn').click();
  await page.fill('input[name="item_name"]', 'Software Subscriptions');
  await page.fill('input[name="budget_allocated"]', '3000');
  await page.locator('.modal-footer .btn-submit').click();
  await expect(page.locator('text=Software Subscriptions').first()).toBeVisible();

  // 7. Add Expense
  await page.locator('.budget-item-toggle').first().click();
  await page.locator('.add-expense-btn.small').first().click();

  await page.fill('input[name="item_name"]', 'GitHub Copilot');
  await page.fill('input[name="amount_spent"]', '150');
  await page.fill('input[name="expense_date"]', '2025-06-01');
  
  await page.locator('.modal-footer .btn-submit').click();

  // 8. Assertions
  await expect(page.locator('text=GitHub Copilot').first()).toBeVisible();
  
  const { data: expenses } = await supabase
    .from('expenses')
    .select('*')
    .eq('grant_id', grantId)
    .eq('item_name', 'GitHub Copilot');
    
  expect(expenses).toHaveLength(1);
  expect(parseFloat(expenses[0].amount_spent)).toBe(150);
  
  // Register budget and expense for cleanup
  testData.registry.expenseIds.push(expenses[0].id);
  testData.registry.budgetIds.push(expenses[0].budget_item_id);

  console.log('Flow 3: Workspace, Budget, and Expense tracking verified!');
});
