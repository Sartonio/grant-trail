const { test, expect } = require('./fixtures');

test('Invite-only onboarding: signup via invite link → correct tenant & role', async ({ page, supabase, testData }) => {
  const ts = Date.now();
  const inviteEmail = `invite_grantee_${ts}@test.local`;
  const invitePassword = 'TestPassword123!';
  const tenantName = `e2e_invite_tenant_${ts}`;
  const adminEmail = `e2e_invite_admin_${ts}@test.local`;

  // 1. Provision Admin User & Tenant
  const adminAuth = await testData.createAuthUser(adminEmail);
  const tenant = await testData.createManagedTenant(tenantName);
  await testData.createTenantSettings(tenant.id, {
    require_grant_approval: true,
    require_budget_approval: true,
    require_expense_approval: true,
    require_subscription: false,
  });
  await testData.createUserRecord(tenant.id, adminAuth.id, adminEmail, 'admin', 'Admin', 'User', tenantName);

  // 2. Create Invite
  const invite = await testData.createInvite(tenant.id, inviteEmail, 'grantee', adminAuth.id);

  // 3. Signup via invite
  await page.goto(`/signup?invite=${invite.token}`);
  await expect(page.getByText('grantee', { exact: false })).toBeVisible({ timeout: 10000 });
  
  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toHaveValue(inviteEmail);
  await page.fill('input[type="password"]', invitePassword);
  await page.click('button[type="submit"]');

  // 4. Complete Profile
  await page.waitForURL(/\/complete-profile.*invite=/, { timeout: 15000 });
  await expect(page.getByText(tenantName, { exact: false })).toBeVisible({ timeout: 10000 });

  await page.getByPlaceholder('First name').fill('Invited');
  await page.getByPlaceholder('Last name').fill('Grantee');
  await page.getByPlaceholder('Phone number').fill('555-0199');
  await page.getByPlaceholder('Organization name').fill('Invite Test Org');
  await page.getByRole('button', { name: 'Complete Setup' }).click();

  // 5. Verify Redirect
  await expect(page).toHaveURL(/\:\d+\/?$|\/home|\/subscription/, { timeout: 15000 });

  // 6. Verify Database State & Register for cleanup
  const userRecord = await testData.registerUIUser(inviteEmail);
  expect(userRecord).toBeTruthy();
  
  const { data: fullUser } = await supabase.from('users').select('*').eq('id', userRecord.id).single();
  expect(fullUser.tenant_id).toBe(tenant.id);
  expect(fullUser.role).toBe('grantee');
  expect(fullUser.firstname).toBe('Invited');
  
  const { data: consumedInvite } = await supabase.from('invites').select('*').eq('id', invite.id).single();
  expect(consumedInvite.used_at).not.toBeNull();
  expect(consumedInvite.used_by).toBe(userRecord.user_id);

  console.log('✅ Invite onboarding verified: user assigned to managed tenant with role=grantee');
});
