const { test, expect } = require('./fixtures');

// LS1 Lane S — Super-Admin happy-path journey (trimmed).
//
// Keeps the one super-admin flow that needs a full browser + real stack and is
// not covered cheaper elsewhere:
//   §3 Create a managed tenant -> invite link shown + tenant listed w/ approvals
//      "Required"
//
// Removed and pushed down the pyramid:
//   - tenant stat cards + search / type / status / date-range filters,
//     platform-defaults footer fallback  -> component concerns (frontend vitest)
//   - subscription exempt/require *access* effect (exempt -> grantee gains
//     access, re-require -> gated)        -> cross-role-visibility.spec.js
//   - is_membership_exempt precedence by flag/role
//                                         -> supabase/tests/grant-trigger-behaviors.test.sh
//   (The self-service manual-waiver auto-removal on re-require is an
//    implementation detail of the access effect above; the user-visible result
//    is asserted in cross-role-visibility.spec.js.)
//
// A super_admin has no signup UI, so it is seeded by inserting a users row with
// role 'super_admin' via the service-role client.
test.describe('Super-admin walkthrough', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  const ctx = {};

  test.beforeAll(async ({ supabase }) => {
    ctx.supabase = supabase;
    ctx.ids = { authUids: [], userIds: [], tenantIds: [] };
    const ts = Date.now();
    ctx.password = 'TestPassword123!';
    ctx.homeName = `LS1S Home ${ts}`;
    ctx.createdName = `LS1S Created ${ts}`;
    ctx.createdAdminEmail = `ls1s_created_admin_${ts}@test.local`;

    // Super-admin lives in its own managed home tenant (users.tenant_id NOT NULL).
    const { data: home, error: hErr } = await supabase.from('tenants').insert({
      name: ctx.homeName, slug: `ls1s-home-${ts}`, tenant_type: 'managed', is_active: true,
    }).select().single();
    if (hErr) throw hErr;
    ctx.ids.tenantIds.push(home.id);
    await supabase.from('tenant_settings').insert({ tenant_id: home.id, require_subscription: false });

    ctx.email = `ls1s_super_${ts}@test.local`;
    const { data: auth, error: aErr } = await supabase.auth.admin.createUser({
      email: ctx.email, password: ctx.password, email_confirm: true,
    });
    if (aErr) throw aErr;
    ctx.ids.authUids.push(auth.user.id);
    const { data: superUser, error: sErr } = await supabase.from('users').insert({
      tenant_id: home.id, user_id: auth.user.id, email: ctx.email,
      role: 'super_admin', firstname: 'Super', lastname: 'Admin',
      organization_name: ctx.homeName, phone_number: '555-0000',
    }).select().single();
    if (sErr) throw sErr;
    ctx.ids.userIds.push(superUser.id);
  });

  test.afterAll(async ({ supabase }) => {
    const { ids } = ctx;

    // Tear down the tenant created through the UI.
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

  async function loginSuper(page) {
    const tenantsLoaded = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.status() === 200);
    await page.goto('/login');
    await page.fill('#email', ctx.email);
    await page.fill('#password', ctx.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/super/tenants', { timeout: 15000 });
    await tenantsLoaded;
    await expect(page.locator('.admin-title')).toContainText('Tenant Management');
  }

  // ── §3 Create a managed tenant -> invite link + approvals "Required" ─────────
  test('creates a managed tenant, shows the invite link, and lists it with approvals Required', async ({ page }) => {
    await loginSuper(page);

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

    // The invite was persisted for this tenant.
    const { data: tenant } = await ctx.supabase.from('tenants').select('id').eq('name', ctx.createdName).single();
    const { data: invites } = await ctx.supabase.from('invites').select('role').eq('tenant_id', tenant.id);
    expect(invites.length).toBe(1);
    expect(invites[0].role).toBe('admin');
  });
});
