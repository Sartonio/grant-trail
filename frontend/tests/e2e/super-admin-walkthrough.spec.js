const { test, expect } = require('./fixtures');

// LS1 Lane S — Super-Admin walkthrough (docs/tutorials/Super-Admin-Walkthrough.md).
//
// Drives a super_admin through the *gaps* in the coverage map that the existing
// super-admin-flows / authz-negative specs do NOT cover:
//   §2  Tenant stat cards + search / type / status / date-range filters
//   §3  Create a managed tenant -> invite link shown, tenant appears w/ approvals "Required"
//   §9  Platform-defaults footer fallback precedence (tenant-absent -> platform default)
//   §10 Exempt / Require a tenant's subscription, incl. the self-service waiver
//       auto-removal on re-require (and the managed-tenant negative: waiver survives)
//
// Already covered elsewhere and intentionally NOT repeated here:
//   - lands on /super/tenants, cross-tenant visibility, disable/enable, save platform
//     defaults  (super-admin-flows.spec.js)
//   - tenant isolation                                  (authz-negative.spec.js)
//
// A super_admin has no signup UI, so it is seeded by inserting a users row with
// role 'super_admin' via the service-role client (per the walkthrough). Login is
// the in-browser /login flow (#email / #password) and lands on /super/tenants.
//
// Clipboard permissions are granted so the "Copy" invite-link button can run.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('Super-admin walkthrough', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  const ctx = {};

  test.beforeAll(async ({ supabase }) => {
    ctx.supabase = supabase;
    ctx.ids = { authUids: [], userIds: [], tenantIds: [], membershipIds: [] };
    const ts = Date.now();
    ctx.ts = ts;
    ctx.password = 'TestPassword123!';

    // Distinctive names so every row is found deterministically in the (seeded) list.
    ctx.homeName = `LS1S Home ${ts}`;
    ctx.selfName = `LS1S Self ${ts}`;
    ctx.managedName = `LS1S Managed ${ts}`;
    ctx.disabledName = `LS1S Disabled ${ts}`;
    // Name of the tenant we will create through the UI in the create-tenant test.
    ctx.createdName = `LS1S Created ${ts}`;
    ctx.createdAdminEmail = `ls1s_created_admin_${ts}@test.local`;

    async function makeTenant(name, { type = 'managed', active = true, requireSub = true } = {}) {
      const { data: tenant, error } = await supabase.from('tenants').insert({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + ts,
        tenant_type: type,
        is_active: active,
      }).select().single();
      if (error) throw error;
      ctx.ids.tenantIds.push(tenant.id);
      await supabase.from('tenant_settings').insert({
        tenant_id: tenant.id,
        require_subscription: requireSub,
      });
      return tenant;
    }

    // Insert a grantee (no auth user needed — user_id is nullable) plus a manual
    // subscription waiver (user_memberships.source = 'manual') so we can prove the
    // re-require cleanup behaviour.
    async function makeGranteeWithManualWaiver(tenantId, label) {
      const { data: user, error } = await supabase.from('users').insert({
        tenant_id: tenantId,
        user_id: null,
        email: `ls1s_${label}_${ts}@test.local`,
        role: 'grantee',
        firstname: 'Waiver',
        lastname: 'Grantee',
        organization_name: label,
        phone_number: '555-0000',
      }).select().single();
      if (error) throw error;
      ctx.ids.userIds.push(user.id);
      const { data: mem, error: mErr } = await supabase.from('user_memberships').insert({
        user_id: user.id,
        membership_tier: 'basic',
        is_active: true,
        source: 'manual',
        starts_at: new Date().toISOString(),
      }).select().single();
      if (mErr) throw mErr;
      ctx.ids.membershipIds.push(mem.id);
      return { user, membership: mem };
    }

    // Super-admin user lives in its own managed home tenant (users.tenant_id NOT NULL).
    // The home tenant has NO support_email so the footer falls through to the
    // platform default — that is what the §9 precedence test asserts.
    const home = await makeTenant(ctx.homeName, { requireSub: false });
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

    // Self-service tenant (require_subscription=true) with a grantee holding a manual
    // waiver — re-requiring must auto-remove the waiver.
    const self = await makeTenant(ctx.selfName, { type: 'self_service', requireSub: true });
    ctx.selfTenantId = self.id;
    const selfGrantee = await makeGranteeWithManualWaiver(self.id, 'self');
    ctx.selfGranteeUserId = selfGrantee.user.id;

    // Managed tenant with a grantee holding a manual waiver — re-requiring must NOT
    // touch managed waivers (those are per-user, managed by the tenant admin).
    const managed = await makeTenant(ctx.managedName, { type: 'managed', requireSub: true });
    ctx.managedTenantId = managed.id;
    const managedGrantee = await makeGranteeWithManualWaiver(managed.id, 'managed');
    ctx.managedGranteeUserId = managedGrantee.user.id;

    // A disabled managed tenant so the Status=Disabled filter has something to show.
    const disabled = await makeTenant(ctx.disabledName, { active: false });
    ctx.disabledTenantId = disabled.id;

    // Snapshot platform settings so the §9 test can restore them afterwards.
    const { data: ps } = await supabase
      .from('platform_settings')
      .select('default_support_email, default_support_phone, alert_webhook_url')
      .eq('id', 1).single();
    ctx.origPlatform = ps || {};
  });

  test.afterAll(async ({ supabase }) => {
    const { ids } = ctx;
    // Restore platform settings (singleton, id=1) to its pre-test values.
    if (ctx.origPlatform) {
      await supabase.from('platform_settings').update({
        default_support_email: ctx.origPlatform.default_support_email,
        default_support_phone: ctx.origPlatform.default_support_phone,
        alert_webhook_url: ctx.origPlatform.alert_webhook_url,
      }).eq('id', 1);
    }

    // Tear down the tenant created through the UI (CASCADE handles its invite/settings,
    // but delete children explicitly to be safe).
    const { data: created } = await supabase.from('tenants').select('id').eq('name', ctx.createdName);
    const createdIds = (created || []).map(t => t.id);
    if (createdIds.length) {
      await supabase.from('invites').delete().in('tenant_id', createdIds);
      await supabase.from('tenant_settings').delete().in('tenant_id', createdIds);
      await supabase.from('users').delete().in('tenant_id', createdIds);
      await supabase.from('tenants').delete().in('id', createdIds);
    }

    // user_memberships cascade when their user is deleted, but clear explicitly first.
    await supabase.from('user_memberships').delete().in('id', ids.membershipIds.length ? ids.membershipIds : [-1]);
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

  function tenantRow(page, name) {
    return page.locator('tr', { hasText: name });
  }

  // ── §2 Stat cards + search / type / status / date-range filters ───────────────
  test('shows tenant stat cards and filters by search, type, status, date range', async ({ page }) => {
    await loginSuper(page);

    // Stat cards: Total Tenants + Total Users, each rendering a numeric value.
    const totalTenants = page.locator('.admin-stat-card', { hasText: 'Total Tenants' });
    const totalUsers = page.locator('.admin-stat-card', { hasText: 'Total Users' });
    await expect(totalTenants.locator('.asc-value')).toHaveText(/^\d+$/);
    await expect(totalUsers.locator('.asc-value')).toHaveText(/^\d+$/);

    const searchInput = page.locator('.admin-search-box input');
    const subtitle = page.locator('.admin-subtitle');

    // Search by name -> subtitle reflects the match count and only that row shows.
    await searchInput.fill(ctx.selfName);
    await expect(subtitle).toContainText('1 tenant matching search');
    await expect(tenantRow(page, ctx.selfName)).toBeVisible();
    await expect(tenantRow(page, ctx.homeName)).toHaveCount(0);
    await searchInput.fill('');

    // Type filter: first select = Type. Self-service shows the self tenant, hides managed home.
    const typeSelect = page.locator('.admin-toolbar select').nth(0);
    const statusSelect = page.locator('.admin-toolbar select').nth(1);
    await typeSelect.selectOption('self_service');
    await expect(tenantRow(page, ctx.selfName)).toBeVisible();
    await expect(tenantRow(page, ctx.homeName)).toHaveCount(0);
    await typeSelect.selectOption('managed');
    await expect(tenantRow(page, ctx.homeName)).toBeVisible();
    await expect(tenantRow(page, ctx.selfName)).toHaveCount(0);
    await typeSelect.selectOption('');

    // Status filter: Disabled shows the disabled tenant and hides an active one.
    await statusSelect.selectOption('disabled');
    await expect(tenantRow(page, ctx.disabledName)).toBeVisible();
    await expect(tenantRow(page, ctx.homeName)).toHaveCount(0);
    await statusSelect.selectOption('active');
    await expect(tenantRow(page, ctx.homeName)).toBeVisible();
    await expect(tenantRow(page, ctx.disabledName)).toHaveCount(0);
    await statusSelect.selectOption('');

    // Date-range guard: setting "Created to" constrains the max of "Created from"
    // (the UI prevents picking a "from" later than "to").
    const fromInput = page.getByTitle('Created from');
    const toInput = page.getByTitle('Created to');
    await toInput.fill('2025-06-01');
    await expect(fromInput).toHaveAttribute('max', '2025-06-01');
    await toInput.fill('');

    // A future "from" date excludes every tenant -> subtitle shows 0.
    await fromInput.fill('2099-01-01');
    await expect(subtitle).toContainText('0 tenant');
    await expect(tenantRow(page, ctx.homeName)).toHaveCount(0);
  });

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

    // Copy button gives the "Copied!" confirmation.
    const copyBtn = createCard.getByRole('button', { name: /Copy/i });
    await copyBtn.click();
    await expect(createCard.getByRole('button', { name: 'Copied!' })).toBeVisible();

    // The new tenant appears in the table with all three approval columns "Required".
    const row = tenantRow(page, ctx.createdName);
    await expect(row).toBeVisible();
    await expect(row.locator('.user-role-pill')).toContainText('Managed');
    // Grants / Budgets / Expenses are columns 4-6 (0-indexed 3-5); each shows "Required".
    for (const i of [3, 4, 5]) {
      await expect(row.locator('td').nth(i)).toContainText('Required');
    }

    // The invite was persisted for this tenant.
    const { data: tenant } = await ctx.supabase.from('tenants').select('id').eq('name', ctx.createdName).single();
    const { data: invites } = await ctx.supabase.from('invites').select('role').eq('tenant_id', tenant.id);
    expect(invites.length).toBe(1);
    expect(invites[0].role).toBe('admin');
  });

  // ── §9 Platform-defaults footer fallback precedence ──────────────────────────
  test('footer falls back to platform default support email and updates when it changes', async ({ page }) => {
    await loginSuper(page);

    // The super-admin's home tenant sets no support_email, so the footer shows the
    // platform default (2nd-priority fallback), never the hardcoded value while a
    // platform default exists.
    const newEmail = `ls1s-support-${ctx.ts}@granttrail.test`;
    const card = page.locator('.admin-card', { hasText: 'Platform Defaults' });
    await card.locator('input[type="email"]').fill(newEmail);

    const savePromise = page.waitForResponse(r =>
      r.url().includes('platform_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await card.getByRole('button', { name: /Save Platform Defaults/i }).click();
    await savePromise;
    await expect(card.getByText('Platform settings saved.')).toBeVisible();

    // Reload so App refetches platform_settings, then the footer reflects the default.
    await page.reload();
    await page.waitForURL('**/super/tenants');
    const footer = page.locator('.footer-contact');
    await expect(footer).toContainText(newEmail);
    await expect(footer).not.toContainText('support@granttrail.org');
  });

  // ── §10 Exempt / Require subscription + self-service waiver auto-removal ──────
  test('toggles a self-service tenant Exempt/Required and auto-removes its manual waiver', async ({ page }) => {
    await loginSuper(page);

    await page.locator('.admin-search-box input').fill(ctx.selfName);
    const row = tenantRow(page, ctx.selfName);
    await expect(row).toBeVisible();

    // Precondition: the self-service grantee holds a manual waiver.
    const { data: before } = await ctx.supabase
      .from('user_memberships').select('id').eq('user_id', ctx.selfGranteeUserId).eq('source', 'manual');
    expect(before.length).toBe(1);

    // Required -> Exempt.
    await expect(row.getByRole('button', { name: 'Required' })).toBeVisible();
    let patch = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Required' }).click();
    await patch;
    await expect(row.getByRole('button', { name: 'Exempt' })).toBeVisible();
    await expect.poll(async () => {
      const { data } = await ctx.supabase.from('tenant_settings').select('require_subscription').eq('tenant_id', ctx.selfTenantId).single();
      return data.require_subscription;
    }).toBe(false);

    // Exempt -> Required: re-requiring removes the self-service tenant's manual waiver.
    patch = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Exempt' }).click();
    await patch;
    await expect(row.getByRole('button', { name: 'Required' })).toBeVisible();
    await expect.poll(async () => {
      const { data } = await ctx.supabase.from('tenant_settings').select('require_subscription').eq('tenant_id', ctx.selfTenantId).single();
      return data.require_subscription;
    }).toBe(true);
    await expect.poll(async () => {
      const { data } = await ctx.supabase
        .from('user_memberships').select('id').eq('user_id', ctx.selfGranteeUserId).eq('source', 'manual');
      return data.length;
    }).toBe(0);
  });

  test('re-requiring a managed tenant keeps its per-user manual waiver', async ({ page }) => {
    await loginSuper(page);

    await page.locator('.admin-search-box input').fill(ctx.managedName);
    const row = tenantRow(page, ctx.managedName);
    await expect(row).toBeVisible();

    // Required -> Exempt -> Required, same as a self-service tenant…
    let patch = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Required' }).click();
    await patch;
    await expect(row.getByRole('button', { name: 'Exempt' })).toBeVisible();

    patch = page.waitForResponse(r =>
      r.url().includes('/rest/v1/tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Exempt' }).click();
    await patch;
    await expect(row.getByRole('button', { name: 'Required' })).toBeVisible();

    // …but the managed tenant's per-user manual waiver is preserved.
    await expect.poll(async () => {
      const { data } = await ctx.supabase
        .from('user_memberships').select('id').eq('user_id', ctx.managedGranteeUserId).eq('source', 'manual');
      return data.length;
    }).toBe(1);
  });
});
