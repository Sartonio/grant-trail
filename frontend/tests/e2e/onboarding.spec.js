const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

test('Flow 1: Signup and Onboarding', async ({ page }) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('dummy')) {
    test.skip(true, 'Supabase credentials are not configured');
    return;
  }

  // 1. Go to signup page
  await page.goto('/signup');

  // 2. Fill out signup form
  // Using a dynamic email to avoid collision on re-runs
  const testEmail = `Ryanleong898+${Date.now()}@gmail.com`;
  await page.fill('input[type="email"]', testEmail);
  // You might need to adjust this selector based on your actual DOM
  await page.fill('input[type="password"]', 'TestPassword123!');
  
  // Submit the form
  await page.click('button[type="submit"]');

  // Wait to land on the complete-profile page automatically (if email verification is disabled)
  await page.waitForURL('**/complete-profile', { timeout: 10000 });

  // After the pause, we expect to be at the complete-profile page
  // (Assuming that's the next step after email verification and initial login)
  if (page.url().includes('/complete-profile')) {
    // Fill out profile using user-facing locators (Playwright best practice)
    await page.getByPlaceholder('First name').fill('Ryan');
    await page.getByPlaceholder('Last name').fill('Leong');
    
    // Fill out additional required fields based on the page snapshot
    await page.getByPlaceholder('Phone number').fill('555-0100');
    await page.getByPlaceholder('Organization name').fill('Test Org');
    
    // Submit the profile setup
    await page.getByRole('button', { name: 'Complete Setup' }).click();
    
    // Wait to land on the dashboard or subscription page
    await expect(page).toHaveURL(/.*\/home|.*\/admin|.*\/subscription/);
  }

  // 3. Database Verification
  // Connect to Supabase using the service_role key to bypass RLS and verify the record was inserted
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Poll for the user to be created (triggers might take a fraction of a second)
  let userRecord = null;
  for (let i = 0; i < 5; i++) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', testEmail.toLowerCase())
      .single();
      
    if (data) {
      userRecord = data;
      break;
    }
    await page.waitForTimeout(1000);
  }

  expect(userRecord).not.toBeNull();
  expect(userRecord.firstname).toBe('Ryan');
  expect(userRecord.lastname).toBe('Leong');
  expect(userRecord.role).toBe('grantee'); // The default role

  console.log('Onboarding complete and database verified!');
});
