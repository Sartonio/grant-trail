const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

// Setup Supabase Client
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

test('Notifications and Audit Trail Flow', async ({ page }) => {
  test.skip(!supabase, 'Supabase client is not configured');
  const ts = Date.now();
  const testEmail = `notif_audit_${ts}@test.local`;
  const testPassword = 'TestPassword123!';

  let authUid = null;
  let userId = null;
  let tenantId = null;
  let grantId = null;

  try {
    // Step 1: Create auth user
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });
    expect(authErr).toBeNull();
    authUid = authData.user.id;

    // Step 2: Provision self-service tenant
    const { data: userRecord, error: provisionErr } = await supabase.rpc(
      'provision_self_service_tenant',
      {
        p_auth_uid: authUid,
        p_email: testEmail,
        p_firstname: 'Notif',
        p_lastname: 'Auditor',
        p_organization: `Notif Audit Org ${ts}`,
        p_phone: '555-1234',
        p_tax_month: 1
      }
    );
    expect(provisionErr).toBeNull();
    userId = userRecord.id;
    tenantId = userRecord.tenant_id;

    // Step 3: Insert subscription (ALL 7 NOT NULL cols)
    const { data: subData, error: subErr } = await supabase
      .from('subscriptions')
      .insert({
        user_id: userId,
        stripe_customer_id: `cus_notif_${ts}`,
        stripe_subscription_id: `sub_notif_${ts}`,
        stripe_product_id: 'prod_UKEACUGjIeg3MU', // basic
        stripe_price_id: `price_notif_${ts}`,
        membership_tier: 'basic',
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();
    expect(subErr).toBeNull();

    // Step 4: Insert user_membership (is_active=true)
    const { error: membershipErr } = await supabase
      .from('user_memberships')
      .insert({
        user_id: userId,
        subscription_id: subData.id,
        membership_tier: 'basic',
        is_active: true,
        source: 'stripe',
        starts_at: new Date().toISOString()
      });
    expect(membershipErr).toBeNull();

    // Step 5: Insert a grant_record (auto-approved in self-service tenant)
    const grantName = `E2E Notif Audit Grant ${ts}`;
    const { data: grantData, error: grantErr } = await supabase
      .from('grant_record')
      .insert({
        user_id: userId,
        grant_name: grantName,
        start_spend_period: '2025-01-01',
        end_spend_period: '2025-12-31',
        grant_amount: 10000,
      })
      .select()
      .single();
    expect(grantErr).toBeNull();
    grantId = grantData.id;

    // Verify it is auto-approved
    expect(grantData.status).toBe('approved');

    // Step 6: Update the grant status to trigger notifications
    // Set status to 'needs_changes' (triggers notify_grant_status_change -> inserts notification)
    const { error: update1Err } = await supabase
      .from('grant_record')
      .update({ status: 'needs_changes' })
      .eq('id', grantId);
    expect(update1Err).toBeNull();

    // Set back to 'approved' (triggers another notification)
    const { error: update2Err } = await supabase
      .from('grant_record')
      .update({ status: 'approved' })
      .eq('id', grantId);
    expect(update2Err).toBeNull();

    // Step 7: Log in as the user via browser
    await page.goto('/login');
    await page.fill('#email', testEmail);
    await page.fill('#password', testPassword);

    // Use waitForResponse() before interacting with data-dependent UI
    const notifResponsePromise = page.waitForResponse(
      response => response.url().includes('/rest/v1/notifications') && response.status() === 200
    );
    await page.locator('button[type="submit"]').click();

    // Wait for login redirect to settle (grantees navigate to '/')
    await page.waitForURL(url => url.pathname === '/', { timeout: 10000 });
    await notifResponsePromise;

    // Step 8: Verify the notification bell shows a badge count
    const badge = page.locator('.notification-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');

    // Step 9: Click the bell and verify notification text mentions the grant
    await page.locator('.notification-bell-trigger').click();
    const panel = page.locator('.notification-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(grantName);
    await expect(panel).toContainText('requires changes');
    await expect(panel).toContainText('has been approved');

    // Step 10: Query audit_log directly via Supabase to verify entries exist for the status changes
    const { data: auditLogs, error: auditErr } = await supabase
      .from('audit_log')
      .select('*')
      .eq('table_name', 'grant_record')
      .eq('record_id', grantId);
    expect(auditErr).toBeNull();

    // Verify that we have update entries with new_values.status matching 'needs_changes' and 'approved'
    const statusChanges = auditLogs
      .filter(log => log.action === 'UPDATE')
      .map(log => log.new_values.status);
    
    expect(statusChanges).toContain('needs_changes');
    expect(statusChanges).toContain('approved');

  } finally {
    // Cleanup seeded data in reverse order (bottom-up) to avoid FK violations in audit triggers
    if (grantId) {
      const { error: grantDelErr } = await supabase
        .from('grant_record')
        .delete()
        .eq('id', grantId);
      expect(grantDelErr).toBeNull();
    }
    if (userId) {
      const { error: userDelErr } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);
      expect(userDelErr).toBeNull();
    }
    if (tenantId) {
      const { error: tenantDelErr } = await supabase
        .from('tenants')
        .delete()
        .eq('id', tenantId);
      expect(tenantDelErr).toBeNull();
    }
    if (authUid) {
      const { error: authDelErr } = await supabase.auth.admin.deleteUser(authUid);
      expect(authDelErr).toBeNull();
    }
  }
});
