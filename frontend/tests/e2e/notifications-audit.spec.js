const { test, expect } = require('./fixtures');

test('Notifications and Audit Trail Flow', async ({ page, supabase, testData }) => {
  const ts = Date.now();
  const testEmail = `notif_audit_${ts}@test.local`;
  const testPassword = 'TestPassword123!';

  // Step 1: Provision test data using fixtures
  const authUser = await testData.createAuthUser(testEmail, testPassword);
  const userRecord = await testData.provisionSelfServiceTenant(
    authUser.id, testEmail, 'Notif', 'Auditor', `Notif Audit Org ${ts}`
  );
  
  await testData.createSubscription(userRecord.id, 'basic', 'active');
  
  const grant = await testData.createGrant(userRecord.id, null, `E2E Notif Audit Grant ${ts}`, 'approved');

  // Step 2: Trigger state changes
  // Set status to 'needs_changes' (triggers notification)
  await supabase.from('grant_record').update({ status: 'needs_changes' }).eq('id', grant.id);
  // Set back to 'approved' (triggers another notification)
  await supabase.from('grant_record').update({ status: 'approved' }).eq('id', grant.id);

  // Step 3: Log in as the user via browser
  await page.goto('/login');
  await page.fill('#email', testEmail);
  await page.fill('#password', testPassword);

  const notifResponsePromise = page.waitForResponse(
    response => response.url().includes('/rest/v1/notifications') && response.status() === 200
  );
  await page.locator('button[type="submit"]').click();

  await page.waitForURL(url => url.pathname === '/', { timeout: 10000 });
  await notifResponsePromise;

  // Step 4: Verify the notification bell
  const badge = page.locator('.notification-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('2');

  await page.locator('.notification-bell-trigger').click();
  const panel = page.locator('.notification-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(grant.grant_name);
  await expect(panel).toContainText('requires changes');
  await expect(panel).toContainText('has been approved');

  // Step 5: Verify audit logs
  const { data: auditLogs } = await supabase
    .from('audit_log')
    .select('*')
    .eq('table_name', 'grant_record')
    .eq('record_id', grant.id);

  const statusChanges = auditLogs
    .filter(log => log.action === 'UPDATE')
    .map(log => log.new_values.status);
  
  expect(statusChanges).toContain('needs_changes');
  expect(statusChanges).toContain('approved');
});
