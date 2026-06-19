const { test, expect } = require('./fixtures');

// Negative / authorization paths:
//   - Logged-out visitor is redirected to /login on protected routes.
//   - Grantee cannot reach admin or super routes (redirected away).
//   - Admin cannot reach super-admin routes (redirected away).
//   - Tenant isolation: an admin in tenant A cannot see tenant B's grant in the UI.
//
// Two tenants (A and B), each with an admin + grantee + grant, are seeded once.
test.describe('Authorization & tenant isolation', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  const ctx = {};

  test.beforeAll(async ({ supabase }) => {
    ctx.supabase = supabase;
    ctx.ids = { authUids: [], userIds: [], tenantIds: [], grantIds: [] };
    const ts = Date.now();
    ctx.password = 'TestPassword123!';

    async function makeAuth(email) {
      const { data } = await supabase.auth.admin.createUser({ email, password: ctx.password, email_confirm: true });
      ctx.ids.authUids.push(data.user.id);
      return data.user.id;
    }
    async function makeTenant(label) {
      const name = `Authz ${label} ${ts}`;
      const { data: tenant } = await supabase.from('tenants').insert({
        name, slug: `authz-${label.toLowerCase()}-${ts}`, tenant_type: 'managed',
      }).select().single();
      ctx.ids.tenantIds.push(tenant.id);
      await supabase.from('tenant_settings').insert({ tenant_id: tenant.id, require_subscription: false });
      return { tenant, name };
    }
    async function makeUser(tenantId, authUid, email, role, org) {
      const { data } = await supabase.from('users').insert({
        tenant_id: tenantId, user_id: authUid, email, role,
        firstname: role, lastname: 'User', organization_name: org, phone_number: '555-0000',
      }).select().single();
      ctx.ids.userIds.push(data.id);
      return data;
    }

    // Tenant A: admin + grantee + grant
    const a = await makeTenant('A');
    ctx.adminAEmail = `authz_admin_a_${ts}@test.local`;
    const adminAUid = await makeAuth(ctx.adminAEmail);
    const adminA = await makeUser(a.tenant.id, adminAUid, ctx.adminAEmail, 'admin', a.name);
    ctx.adminAUserId = adminA.id;

    ctx.granteeAEmail = `authz_grantee_a_${ts}@test.local`;
    const granteeAUid = await makeAuth(ctx.granteeAEmail);
    const granteeA = await makeUser(a.tenant.id, granteeAUid, ctx.granteeAEmail, 'grantee', a.name);

    // Grantee A needs a membership to pass the gate for /grants routes.
    await supabase.from('user_memberships').insert({
      user_id: granteeA.id, membership_tier: 'basic', is_active: true, source: 'manual', starts_at: new Date().toISOString(),
    });

    const { data: grantA } = await supabase.from('grant_record').insert({
      user_id: granteeA.id, tenant_id: a.tenant.id, grant_name: `Authz Grant A ${ts}`,
      grant_amount: 5000, status: 'approved', start_spend_period: '2025-01-01', end_spend_period: '2025-12-31',
    }).select().single();
    ctx.ids.grantIds.push(grantA.id);

    // Tenant B: admin + grantee + grant (the data tenant A must NOT see)
    const b = await makeTenant('B');
    const adminBUid = await makeAuth(`authz_admin_b_${ts}@test.local`);
    const adminB = await makeUser(b.tenant.id, adminBUid, `authz_admin_b_${ts}@test.local`, 'admin', b.name);
    const granteeBUid = await makeAuth(`authz_grantee_b_${ts}@test.local`);
    const granteeB = await makeUser(b.tenant.id, granteeBUid, `authz_grantee_b_${ts}@test.local`, 'grantee', b.name);

    ctx.tenantBGrantName = `Authz Grant B ${ts}`;
    const { data: grantB } = await supabase.from('grant_record').insert({
      user_id: granteeB.id, tenant_id: b.tenant.id, grant_name: ctx.tenantBGrantName,
      grant_amount: 9000, status: 'pending', start_spend_period: '2025-01-01', end_spend_period: '2025-12-31',
    }).select().single();
    ctx.tenantBGrantId = grantB.id;
    ctx.ids.grantIds.push(grantB.id);
  });

  test.afterAll(async ({ supabase }) => {
    const { ids } = ctx;
    await supabase.from('grant_record').delete().in('id', ids.grantIds.length ? ids.grantIds : [-1]);
    // Memberships for the seeded users are cleaned via cascade on user delete in most schemas;
    // delete explicitly to be safe.
    await supabase.from('user_memberships').delete().in('user_id', ids.userIds.length ? ids.userIds : [-1]);
    await supabase.from('users').delete().in('id', ids.userIds.length ? ids.userIds : [-1]);
    await supabase.from('tenant_settings').delete().in('tenant_id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    await supabase.from('tenants').delete().in('id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    for (const uid of ids.authUids) await supabase.auth.admin.deleteUser(uid);
  });

  async function login(page, email) {
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', ctx.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => url.pathname !== '/login', { timeout: 15000 });
  }

  test('logged-out visitor is redirected to /login on protected routes', async ({ page }) => {
    await page.goto('/grants');
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/expenses');
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/subscription');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('grantee is redirected away from admin and super routes', async ({ page }) => {
    await login(page, ctx.granteeAEmail);

    // Admin routes -> redirected to "/" (which for a grantee is the dashboard, not /admin).
    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin\b/);

    await page.goto('/admin/users');
    await expect(page).not.toHaveURL(/\/admin\//);

    await page.goto('/admin/audit');
    await expect(page).not.toHaveURL(/\/admin\//);

    // Super route -> redirected away.
    await page.goto('/super/tenants');
    await expect(page).not.toHaveURL(/\/super\//);
  });

  test('admin is redirected away from super-admin routes', async ({ page }) => {
    await login(page, ctx.adminAEmail);
    await page.waitForURL('**/admin', { timeout: 15000 });

    await page.goto('/super/tenants');
    // Admin gets bounced off /super; App sends "/" -> /admin for an admin.
    await expect(page).not.toHaveURL(/\/super\//);
    await expect(page).toHaveURL(/\/admin\b/);
  });

  test('admin in tenant A cannot see tenant B grant in the grant list', async ({ page }) => {
    await login(page, ctx.adminAEmail);
    await page.waitForURL('**/admin', { timeout: 15000 });

    const grantsPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.status() === 200);
    await page.goto('/admin/grants');
    await grantsPromise;

    // Search for tenant B's grant by its unique name — it must not appear (RLS scoped to tenant A).
    await page.locator('.admin-search-box input').fill(ctx.tenantBGrantName);
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.tenantBGrantName })).toHaveCount(0);
    await expect(page.getByText('No grants found.')).toBeVisible();
  });

  test('admin in tenant A cannot open tenant B grant review directly', async ({ page }) => {
    await login(page, ctx.adminAEmail);
    await page.waitForURL('**/admin', { timeout: 15000 });

    await page.goto(`/admin/grants/${ctx.tenantBGrantId}`);
    // RLS hides tenant B's grant, so the review page reports it cannot be loaded
    // and never renders tenant B's grant name.
    await expect(page.locator('.admin-error')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.arh-title')).toHaveCount(0);
    await expect(page.getByText(ctx.tenantBGrantName)).toHaveCount(0);
  });
});
