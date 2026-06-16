const { test, expect } = require('./fixtures');

test('Flow 4: Premium Reporting & Excel Export', async ({ page, testData }) => {
  const testEmail = `reporting_${Date.now()}@test.com`;

  // ── 1. Data Provisioning using fixtures ─────────────────────────────────
  const authUser = await testData.createAuthUser(testEmail);
  const userRecord = await testData.provisionSelfServiceTenant(
    authUser.id, testEmail, 'Premium', 'Reporter', 'Data Analytics Inc'
  );

  // Active Premium subscription
  await testData.createSubscription(userRecord.id, 'premium', 'active');

  // Seed data
  const grant = await testData.createGrant(userRecord.id, null, 'Reporting Seed Grant', 'approved');
  const budget = await testData.createBudgetItem(grant.id, 'Marketing', 10000);
  await testData.createExpense(grant.id, budget.id, 'Billboard Ad', 2500, '2025-06-15');

  // ── 2. Login via browser ───────────────────────────────────────────────
  await page.goto('/login');
  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('http://localhost:3000/');

  // ── 3. Navigate to Expense Reports, wait for API ────────────────────────
  const expensesResponsePromise = page.waitForResponse(
    response => response.url().includes('expenses') && response.status() === 200
  );
  await page.goto('/expenses');
  await expensesResponsePromise;

  // ── 4. Validate summary strip ───────────────────────────────────────────
  const chipValues = page.locator('.chip-value');
  await expect(chipValues.nth(0)).toHaveText('1');          // 1 expense
  await expect(chipValues.nth(1)).toHaveText('$2,500');     // total spent
  await expect(chipValues.nth(2)).toHaveText('1');          // 1 grant with expenses

  // ── 5. Validate expense row in table ────────────────────────────────────
  await expect(page.locator('td.item-name', { hasText: 'Billboard Ad' })).toBeVisible();
  await expect(page.locator('td.amount', { hasText: '$2,500.00' })).toBeVisible();

  // ── 6. Excel export (download event) ────────────────────────────────────
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export Excel/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/expense-report-excel.*\.xlsx/);

  console.log('Flow 4: Premium Reporting & Excel Export verified!');
});
