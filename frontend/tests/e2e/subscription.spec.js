const { test, expect } = require('./fixtures');

test('Flow 2: Subscription & Stripe Mocking', async ({ page, testData }) => {
  const testEmail = `Ryanleong898+sub${Date.now()}@gmail.com`;
  
  // 1. Create a fresh user for this test
  await page.goto('/signup');
  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');

  await page.waitForURL('**/complete-profile', { timeout: 10000 });
  await page.getByPlaceholder('First name').fill('Stripe');
  await page.getByPlaceholder('Last name').fill('Tester');
  await page.getByPlaceholder('Phone number').fill('555-0200');
  await page.getByPlaceholder('Organization name').fill('Subscription Org');
  await page.getByRole('button', { name: 'Complete Setup' }).click();
  
  await expect(page).toHaveURL(/.*\/home/);

  // 2. Register UI-created user for cleanup
  const userRecord = await testData.registerUIUser(testEmail);
  expect(userRecord).toBeTruthy();

  // 3. Navigate to Subscription Page
  await page.goto('/subscription');
  await expect(page.locator('text=No active subscription')).toBeVisible();

  // 4. Mock the Stripe Checkout Edge Function
  await page.route('**/functions/v1/*', async (route) => {
    const url = route.request().url();
    if (url.includes('create-checkout-session') || url.includes('billing')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'http://localhost:3000/subscription?success=true' })
      });
    } else {
      await route.continue();
    }
  });

  await page.locator('.subscription-plan-btn').first().click();

  // 5. Verify redirect
  await expect(page).toHaveURL(/.*\/subscription\?success=true/);

  // 6. Simulate the Stripe Webhook using fixture helper
  await testData.createSubscription(userRecord.id, 'basic', 'active');

  // 7. Verify the UI updates
  await page.goto('/subscription');
  await expect(page.getByRole('heading', { name: 'Manage Basic Subscription' })).toBeVisible();

  console.log('Flow 2: Subscription Mock & Webhook Simulation Complete!');
});

// Read-only lapse policy (#40): a lapsed admin (role 'admin', no active
// subscription, not exempt/waived) can VIEW admin routes read-only but cannot
// perform mutations. Blocked mutations route to the billing nudge
// (/subscription). Reactivating the subscription restores write access.
test('Read-only lapse: lapsed admin can view admin routes but cannot mutate', async ({ page, testData }) => {
  const ts = Date.now();
  const adminEmail = `lapsed_admin_${ts}@test.local`;
  const adminPassword = 'TestPassword123!';

  // 1. Provision a managed tenant that REQUIRES a subscription (so the admin is
  //    not membership-exempt) and a fresh admin with NO subscription.
  const adminAuth = await testData.createAuthUser(adminEmail, adminPassword);
  const tenant = await testData.createManagedTenant(`Lapsed Admin Org ${ts}`);
  await testData.createTenantSettings(tenant.id, {
    require_grant_approval: true,
    require_budget_approval: true,
    require_expense_approval: true,
    require_subscription: true,
  });
  const adminUser = await testData.createUserRecord(
    tenant.id, adminAuth.id, adminEmail, 'admin', 'Lapsed', 'Admin', `Lapsed Admin Org ${ts}`,
  );

  // 2. Log in. A lapsed admin is NOT redirected away from admin routes anymore;
  //    "/" dispatches an unpaid non-super user to the billing nudge (/home).
  await page.goto('/login');
  await page.fill('#email', adminEmail);
  await page.fill('#password', adminPassword);
  await page.locator('button[type="submit"]').click();

  // 3. The admin can VIEW an admin route (read-only) — it renders rather than
  //    redirecting away, and shows the read-only banner.
  await page.goto('/admin/settings');
  await expect(page.getByRole('status')).toContainText(/read-only/i);
  await expect(page.getByRole('button', { name: /Save Settings/i })).toBeDisabled();

  // 4. The admin dashboard is also viewable (read access preserved).
  await page.goto('/admin');
  await expect(page).toHaveURL(/.*\/admin$/);
  await expect(page.getByRole('status')).toContainText(/read-only/i);

  // 5. Reactivating a premium subscription restores write access: the banner is
  //    gone and the settings form becomes editable.
  await testData.createSubscription(adminUser.id, 'premium', 'active');
  await page.goto('/admin/settings');
  await expect(page.getByRole('status')).toHaveCount(0);
  // With changes the Save button is enabled once the admin can write.
  await page.getByPlaceholder('support@yourorg.com').fill(`support+${ts}@example.com`);
  await expect(page.getByRole('button', { name: /Save Settings/i })).toBeEnabled();

  console.log('Read-only lapse: lapsed admin read-only + reactivation verified!');
});
