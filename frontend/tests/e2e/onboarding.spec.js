const { test, expect } = require('./fixtures');

test('Flow 1: Signup and Onboarding', async ({ page, supabase, testData }) => {
  await page.goto('/signup');

  const testEmail = `Ryanleong898+${Date.now()}@gmail.com`;
  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');

  await page.waitForURL('**/complete-profile', { timeout: 10000 });

  await page.getByPlaceholder('First name').fill('Ryan');
  await page.getByPlaceholder('Last name').fill('Leong');
  await page.getByPlaceholder('Phone number').fill('555-0100');
  await page.getByPlaceholder('Organization name').fill('Test Org');
  
  await page.getByRole('button', { name: 'Complete Setup' }).click();
  
  await expect(page).toHaveURL(/.*\/home|.*\/admin|.*\/subscription/);

  // Database Verification & Cleanup Registration
  const userRecord = await testData.registerUIUser(testEmail);
  expect(userRecord).toBeTruthy();

  const { data: fullUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', userRecord.id)
    .single();

  expect(fullUser).not.toBeNull();
  expect(fullUser.firstname).toBe('Ryan');
  expect(fullUser.lastname).toBe('Leong');
  expect(fullUser.role).toBe('grantee');

  console.log('Onboarding complete and database verified!');
});
