const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

test('Flow 2: Subscription & Stripe Mocking', async ({ page }) => {
  // 1. Setup Supabase Client
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('dummy')) {
    test.skip(true, 'Supabase credentials are not configured');
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 2. Create a fresh user for this test (mocking the signup)
  const testEmail = `Ryanleong898+sub${Date.now()}@gmail.com`;
  
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
  
  // Wait to land on home page, where they should be prompted to subscribe
  await expect(page).toHaveURL(/.*\/home/);

  // Get the user ID from the database
  const { data: userRecord } = await supabase
    .from('users')
    .select('id')
    .eq('email', testEmail.toLowerCase())
    .single();
    
  expect(userRecord).not.toBeNull();
  const userId = userRecord.id;

  // 3. Navigate to Subscription Page
  await page.goto('/subscription');
  await expect(page.locator('text=No active subscription')).toBeVisible();

  // 4. Mock the Stripe Checkout Edge Function
  // Since we don't have Stripe keys locally, we intercept the network request
  // and pretend Stripe returned a checkout URL.
  await page.route('**/functions/v1/*', async (route) => {
    const url = route.request().url();
    if (url.includes('create-checkout-session') || url.includes('billing')) {
      // Return a fake success URL that redirects back to our app
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'http://localhost:3000/subscription?success=true' })
      });
    } else {
      await route.continue();
    }
  });

  // Click the Basic Plan button
  // Depending on how the button is labeled, we might need a specific locator.
  // We'll look for a button that says "Subscribe" or "Get Started" inside the Basic plan card.
  // The snapshot from earlier shows there are plan cards. Let's click the first available plan button.
  await page.locator('.subscription-plan-btn').first().click();

  // 5. Verify we "redirected" (via our mock) and returned successfully
  await expect(page).toHaveURL(/.*\/subscription\?success=true/);

  // 6. Simulate the Stripe Webhook
  // A real Stripe webhook would hit a Supabase Edge function, which then updates the DB.
  // We will manually execute the SQL equivalent using the service role client.
  
  // Insert into subscriptions table
  const { data: sub, error: subErr } = await supabase.from('subscriptions').insert({
    user_id: userId,
    status: 'active',
    membership_tier: 'basic',
    stripe_subscription_id: `sub_mock_${Date.now()}`,
    stripe_customer_id: `cus_mock_${Date.now()}`,
    stripe_product_id: 'prod_UKEACUGjIeg3MU',
    stripe_price_id: 'price_mock_basic',
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
  }).select().single();
  
  expect(subErr).toBeNull();

  // Insert into user_memberships table
  const { error: memErr } = await supabase.from('user_memberships').insert({
    user_id: userId,
    subscription_id: sub.id,
    membership_tier: 'basic',
    is_active: true,
    source: 'stripe',
    starts_at: new Date().toISOString()
  });

  expect(memErr).toBeNull();

  // 7. Verify the UI updates
  // Reload the page so the frontend fetches the newly inserted subscription status
  await page.goto('/subscription');
  
  // The UI should now recognize the active subscription. We target the specific heading to avoid strict mode violations.
  await expect(page.getByRole('heading', { name: 'Manage Basic Subscription' })).toBeVisible();

  console.log('Flow 2: Subscription Mock & Webhook Simulation Complete!');
});
