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
