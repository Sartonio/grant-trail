const { test, expect } = require('./fixtures');

// =============================================================================
// LS1 Lane A — Tenant Admin happy-path journeys (trimmed).
//
// Keeps only the admin flows that need a full browser + real Supabase stack:
//   §4 Grant review — REJECT path + status-history timeline + add comment
//   §6 Expenses — view a receipt (signed URL) + approve / reject
//
// Removed and pushed down the pyramid:
//   - dashboard stat cards / charts / review-queue / support-nudge, all-grants
//     search / pending toggles / sort, support-contact + approval-setting forms
//        -> component concerns (frontend vitest) / already in admin-flows.spec.js
//   - auto-approve on/off rule, totals roll-up, subscription exemption
//        -> supabase/tests/grant-trigger-behaviors.test.sh
//   - budget/expense approve-reject propagation to the grantee, the
//     budget-reject -> expense-reset cascade, disbursed-funds visibility,
//     subscription waive/remove gating
//        -> cross-role-visibility.spec.js
//
// Selectors read from AdminGrantReview.js. One managed tenant (admin + grantee +
// two grants) is seeded in beforeAll and torn down in afterAll.
// =============================================================================
test.describe('Admin walkthrough', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  const ctx = {};

  test.beforeAll(async ({ supabase }) => {
    ctx.supabase = supabase;
    const ts = Date.now();
    ctx.password = 'TestPassword123!';
    ctx.adminEmail = `admin_wt_${ts}@test.local`;
    ctx.granteeEmail = `grantee_wt_${ts}@test.local`;
    const org = `Admin WT Org ${ts}`;

    ctx.ids = {
      authUids: [], userIds: [], tenantIds: [], grantIds: [],
      budgetIds: [], expenseIds: [], receiptStoragePaths: [],
    };

    const { data: adminAuth, error: aErr } = await supabase.auth.admin.createUser({
      email: ctx.adminEmail, password: ctx.password, email_confirm: true });
    if (aErr) throw aErr;
    ctx.ids.authUids.push(adminAuth.user.id);

    const { data: granteeAuth, error: gErr } = await supabase.auth.admin.createUser({
      email: ctx.granteeEmail, password: ctx.password, email_confirm: true });
    if (gErr) throw gErr;
    ctx.ids.authUids.push(granteeAuth.user.id);

    // Managed tenant, all approvals ON; admin is subscription-exempt so it keeps
    // full write access.
    const { data: tenant, error: tErr } = await supabase.from('tenants').insert({
      name: org, slug: `admin-wt-${ts}`, tenant_type: 'managed',
    }).select().single();
    if (tErr) throw tErr;
    ctx.tenantId = tenant.id;
    ctx.ids.tenantIds.push(tenant.id);

    await supabase.from('tenant_settings').insert({
      tenant_id: tenant.id,
      require_grant_approval: true,
      require_budget_approval: true,
      require_expense_approval: true,
      require_subscription: false,
    });

    const { data: admin } = await supabase.from('users').insert({
      tenant_id: tenant.id, user_id: adminAuth.user.id, email: ctx.adminEmail,
      role: 'admin', firstname: 'Adam', lastname: 'Min', organization_name: org, phone_number: '555-0000',
    }).select().single();
    ctx.adminUserId = admin.id;
    ctx.ids.userIds.push(admin.id);

    const { data: grantee } = await supabase.from('users').insert({
      tenant_id: tenant.id, user_id: granteeAuth.user.id, email: ctx.granteeEmail,
      role: 'grantee', firstname: 'Greta', lastname: 'Knee', organization_name: `Helping Hands ${ts}`, phone_number: '555-0001',
    }).select().single();
    ctx.granteeUserId = grantee.id;
    ctx.ids.userIds.push(grantee.id);

    const mkGrant = async (name, status) => {
      const { data, error } = await supabase.from('grant_record').insert({
        user_id: grantee.id, tenant_id: tenant.id, grant_name: name,
        grant_amount: 10000, status,
        start_spend_period: '2025-01-01', end_spend_period: '2025-12-31',
      }).select().single();
      if (error) throw error;
      ctx.ids.grantIds.push(data.id);
      return data;
    };

    ctx.gReject   = await mkGrant(`WT-Reject ${ts}`,   'pending');   // §4 reject + history + comment
    ctx.gExpenses = await mkGrant(`WT-Expenses ${ts}`, 'approved');  // §6 expense approve/reject + receipt

    // §6 — an approved budget item with two pending expenses; one has a receipt.
    const { data: biCharlie } = await supabase.from('budget_items').insert({
      grant_id: ctx.gExpenses.id, item_name: `BI Charlie ${ts}`, budget_allocated: 6000, status: 'approved',
    }).select().single();
    ctx.ids.budgetIds.push(biCharlie.id);

    const mkExpense = async (name, amount) => {
      const { data, error } = await supabase.from('expenses').insert({
        grant_id: ctx.gExpenses.id, budget_item_id: biCharlie.id, item_name: name,
        amount_spent: amount, expense_date: '2025-05-10', status: 'pending',
      }).select().single();
      if (error) throw error;
      ctx.ids.expenseIds.push(data.id);
      return data;
    };
    ctx.expOne = await mkExpense(`Exp One ${ts}`, 400);
    ctx.expTwo = await mkExpense(`Exp Two ${ts}`, 250);

    // Seed a receipt (storage object + receipts row) for the view-receipt test.
    ctx.receiptPath = `receipts/${tenant.id}/${ctx.gExpenses.id}/${ctx.expOne.id}/wt-receipt-${ts}.pdf`;
    const upload = await supabase.storage.from('receipts').upload(
      ctx.receiptPath,
      Buffer.from('%PDF-1.4 e2e admin walkthrough receipt'),
      { contentType: 'application/pdf', upsert: true });
    if (upload.error) throw upload.error;
    ctx.ids.receiptStoragePaths.push(ctx.receiptPath);
    await supabase.from('receipts').insert({
      user_id: grantee.id, grant_id: ctx.gExpenses.id, expense_id: ctx.expOne.id,
      receipt_files: [{ name: 'wt-receipt.pdf', path: ctx.receiptPath, type: 'application/pdf', size: 38 }],
    });
  });

  test.afterAll(async ({ supabase }) => {
    const { ids } = ctx;
    await supabase.from('expenses').delete().in('id', ids.expenseIds.length ? ids.expenseIds : [-1]);
    await supabase.from('budget_items').delete().in('id', ids.budgetIds.length ? ids.budgetIds : [-1]);
    await supabase.from('grant_record').delete().in('id', ids.grantIds.length ? ids.grantIds : [-1]);
    await supabase.from('users').delete().in('id', ids.userIds.length ? ids.userIds : [-1]);
    await supabase.from('tenant_settings').delete().in('tenant_id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    await supabase.from('tenants').delete().in('id', ids.tenantIds.length ? ids.tenantIds : [-1]);
    if (ids.receiptStoragePaths.length) {
      await supabase.storage.from('receipts').remove(ids.receiptStoragePaths);
    }
    for (const uid of ids.authUids) await supabase.auth.admin.deleteUser(uid);
  });

  async function loginAdmin(page) {
    await page.goto('/login');
    await page.fill('#email', ctx.adminEmail);
    await page.fill('#password', ctx.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/admin', { timeout: 15000 });
  }

  // §4 — Grant review: REJECT path + status history + add comment
  test('§4 admin rejects a grant, sees status history, and adds a comment', async ({ page, supabase }) => {
    await loginAdmin(page);

    const reviewPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.status() === 200);
    await page.goto(`/admin/grants/${ctx.gReject.id}`);
    await reviewPromise;
    await expect(page.locator('.arh-title h2')).toContainText(ctx.gReject.grant_name);

    // Reject requires notes.
    await page.locator('button.action-btn.reject').click();
    await expect(page.locator('.action-form')).toBeVisible();
    await page.locator('.action-form textarea').fill('Budget figures do not reconcile with the narrative.');

    const patchPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await page.locator('button.action-submit-btn.reject').click();
    await patchPromise;

    await expect(page.locator('text=Grant rejected.')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.arh-title .status-badge.status-rejected')).toBeVisible();

    const { data: updated } = await supabase
      .from('grant_record').select('status, approval_notes').eq('id', ctx.gReject.id).single();
    expect(updated.status).toBe('rejected');
    expect(updated.approval_notes).toContain('reconcile');

    // Status History timeline records the pending → rejected transition.
    const timeline = page.locator('.status-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('.status-badge.status-rejected').first()).toBeVisible();

    // Add a comment — appears in the Comments section after posting.
    const commentBody = `Please reach out before resubmitting. ${Date.now()}`;
    await page.locator('textarea.comment-textarea').fill(commentBody);
    const commentPromise = page.waitForResponse(r =>
      r.url().includes('grant_comments') && r.request().method() === 'POST' &&
      (r.status() === 201 || r.status() === 200));
    await page.getByRole('button', { name: /Post Comment/i }).click();
    await commentPromise;

    await expect(page.locator('text=Comment posted successfully.')).toBeVisible({ timeout: 10000 });
    const comments = page.locator('.admin-card', { hasText: 'Comments' });
    await expect(comments.locator('.comment-text', { hasText: commentBody })).toBeVisible();

    const { data: rows } = await supabase
      .from('grant_comments').select('comment').eq('grant_id', ctx.gReject.id);
    expect(rows.some(r => r.comment === commentBody)).toBe(true);
  });

  // §6 — Expenses: view receipt (signed URL), approve one, reject another
  test('§6 admin views a receipt and approves/rejects expenses', async ({ page, supabase }) => {
    await loginAdmin(page);
    const expPromise = page.waitForResponse(r =>
      r.url().includes('expenses') && r.status() === 200);
    await page.goto(`/admin/grants/${ctx.gExpenses.id}`);
    await expPromise;

    const rowOne = page.locator('.admin-expense-table tbody tr', { hasText: ctx.expOne.item_name });
    const rowTwo = page.locator('.admin-expense-table tbody tr', { hasText: ctx.expTwo.item_name });
    await expect(rowOne).toBeVisible();
    await expect(rowTwo).toBeVisible();

    // The seeded receipt is viewable to the admin (a View button is rendered).
    // We assert its presence rather than opening the async signed-URL popup,
    // which is non-deterministic to read.
    await expect(rowOne.locator('button.admin-receipt-btn', { hasText: 'View' })).toBeVisible();

    // Approve expense one.
    const approvePromise = page.waitForResponse(r =>
      r.url().includes('expenses') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await rowOne.locator('button.admin-approve-btn', { hasText: 'Approve' }).click();
    await approvePromise;
    await expect(rowOne.locator('.status-badge.status-approved')).toBeVisible();

    // Reject expense two.
    const rejectPromise = page.waitForResponse(r =>
      r.url().includes('expenses') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await rowTwo.locator('button.admin-reject-btn', { hasText: 'Reject' }).click();
    await rejectPromise;
    await expect(rowTwo.locator('.status-badge.status-rejected')).toBeVisible();

    const { data: exps } = await supabase
      .from('expenses').select('id, status').in('id', [ctx.expOne.id, ctx.expTwo.id]);
    const byId = Object.fromEntries(exps.map(e => [e.id, e.status]));
    expect(byId[ctx.expOne.id]).toBe('approved');
    expect(byId[ctx.expTwo.id]).toBe('rejected');
  });
});
