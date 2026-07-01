const { test, expect, loginAs } = require('./fixtures');

// Super-admin (platform) flows on /super/tenants:
//   - Cross-tenant visibility: the super-admin sees tenants belonging to others
//   - Platform defaults save
//   - Create a managed tenant -> invite link shown + approvals "Required"
//
// The tenant enable/disable toggle lives in cross-role-visibility.spec.js (it
// asserts the grantee lockout too, which is strictly more), so it is not
// repeated here.
//
// One super-admin (seeded into its own managed home tenant) plus a target tenant
// are created once and reused; the create-tenant test makes its own and it is
// cleaned up by name in afterAll.
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
    ctx.createdName = `Super Created Tenant ${ts}`;
    ctx.createdAdminEmail = `super_created_admin_${ts}@test.local`;

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

    // A separate target tenant with a distinctive name so we can find it
    // deterministically across the (seeded) tenant list.
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

    // Tear down the tenant created through the UI (create-tenant test).
    const { data: created } = await supabase.from('tenants').select('id').eq('name', ctx.createdName);
    const createdIds = (created || []).map(t => t.id);
    if (createdIds.length) {
      await supabase.from('invites').delete().in('tenant_id', createdIds);
      await supabase.from('tenant_settings').delete().in('tenant_id', createdIds);
      await supabase.from('users').delete().in('tenant_id', createdIds);
      await supabase.from('tenants').delete().in('id', createdIds);
    }

    await supabase.from('users').delete().in('id', ids.userIds.length ? ids.userIds : [-1]);
    await supabase.from('tenant_settings').delete().in('tenant_id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    await supabase.from('tenants').delete().in('id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    for (const uid of ids.authUids) await supabase.auth.admin.deleteUser(uid);
  });

  test('super-admin lands on tenant management and sees cross-tenant data', async ({ page }) => {
    const tenantsPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.status() === 200);
    await loginAs(page, ctx.email, '**/super/tenants');
    await tenantsPromise;

    await expect(page.locator('.admin-title')).toContainText('Tenant Management');

    // Cross-tenant visibility: the seeded "Bright Horizons" tenant from seed.sql
    // belongs to another tenant, yet the super-admin can see it.
    await page.locator('.admin-search-box input').fill('Bright Horizons');
    await expect(page.locator('td.grant-name-cell', { hasText: 'Bright Horizons Foundation' })).toBeVisible();

    // And it can see our distinct target tenant too.
    await page.locator('.admin-search-box input').fill(ctx.targetName);
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.targetName })).toBeVisible();
  });

  test('super-admin saves platform defaults', async ({ page, supabase }) => {
    const tenantsPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.status() === 200);
    await loginAs(page, ctx.email, '**/super/tenants');
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

  test('super-admin creates a managed tenant, shows the invite link, and lists it with approvals Required', async ({ page }) => {
    const tenantsPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.status() === 200);
    await loginAs(page, ctx.email, '**/super/tenants');
    await tenantsPromise;

    await page.getByRole('button', { name: /Create Tenant/i }).click();
    const createCard = page.locator('.admin-card', { hasText: 'New Tenant' });
    await expect(createCard).toBeVisible();

    await createCard.getByPlaceholder('e.g. Hope Foundation').fill(ctx.createdName);
    await createCard.getByPlaceholder('admin@organization.com').fill(ctx.createdAdminEmail);

    const tenantInsert = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.request().method() === 'POST' &&
      (r.status() === 200 || r.status() === 201));
    await createCard.getByRole('button', { name: 'Create Tenant' }).click();
    await tenantInsert;

    // Success message + invite link surfaced.
    await expect(createCard.getByText(/created\. Share the invite link/i)).toBeVisible();
    const inviteInput = createCard.locator('input[readonly]');
    await expect(inviteInput).toBeVisible();
    await expect(inviteInput).toHaveValue(/\/signup\?invite=[0-9a-f-]+$/i);

    // The new tenant appears with all three approval columns "Required".
    const row = page.locator('tr', { hasText: ctx.createdName });
    await expect(row).toBeVisible();
    await expect(row.locator('.user-role-pill')).toContainText('Managed');
    for (const i of [3, 4, 5]) {
      await expect(row.locator('td').nth(i)).toContainText('Required');
    }

    // The invite was persisted for this tenant with the admin role.
    const { data: tenant } = await ctx.supabase.from('tenants').select('id').eq('name', ctx.createdName).single();
    const { data: invites } = await ctx.supabase.from('invites').select('role').eq('tenant_id', tenant.id);
    expect(invites.length).toBe(1);
    expect(invites[0].role).toBe('admin');
  });
});
