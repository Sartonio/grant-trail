const { test, expect } = require('./fixtures');

test.describe('Admin Grant Review', () => {
  test.setTimeout(60000);

  test('approve a pending grant', async ({ page, supabase, testData }) => {
    const ts = Date.now();
    const adminEmail    = `admin_review_${ts}@test.local`;
    const granteeEmail  = `grantee_review_${ts}@test.local`;
    const adminPassword = 'TestPassword123!';

    // ─── 1. Provision Auth Users ────────────────────────────────────────
    const adminAuth = await testData.createAuthUser(adminEmail, adminPassword);
    const granteeAuth = await testData.createAuthUser(granteeEmail, 'TestPassword123!');

    // ─── 2. Provision Managed Tenant & Settings ──────────────────────────
    const tenant = await testData.createManagedTenant(`Review Test Org ${ts}`);
    await testData.createTenantSettings(tenant.id, {
      require_grant_approval: true,
      require_budget_approval: true,
      require_expense_approval: true,
      require_subscription: false,
    });

    // ─── 3. Provision Users ──────────────────────────────────────────────
    await testData.createUserRecord(tenant.id, adminAuth.id, adminEmail, 'admin', 'Admin', 'Reviewer', `Review Test Org ${ts}`);
    const granteeUser = await testData.createUserRecord(tenant.id, granteeAuth.id, granteeEmail, 'grantee', 'Grant', 'Recipient', `Review Test Org ${ts}`);

    // ─── 4. Provision Grant ──────────────────────────────────────────────
    const grantName = `E2E Pending Grant ${ts}`;
    const grant = await testData.createGrant(granteeUser.id, tenant.id, grantName, 'pending');

    // ─── 5. Log in as Admin ──────────────────────────────────────────────
    await page.goto('/login');
    await page.fill('#email', adminEmail);
    await page.fill('#password', adminPassword);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL('**/admin', { timeout: 15000 });

    // ─── 6. Navigate to grant review ─────────────────────────────────────
    const reviewDataPromise = page.waitForResponse(response =>
      response.url().includes('grant_record') && response.status() === 200
    );
    await page.goto(`/admin/grants/${grant.id}`);
    await reviewDataPromise;

    await expect(page.locator('.arh-title h2')).toContainText(grantName);

    // ─── 7. Approve the grant ────────────────────────────────────────────
    await page.locator('button.action-btn.approve').click();
    await expect(page.locator('.action-form')).toBeVisible();

    const approveResponsePromise = page.waitForResponse(response =>
      response.url().includes('grant_record') &&
      (response.request().method() === 'PATCH') &&
      (response.status() === 200 || response.status() === 204)
    );

    await page.locator('button.action-submit-btn.approve').click();
    await approveResponsePromise;

    await expect(page.locator('text=Grant approved.')).toBeVisible({ timeout: 10000 });

    // ─── 8. Verify the DB and Notifications ──────────────────────────────
    const { data: updatedGrant } = await supabase
      .from('grant_record')
      .select('status')
      .eq('id', grant.id)
      .single();
    expect(updatedGrant.status).toBe('approved');

    const { data: notifications } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', granteeUser.id)
      .eq('type', 'grant_approved');
    
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    const notif = notifications.find(n => n.link === `/grants/${grant.id}`);
    expect(notif).toBeTruthy();
    expect(notif.title).toBe('Grant Approved');

    console.log('Admin Grant Review: approve flow verified successfully!');
  });
});
