const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

test.describe('Admin Grant Review', () => {
  // Allow 60s for the full seed + login + review cycle
  test.setTimeout(60000);

  test('approve a pending grant', async ({ page }) => {
    // ─── 1. Setup service-role Supabase client ─────────────────────
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      test.skip(true, 'Supabase credentials are not configured');
      return;
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const ts = Date.now();
    const adminEmail    = `admin_review_${ts}@test.local`;
    const granteeEmail  = `grantee_review_${ts}@test.local`;
    const adminPassword = 'TestPassword123!';

    // ─── 2. Seed auth users ────────────────────────────────────────
    const { data: adminAuth, error: adminAuthErr } =
      await supabase.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
      });
    expect(adminAuthErr).toBeNull();
    const adminUid = adminAuth.user.id;

    const { data: granteeAuth, error: granteeAuthErr } =
      await supabase.auth.admin.createUser({
        email: granteeEmail,
        password: 'TestPassword123!',
        email_confirm: true,
      });
    expect(granteeAuthErr).toBeNull();
    const granteeUid = granteeAuth.user.id;

    // ─── 3. Seed tenant (managed) ──────────────────────────────────
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        name: `Review Test Org ${ts}`,
        slug: `review-test-${ts}`,
        tenant_type: 'managed',
      })
      .select()
      .single();
    expect(tenantErr).toBeNull();
    const tenantId = tenant.id;

    // ─── 4. Seed tenant_settings ───────────────────────────────────
    const { error: settingsErr } = await supabase
      .from('tenant_settings')
      .insert({
        tenant_id: tenantId,
        require_grant_approval: true,
        require_budget_approval: true,
        require_expense_approval: true,
        require_subscription: false,   // exempt from billing
      });
    expect(settingsErr).toBeNull();

    // ─── 5. Seed admin user record ─────────────────────────────────
    const { data: adminUser, error: adminUserErr } = await supabase
      .from('users')
      .insert({
        tenant_id: tenantId,
        firstname: 'Admin',
        lastname: 'Reviewer',
        organization_name: `Review Test Org ${ts}`,
        email: adminEmail,
        phone_number: '555-0001',
        user_id: adminUid,
        role: 'admin',
      })
      .select()
      .single();
    expect(adminUserErr).toBeNull();

    // ─── 6. Seed grantee user record ───────────────────────────────
    const { data: granteeUser, error: granteeUserErr } = await supabase
      .from('users')
      .insert({
        tenant_id: tenantId,
        firstname: 'Grant',
        lastname: 'Recipient',
        organization_name: `Review Test Org ${ts}`,
        email: granteeEmail,
        phone_number: '555-0002',
        user_id: granteeUid,
        role: 'grantee',
      })
      .select()
      .single();
    expect(granteeUserErr).toBeNull();
    const granteeUserId = granteeUser.id;   // integer PK

    // ─── 7. Seed a pending grant_record ────────────────────────────
    const grantName = `E2E Pending Grant ${ts}`;
    const { data: grant, error: grantErr } = await supabase
      .from('grant_record')
      .insert({
        tenant_id: tenantId,
        user_id: granteeUserId,
        grant_name: grantName,
        description: 'A grant created for E2E admin review testing.',
        grant_amount: 5000,
        status: 'pending',
        start_spend_period: '2025-01-01',
        end_spend_period: '2025-12-31',
      })
      .select()
      .single();
    expect(grantErr).toBeNull();
    const grantId = grant.id;

    // ─── 8. Log in as the admin via the browser ────────────────────
    await page.goto('/login');
    await page.fill('#email', adminEmail);
    await page.fill('#password', adminPassword);
    await page.locator('button[type="submit"]').click();

    // Login.js navigates admins to '/admin'
    await page.waitForURL('**/admin', { timeout: 15000 });

    // ─── 9. Navigate to the admin grant review page ────────────────
    //    Wait for the grant_record API call to complete before interacting
    const reviewDataPromise = page.waitForResponse(response =>
      response.url().includes('grant_record') && response.status() === 200
    );
    await page.goto(`/admin/grants/${grantId}`);
    await reviewDataPromise;

    // Verify we landed on the review page by checking the grant name
    await expect(page.locator('.arh-title h2')).toContainText(grantName);

    // ─── 10. Approve the grant ─────────────────────────────────────
    //    Click the "Approve" action button in the sidebar
    await page.locator('button.action-btn.approve').click();

    // The action form should now be visible
    await expect(page.locator('.action-form')).toBeVisible();

    // Set up response listener BEFORE clicking submit.
    // Supabase REST uses PATCH for .update() and returns 200 or 204.
    const approveResponsePromise = page.waitForResponse(response =>
      response.url().includes('grant_record') &&
      (response.request().method() === 'PATCH') &&
      (response.status() === 200 || response.status() === 204)
    );

    // Click "Confirm: Approve"
    await page.locator('button.action-submit-btn.approve').click();
    await approveResponsePromise;

    // Verify success message appears in the UI
    await expect(page.locator('text=Grant approved.')).toBeVisible({ timeout: 10000 });

    // ─── 11. Verify the grant status changed in the database ───────
    const { data: updatedGrant, error: fetchErr } = await supabase
      .from('grant_record')
      .select('status')
      .eq('id', grantId)
      .single();
    expect(fetchErr).toBeNull();
    expect(updatedGrant.status).toBe('approved');

    // ─── 12. Verify a notification was created for the grantee ─────
    //    The DB trigger trg_notify_grant_status inserts a notification
    //    of type 'grant_approved' targeting the grantee's integer PK.
    const { data: notifications, error: notifErr } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', granteeUserId)
      .eq('type', 'grant_approved');
    expect(notifErr).toBeNull();
    expect(notifications.length).toBeGreaterThanOrEqual(1);

    const notif = notifications.find(n => n.link === `/grants/${grantId}`);
    expect(notif).toBeTruthy();
    expect(notif.title).toBe('Grant Approved');

    console.log('Admin Grant Review: approve flow verified successfully!');
  });
});
