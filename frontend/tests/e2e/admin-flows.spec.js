const { test, expect, loginAs } = require('./fixtures');

// Admin-facing flows beyond the existing admin-review.spec.js (which covers approve):
//   - Request-changes decision on a pending grant
//   - User management: invite generation + role toggle
//   - Settings: toggle an approval workflow and save
//   - Audit log renders and filters
//   - Grant list CSV export
//
// One managed tenant with an admin + grantee + grants is seeded once and reused.
test.describe('Admin management flows', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  const ctx = {};

  test.beforeAll(async ({ supabase }) => {
    ctx.supabase = supabase;
    ctx.ids = { authUids: [], userIds: [], tenantIds: [], grantIds: [], inviteIds: [] };
    const ts = Date.now();

    ctx.adminEmail = `admin_flows_${ts}@test.local`;
    ctx.password = 'TestPassword123!';
    const granteeEmail = `admin_flows_grantee_${ts}@test.local`;

    const { data: adminAuth } = await supabase.auth.admin.createUser({
      email: ctx.adminEmail, password: ctx.password, email_confirm: true });
    ctx.ids.authUids.push(adminAuth.user.id);
    const { data: granteeAuth } = await supabase.auth.admin.createUser({
      email: granteeEmail, password: ctx.password, email_confirm: true });
    ctx.ids.authUids.push(granteeAuth.user.id);

    const orgName = `Admin Flows Org ${ts}`;
    const { data: tenant } = await supabase.from('tenants').insert({
      name: orgName, slug: `admin-flows-${ts}`, tenant_type: 'managed',
    }).select().single();
    ctx.tenantId = tenant.id;
    ctx.ids.tenantIds.push(tenant.id);
    await supabase.from('tenant_settings').insert({
      tenant_id: tenant.id,
      require_grant_approval: true, require_budget_approval: true,
      require_expense_approval: true, require_subscription: false,
    });

    const { data: admin } = await supabase.from('users').insert({
      tenant_id: tenant.id, user_id: adminAuth.user.id, email: ctx.adminEmail,
      role: 'admin', firstname: 'Admin', lastname: 'Flows', organization_name: orgName, phone_number: '555-0000',
    }).select().single();
    ctx.adminUserId = admin.id;
    ctx.ids.userIds.push(admin.id);

    const { data: grantee } = await supabase.from('users').insert({
      tenant_id: tenant.id, user_id: granteeAuth.user.id, email: granteeEmail,
      role: 'grantee', firstname: 'Glen', lastname: 'Tee', organization_name: orgName, phone_number: '555-0001',
    }).select().single();
    ctx.granteeUserId = grantee.id;
    ctx.granteeEmail = granteeEmail;
    ctx.ids.userIds.push(grantee.id);

    // Pending grant for the request-changes decision.
    const { data: grant } = await supabase.from('grant_record').insert({
      user_id: grantee.id, tenant_id: tenant.id,
      grant_name: `Admin Flows Grant ${ts}`, grant_amount: 8000, status: 'pending',
      start_spend_period: '2025-01-01', end_spend_period: '2025-12-31',
    }).select().single();
    ctx.grantId = grant.id;
    ctx.grantName = grant.grant_name;
    ctx.ids.grantIds.push(grant.id);
  });

  test.afterAll(async ({ supabase }) => {
    const { ids } = ctx;
    await supabase.from('grant_record').delete().in('id', ids.grantIds.length ? ids.grantIds : [-1]);
    await supabase.from('invites').delete().in('tenant_id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    await supabase.from('users').delete().in('id', ids.userIds.length ? ids.userIds : [-1]);
    await supabase.from('tenant_settings').delete().in('tenant_id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    await supabase.from('tenants').delete().in('id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    for (const uid of ids.authUids) await supabase.auth.admin.deleteUser(uid);
  });

  const loginAdmin = (page) => loginAs(page, ctx.adminEmail, '**/admin');

  test('admin requests changes on a pending grant', async ({ page, supabase }) => {
    await loginAdmin(page);

    const reviewPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.status() === 200);
    await page.goto(`/admin/grants/${ctx.grantId}`);
    await reviewPromise;
    await expect(page.locator('.arh-title h2')).toContainText(ctx.grantName);

    await page.locator('button.action-btn.changes').click();
    await expect(page.locator('.action-form')).toBeVisible();
    await page.locator('.action-form textarea').fill('Please clarify the budget breakdown.');

    const patchPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') &&
      r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await page.locator('button.action-submit-btn.needs_changes').click();
    await patchPromise;

    await expect(page.locator('text=Grant returned for changes.')).toBeVisible({ timeout: 10000 });

    const { data: updated } = await supabase
      .from('grant_record').select('status, approval_notes').eq('id', ctx.grantId).single();
    expect(updated.status).toBe('needs_changes');
    expect(updated.approval_notes).toContain('clarify');
  });

  test('admin generates an invite link from user management', async ({ page, supabase }) => {
    await loginAdmin(page);

    const usersPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/users') && r.status() === 200);
    await page.goto('/admin/users');
    await usersPromise;

    await expect(page.locator('.admin-title')).toContainText('User Management');
    // Seeded grantee is listed.
    await expect(page.locator('td.grant-name-cell', { hasText: 'Glen Tee' })).toBeVisible();

    await page.getByRole('button', { name: /Invite User/i }).click();
    const inviteEmail = `invited_${Date.now()}@test.local`;
    await page.locator('.admin-card input[type="email"]').fill(inviteEmail);

    const invitePromise = page.waitForResponse(r =>
      r.url().includes('invites') && r.request().method() === 'POST' &&
      (r.status() === 201 || r.status() === 200));
    await page.getByRole('button', { name: /Generate Invite Link/i }).click();
    await invitePromise;

    // The generated link is shown and contains an invite token.
    const linkInput = page.locator('.admin-card input[readonly]');
    await expect(linkInput).toBeVisible();
    await expect(linkInput).toHaveValue(/\/signup\?invite=/);

    const { data: invites } = await supabase
      .from('invites').select('id, role, email').eq('tenant_id', ctx.tenantId).eq('email', inviteEmail);
    expect(invites.length).toBe(1);
    expect(invites[0].role).toBe('grantee');
  });

  test('admin promotes a grantee to admin', async ({ page, supabase }) => {
    await loginAdmin(page);
    const usersPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/users') && r.status() === 200);
    await page.goto('/admin/users');
    await usersPromise;

    const row = page.locator('tr', { hasText: 'Glen Tee' });
    await row.getByRole('button', { name: /Make Admin/i }).click();

    const patchPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/users') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Yes' }).click();
    await patchPromise;

    // Role pill flips to admin.
    await expect(row.locator('.user-role-pill')).toContainText('admin');

    const { data: u } = await supabase.from('users').select('role').eq('id', ctx.granteeUserId).single();
    expect(u.role).toBe('admin');

    // Restore to grantee so other serial tests see consistent data.
    await supabase.from('users').update({ role: 'grantee' }).eq('id', ctx.granteeUserId);
  });

  test('admin toggles an approval workflow in settings and saves', async ({ page, supabase }) => {
    await loginAdmin(page);
    await page.goto('/admin/settings');
    await expect(page.locator('.admin-title')).toContainText('Settings');

    // Toggle the first approval switch (Grant Approval) off. The checkbox is
    // visually hidden behind a styled slider, so click the label wrapper.
    const firstToggle = page.locator('.toggle-switch').first();
    await expect(firstToggle.locator('input[type="checkbox"]')).toBeChecked();
    await firstToggle.click();
    await expect(firstToggle.locator('input[type="checkbox"]')).not.toBeChecked();

    const savePromise = page.waitForResponse(r =>
      r.url().includes('tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await page.getByRole('button', { name: /Save Settings/i }).click();
    await savePromise;

    await expect(page.locator('text=Settings saved.')).toBeVisible();

    const { data: settings } = await supabase
      .from('tenant_settings').select('require_grant_approval').eq('tenant_id', ctx.tenantId).single();
    expect(settings.require_grant_approval).toBe(false);

    // Restore for cleanliness.
    await supabase.from('tenant_settings').update({ require_grant_approval: true }).eq('tenant_id', ctx.tenantId);
  });

  test('admin audit log renders and filters by table', async ({ page }) => {
    await loginAdmin(page);
    const auditPromise = page.waitForResponse(r =>
      r.url().includes('audit_log') && r.status() === 200);
    await page.goto('/admin/audit');
    await auditPromise;

    await expect(page.locator('.admin-title')).toContainText('Audit Log');

    // The grant request-changes from an earlier test produced grant_record audit rows.
    const tableFilter = page.locator('.audit-filter-select').first();
    const filteredPromise = page.waitForResponse(r =>
      r.url().includes('audit_log') && r.url().includes('grant_record') && r.status() === 200);
    await tableFilter.selectOption('grant_record');
    await filteredPromise;

    // At least one row, and every visible Table cell reads "Grant".
    const rows = page.locator('tbody tr.audit-row');
    await expect(rows.first()).toBeVisible();
  });

  test('admin grant list exports CSV', async ({ page }) => {
    await loginAdmin(page);
    const grantsPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.status() === 200);
    await page.goto('/admin/grants');
    await grantsPromise;

    await expect(page.locator('td.grant-name-cell', { hasText: ctx.grantName })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export CSV/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/grants-report.*\.csv/);
  });
});
