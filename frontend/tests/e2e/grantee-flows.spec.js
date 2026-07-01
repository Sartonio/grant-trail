const { test, expect, loginAs, seedMembership } = require('./fixtures');

// Grantee-facing flows not already covered by workspace.spec.js / reporting.spec.js:
//   - Grant detail status-history timeline
//   - Attachment upload + listing
//   - Expense report CSV export
//
// A single self-service grantee with an active subscription is seeded once and
// reused across the tests in this describe block to keep runtime reasonable.
test.describe('Grantee detail, attachments & exports', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  const ctx = {};

  test.beforeAll(async ({ browser, supabase }) => {
    // Service-role client + a manual registry teardown (beforeAll runs outside
    // the per-test `testData` fixture, so we track and clean up ourselves).
    ctx.ids = { authUids: [], userIds: [], tenantIds: [], grantIds: [], budgetIds: [], expenseIds: [], subscriptionIds: [], attachmentIds: [] };

    const ts = Date.now();
    ctx.email = `grantee_flows_${ts}@test.local`;
    ctx.password = 'TestPassword123!';

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: ctx.email, password: ctx.password, email_confirm: true,
    });
    if (authErr) throw authErr;
    ctx.authUid = authData.user.id;
    ctx.ids.authUids.push(ctx.authUid);

    const { data: userRec, error: provErr } = await supabase.rpc('provision_self_service_tenant', {
      p_auth_uid: ctx.authUid, p_email: ctx.email,
      p_firstname: 'Grantee', p_lastname: 'Flows', p_organization: `Grantee Flows Org ${ts}`,
      p_phone: '555-0000', p_tax_month: 1,
    });
    if (provErr) throw provErr;
    ctx.userId = userRec.id;
    ctx.tenantId = userRec.tenant_id;
    ctx.ids.userIds.push(userRec.id);
    ctx.ids.tenantIds.push(userRec.tenant_id);

    // Active basic subscription so the grantee passes the membership gate.
    // seedMembership reads the live product id, so this stays valid regardless
    // of which seed the stack is running.
    await seedMembership(supabase, ctx.ids, ctx.userId, 'basic');

    // A grant with a status history (pending -> needs_changes -> approved) and an
    // expense so the CSV export has a row.
    const { data: grant } = await supabase.from('grant_record').insert({
      user_id: ctx.userId, tenant_id: ctx.tenantId,
      grant_name: `Grantee Flows Grant ${ts}`, grant_amount: 10000,
      status: 'pending', start_spend_period: '2025-01-01', end_spend_period: '2025-12-31',
    }).select().single();
    ctx.grantId = grant.id;
    ctx.grantName = grant.grant_name;
    ctx.ids.grantIds.push(grant.id);

    // Drive status transitions so grant_status_history rows are written by the trigger.
    await supabase.from('grant_record').update({ status: 'needs_changes' }).eq('id', grant.id);
    await supabase.from('grant_record').update({ status: 'approved' }).eq('id', grant.id);

    const { data: budget } = await supabase.from('budget_items').insert({
      grant_id: grant.id, item_name: 'Operations', budget_allocated: 5000,
    }).select().single();
    ctx.ids.budgetIds.push(budget.id);
    const { data: expense } = await supabase.from('expenses').insert({
      grant_id: grant.id, budget_item_id: budget.id, item_name: 'Printer Paper',
      amount_spent: 320, expense_date: '2025-05-10',
    }).select().single();
    ctx.ids.expenseIds.push(expense.id);

    ctx.supabase = supabase;
  });

  test.afterAll(async ({ supabase }) => {
    const { ids } = ctx;
    await supabase.from('grant_attachments').delete().in('id', ids.attachmentIds.length ? ids.attachmentIds : [-1]);
    await supabase.from('expenses').delete().in('id', ids.expenseIds.length ? ids.expenseIds : [-1]);
    await supabase.from('budget_items').delete().in('id', ids.budgetIds.length ? ids.budgetIds : [-1]);
    await supabase.from('grant_record').delete().in('id', ids.grantIds.length ? ids.grantIds : [-1]);
    await supabase.from('user_memberships').delete().in('subscription_id', ids.subscriptionIds.length ? ids.subscriptionIds : [-1]);
    await supabase.from('subscriptions').delete().in('id', ids.subscriptionIds.length ? ids.subscriptionIds : [-1]);
    await supabase.from('users').delete().in('id', ids.userIds.length ? ids.userIds : [-1]);
    await supabase.from('tenant_settings').delete().in('tenant_id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    await supabase.from('tenants').delete().in('id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    for (const uid of ids.authUids) await supabase.auth.admin.deleteUser(uid);
  });

  const login = (page) => loginAs(page, ctx.email, url => url.pathname === '/' || url.pathname === '/home');

  test('grant detail shows the status-history timeline', async ({ page }) => {
    await login(page);

    const historyPromise = page.waitForResponse(r =>
      r.url().includes('grant_status_history') && r.status() === 200);
    await page.goto(`/grants/${ctx.grantId}`);
    await historyPromise;

    // Banner shows the grant name + approved badge.
    await expect(page.locator('.detail-banner-title h2')).toContainText(ctx.grantName);

    // Status History section renders the transitions written by the DB trigger.
    const timeline = page.locator('.status-timeline');
    await expect(timeline).toBeVisible();
    const entries = timeline.locator('.timeline-entry');
    // pending->needs_changes and needs_changes->approved => at least 2 entries.
    await expect(entries).toHaveCount(await entries.count());
    expect(await entries.count()).toBeGreaterThanOrEqual(2);
    await expect(timeline.getByText('approved', { exact: false }).first()).toBeVisible();
  });

  test('grantee can upload an attachment and see it listed', async ({ page }) => {
    await login(page);

    await page.goto(`/grants/${ctx.grantId}`);
    await expect(page.locator('.detail-banner-title h2')).toContainText(ctx.grantName);

    // Attachments section starts empty.
    const attachments = page.locator('.detail-section', { hasText: 'Attachments' });
    await expect(attachments.locator('.ga-empty')).toBeVisible();

    // Set the hidden file input directly (deterministic, no OS dialog).
    const fileName = `proposal-${Date.now()}.pdf`;
    await page.locator('.ga-file-area input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 e2e test attachment'),
    });
    await expect(page.locator('.ga-file-selected')).toContainText(fileName);

    await page.locator('.ga-desc-input').fill('E2E uploaded proposal');

    const insertPromise = page.waitForResponse(r =>
      r.url().includes('grant_attachments') &&
      r.request().method() === 'POST' &&
      (r.status() === 201 || r.status() === 200));
    await page.locator('.ga-upload-btn').click();
    await insertPromise;

    // The new attachment appears in the list.
    const item = page.locator('.ga-item', { hasText: fileName });
    await expect(item).toBeVisible();
    await expect(item).toContainText('E2E uploaded proposal');

    // Verify the DB row and register it for teardown.
    const { data: rows } = await ctx.supabase
      .from('grant_attachments').select('id').eq('grant_id', ctx.grantId).eq('file_name', fileName);
    expect(rows.length).toBe(1);
    ctx.ids.attachmentIds.push(rows[0].id);
  });

  test('grantee can export the expense report as CSV', async ({ page }) => {
    await login(page);

    const expensesPromise = page.waitForResponse(r =>
      r.url().includes('expenses') && r.status() === 200);
    await page.goto('/expenses');
    await expensesPromise;

    await expect(page.locator('td.item-name', { hasText: 'Printer Paper' })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export CSV/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/expense-report.*\.csv/);
  });
});
