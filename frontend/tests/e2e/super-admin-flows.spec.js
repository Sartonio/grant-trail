const { test, expect } = require('./fixtures');

// Super-admin (platform) flows on /super/tenants:
//   - Tenant enable/disable toggle
//   - Platform defaults save
//   - Cross-tenant visibility: the super-admin sees tenants belonging to other tenants
//
// A super-admin user (seeded into its own managed tenant) plus a second target
// tenant are created once and reused.
test.describe('Super-admin platform flows', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  const ctx = {};

  test.beforeAll(async ({ supabase }) => {
    ctx.supabase = supabase;
    ctx.ids = { authUids: [], userIds: [], tenantIds: [] };
    const ts = Date.now();

    ctx.email = `superadmin_${ts}@test.local`;
    ctx.password = 'TestPassword123!';

    const { data: auth } = await supabase.auth.admin.createUser({
      email: ctx.email, password: ctx.password, email_confirm: true });
    ctx.ids.authUids.push(auth.user.id);

    // Home tenant for the super-admin user (users.tenant_id is NOT NULL).
    const orgName = `Super Admin Home ${ts}`;
    const { data: homeTenant } = await supabase.from('tenants').insert({
      name: orgName, slug: `super-home-${ts}`, tenant_type: 'managed',
    }).select().single();
    ctx.ids.tenantIds.push(homeTenant.id);
    await supabase.from('tenant_settings').insert({ tenant_id: homeTenant.id, require_subscription: false });

    const { data: superUser } = await supabase.from('users').insert({
      tenant_id: homeTenant.id, user_id: auth.user.id, email: ctx.email,
      role: 'super_admin', firstname: 'Super', lastname: 'Admin',
      organization_name: orgName, phone_number: '555-0000',
    }).select().single();
    ctx.ids.userIds.push(superUser.id);

    // A separate target tenant the super-admin will toggle. Distinctive name so we
    // can search for it deterministically across the (seeded) tenant list.
    ctx.targetName = `Super Target Tenant ${ts}`;
    const { data: targetTenant } = await supabase.from('tenants').insert({
      name: ctx.targetName, slug: `super-target-${ts}`, tenant_type: 'managed', is_active: true,
    }).select().single();
    ctx.targetTenantId = targetTenant.id;
    ctx.ids.tenantIds.push(targetTenant.id);
    await supabase.from('tenant_settings').insert({ tenant_id: targetTenant.id, require_subscription: false });
  });

  test.afterAll(async ({ supabase }) => {
    const { ids } = ctx;
    await supabase.from('users').delete().in('id', ids.userIds.length ? ids.userIds : [-1]);
    await supabase.from('tenant_settings').delete().in('tenant_id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    await supabase.from('tenants').delete().in('id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    for (const uid of ids.authUids) await supabase.auth.admin.deleteUser(uid);
  });

  async function loginSuper(page) {
    await page.goto('/login');
    await page.fill('#email', ctx.email);
    await page.fill('#password', ctx.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/super/tenants', { timeout: 15000 });
  }

  test('super-admin lands on tenant management and sees cross-tenant data', async ({ page }) => {
    const tenantsPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.status() === 200);
    await loginSuper(page);
    await tenantsPromise;

    await expect(page.locator('.admin-title')).toContainText('Tenant Management');

    // Cross-tenant visibility: the seeded "tfac" / "Bright Horizons" tenants from
    // seed.sql belong to other tenants, yet the super-admin can see them.
    await page.locator('.admin-search-box input').fill('Bright Horizons');
    await expect(page.locator('td.grant-name-cell', { hasText: 'Bright Horizons Foundation' })).toBeVisible();

    // And it can see our distinct target tenant too.
    await page.locator('.admin-search-box input').fill(ctx.targetName);
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.targetName })).toBeVisible();
  });

  test('super-admin disables and re-enables a tenant', async ({ page, supabase }) => {
    const tenantsPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.status() === 200);
    await loginSuper(page);
    await tenantsPromise;

    await page.locator('.admin-search-box input').fill(ctx.targetName);
    const row = page.locator('tr', { hasText: ctx.targetName });
    await expect(row.locator('.user-status-pill')).toContainText('Active');

    // Disable -> confirm.
    await row.getByRole('button', { name: /Disable/i }).click();
    const disablePromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Yes' }).click();
    await disablePromise;

    await expect(row.locator('.user-status-pill')).toContainText('Disabled');
    let { data: t } = await supabase.from('tenants').select('is_active').eq('id', ctx.targetTenantId).single();
    expect(t.is_active).toBe(false);

    // Re-enable -> confirm.
    await row.getByRole('button', { name: /Enable/i }).click();
    const enablePromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Yes' }).click();
    await enablePromise;

    await expect(row.locator('.user-status-pill')).toContainText('Active');
    ({ data: t } = await supabase.from('tenants').select('is_active').eq('id', ctx.targetTenantId).single());
    expect(t.is_active).toBe(true);
  });

  test('super-admin saves platform defaults', async ({ page, supabase }) => {
    const tenantsPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.status() === 200);
    await loginSuper(page);
    await tenantsPromise;

    const card = page.locator('.admin-card', { hasText: 'Platform Defaults' });
    await expect(card).toBeVisible();

    const newEmail = `support+${Date.now()}@granttrail.test`;
    const emailInput = card.locator('input[type="email"]');
    await emailInput.fill(newEmail);

    const savePromise = page.waitForResponse(r =>
      r.url().includes('platform_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await card.getByRole('button', { name: /Save Platform Defaults/i }).click();
    await savePromise;

    await expect(card.getByText('Platform settings saved.')).toBeVisible();

    const { data: ps } = await supabase.from('platform_settings').select('default_support_email').eq('id', 1).single();
    expect(ps.default_support_email).toBe(newEmail);
  });
});
