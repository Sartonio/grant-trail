const { test, expect } = require('./fixtures');

// =============================================================================
// LS1 Lane A — Tenant Admin walkthrough (docs/tutorials/Admin-Walkthrough.md)
//
// Drives a tenant admin step by step through the Admin walkthrough, covering the
// GAPS called out in docs/roadmap/AGENT_PROMPTS_LS1.md that are NOT already
// exercised by admin-review.spec.js (approve a grant), admin-flows.spec.js
// (request-changes, invite, role promote, settings save, audit log, CSV export)
// or subscription.spec.js (admin read-only lapse):
//
//   §2  Admin dashboard — stat cards, charts, pending review queue, support nudge
//   §3  All Grants — search, pending-budget/expense toggles, sort, columns
//   §4  Grant review — REJECT path + status history + add comment; disbursed funds
//   §5  Budget items — approve & reject
//   §6  Expenses — approve & reject, view receipt (signed URL), and the
//        budget-reject → linked-expenses-reset-to-pending cascade
//   §7  Users — disable & re-enable
//   §9  Approval settings — toggle effects on NEWLY created records
//   §12 Support contact — configure email/phone, nudge banner clears
//   §13 Subscriptions — waive & remove-waiver on a grantee
//
// Selectors/behavior were read from the real components:
//   frontend/src/components/AdminDashboard.js, AdminGrantList.js,
//   AdminGrantReview.js, AdminUserList.js, AdminSettings.js, StatusBadge.js
//   and the auto-approve / set_tenant_from_grant triggers in
//   supabase/migrations/20260616000000_initial_schema.sql
//
// One managed tenant (admin + grantee + several grants) is seeded once in
// beforeAll using the service-role patterns from fixtures.js, and torn down in
// afterAll. Grant deletes cascade to budget_items/expenses/comments/history/
// receipts (ON DELETE CASCADE), so those need no separate registry; we clean up
// the user_membership created by the waive test and the storage receipt object
// explicitly.
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

    // Registry for teardown (grant deletes cascade to their children).
    ctx.ids = {
      authUids: [], userIds: [], tenantIds: [], grantIds: [],
      budgetIds: [], expenseIds: [], receiptStoragePaths: [],
    };

    // ── Auth users ──────────────────────────────────────────────────────────
    const { data: adminAuth, error: aErr } = await supabase.auth.admin.createUser({
      email: ctx.adminEmail, password: ctx.password, email_confirm: true });
    if (aErr) throw aErr;
    ctx.ids.authUids.push(adminAuth.user.id);

    const { data: granteeAuth, error: gErr } = await supabase.auth.admin.createUser({
      email: ctx.granteeEmail, password: ctx.password, email_confirm: true });
    if (gErr) throw gErr;
    ctx.ids.authUids.push(granteeAuth.user.id);

    // ── Managed tenant + settings (all approvals ON, no support contact) ──────
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
      require_subscription: false, // admin keeps full write access
      support_email: null,
      support_phone: null,
    });

    // ── Users ─────────────────────────────────────────────────────────────────
    const { data: admin } = await supabase.from('users').insert({
      tenant_id: tenant.id, user_id: adminAuth.user.id, email: ctx.adminEmail,
      role: 'admin', firstname: 'Adam', lastname: 'Min', organization_name: org, phone_number: '555-0000',
    }).select().single();
    ctx.adminUserId = admin.id;
    ctx.adminAuthUid = adminAuth.user.id;
    ctx.ids.userIds.push(admin.id);

    const { data: grantee } = await supabase.from('users').insert({
      tenant_id: tenant.id, user_id: granteeAuth.user.id, email: ctx.granteeEmail,
      role: 'grantee', firstname: 'Greta', lastname: 'Knee', organization_name: `Helping Hands ${ts}`, phone_number: '555-0001',
    }).select().single();
    ctx.granteeUserId = grantee.id;
    ctx.granteeName = 'Greta Knee';
    ctx.ids.userIds.push(grantee.id);

    // ── Grants ──────────────────────────────────────────────────────────────
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
    ctx.gDisb     = await mkGrant(`WT-Disb ${ts}`,     'approved');  // §4 disbursed funds card
    ctx.gBudgets  = await mkGrant(`WT-Budgets ${ts}`,  'approved');  // §5 budget item approve/reject
    ctx.gExpenses = await mkGrant(`WT-Expenses ${ts}`, 'approved');  // §6 expense approve/reject + receipt
    ctx.gCascade  = await mkGrant(`WT-Cascade ${ts}`,  'approved');  // §6 budget-reject cascade
    ctx.gSettings = await mkGrant(`WT-Settings ${ts}`, 'approved');  // §9 approval-toggle effect

    const mkBudget = async (grantId, name, amount, status) => {
      const row = { grant_id: grantId, item_name: name, budget_allocated: amount };
      if (status) row.status = status; // omit → defaults to 'pending' (approvals on)
      const { data, error } = await supabase.from('budget_items').insert(row).select().single();
      if (error) throw error;
      ctx.ids.budgetIds.push(data.id);
      return data;
    };
    const mkExpense = async (grantId, budgetId, name, amount, status) => {
      const row = { grant_id: grantId, budget_item_id: budgetId, item_name: name, amount_spent: amount, expense_date: '2025-05-10' };
      if (status) row.status = status;
      const { data, error } = await supabase.from('expenses').insert(row).select().single();
      if (error) throw error;
      ctx.ids.expenseIds.push(data.id);
      return data;
    };

    // §5 — two pending budget items to approve/reject.
    ctx.biAlpha = await mkBudget(ctx.gBudgets.id, `BI Alpha ${ts}`, 5000);
    ctx.biBravo = await mkBudget(ctx.gBudgets.id, `BI Bravo ${ts}`, 3000);

    // §6 — an (approved) budget item with two pending expenses; one has a receipt.
    ctx.biCharlie = await mkBudget(ctx.gExpenses.id, `BI Charlie ${ts}`, 6000, 'approved');
    ctx.expOne = await mkExpense(ctx.gExpenses.id, ctx.biCharlie.id, `Exp One ${ts}`, 400, 'pending');
    ctx.expTwo = await mkExpense(ctx.gExpenses.id, ctx.biCharlie.id, `Exp Two ${ts}`, 250, 'pending');

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

    // §6 cascade — a pending budget item whose linked expense is already approved.
    ctx.biDelta = await mkBudget(ctx.gCascade.id, `BI Delta ${ts}`, 4000);
    ctx.expThree = await mkExpense(ctx.gCascade.id, ctx.biDelta.id, `Exp Three ${ts}`, 900, 'approved');
  });

  test.afterAll(async ({ supabase }) => {
    const { ids } = ctx;
    // Membership created by the waive test (if it survived a failure).
    await supabase.from('user_memberships').delete().eq('user_id', ctx.granteeUserId);
    // Children cascade from grant_record delete; expenses/budgets still listed
    // explicitly in case a grant insert failed mid-seed.
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

  // ───────────────────────────────────────────────────────────────────────────
  // §2 — Admin dashboard: stat cards, charts, review queue, support nudge banner
  // ───────────────────────────────────────────────────────────────────────────
  test('§2 dashboard shows stat cards, charts, review queue and support nudge', async ({ page }) => {
    await loginAdmin(page);

    await expect(page.locator('.admin-title')).toContainText('Admin Dashboard');

    // Stat cards — labels that are always present plus the conditional pending ones.
    const stats = page.locator('.admin-stat-grid');
    await expect(stats.getByText('Grantees', { exact: true })).toBeVisible();
    await expect(stats.getByText('Total Grants', { exact: true })).toBeVisible();
    await expect(stats.getByText('Approved', { exact: true })).toBeVisible();
    await expect(stats.getByText('Pending', { exact: true })).toBeVisible();
    await expect(stats.getByText('Total Funding', { exact: true })).toBeVisible();
    await expect(stats.getByText('Approved Spent', { exact: true })).toBeVisible();
    // Conditional cards — we seeded pending budget items + pending expenses.
    await expect(stats.getByText('Pending Budget Items', { exact: true })).toBeVisible();
    await expect(stats.getByText('Pending Expenses', { exact: true })).toBeVisible();

    // A pending card links to the filtered grants list.
    await expect(page.locator('a.asc-card-link[href="/admin/grants?status=pending"]')).toBeVisible();

    // Charts.
    await expect(page.locator('.chart-card-title', { hasText: 'Grants by Status' })).toBeVisible();
    await expect(page.locator('.chart-card-title', { hasText: 'Top Grantees by Funding' })).toBeVisible();

    // Pending review queue contains the seeded pending grant with a Review link.
    const section = page.locator('.admin-section', { hasText: 'Pending Review' });
    await expect(section).toBeVisible();
    const queueItem = section.locator('.admin-queue-item', { hasText: ctx.gReject.grant_name });
    await expect(queueItem).toBeVisible();
    await expect(queueItem.locator(`a.admin-review-btn[href="/admin/grants/${ctx.gReject.id}"]`)).toBeVisible();

    // Support-contact nudge banner (tenant seeded with no email/phone).
    const banner = page.getByText("Your tenant doesn't have support contact info set.", { exact: false });
    await expect(banner).toBeVisible();
    await expect(page.locator('a[href="/admin/settings"]', { hasText: 'Go to Settings' })).toBeVisible();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // §3 — All Grants: columns, search, pending toggles, sort
  // ───────────────────────────────────────────────────────────────────────────
  test('§3 all-grants list searches, toggles pending, and sorts', async ({ page }) => {
    await loginAdmin(page);
    const grantsPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.status() === 200);
    await page.goto('/admin/grants');
    await grantsPromise;

    await expect(page.locator('.admin-title')).toContainText('All Grants');

    // Columns.
    const headers = page.locator('.admin-table thead th');
    await expect(headers.filter({ hasText: 'Grant Name' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Grantee' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Organization' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Amount' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Status' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Submitted' })).toBeVisible();
    await expect(headers.filter({ hasText: 'Time Left' })).toBeVisible();

    // All seeded grants are visible (admin sees the whole tenant).
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.gReject.grant_name })).toBeVisible();
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.gExpenses.grant_name })).toBeVisible();

    // Search narrows to a single grant.
    const searchBox = page.locator('.admin-search-box input');
    await searchBox.fill(ctx.gExpenses.grant_name);
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.gExpenses.grant_name })).toBeVisible();
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.gReject.grant_name })).toHaveCount(0);
    await searchBox.fill('');

    // "Pending Budgets" toggle → only grants with pending budget items.
    await page.locator('button.admin-pending-filter-btn', { hasText: 'Pending Budgets' }).click();
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.gBudgets.grant_name })).toBeVisible();
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.gReject.grant_name })).toHaveCount(0);
    // Pending shorthand cell shows "<n>B" for budget items.
    const budgetsRow = page.locator('tr', { hasText: ctx.gBudgets.grant_name });
    await expect(budgetsRow.locator('.agl-pending-count', { hasText: /B$/ })).toBeVisible();
    // Toggle off.
    await page.locator('button.admin-pending-filter-btn', { hasText: 'Pending Budgets' }).click();

    // "Pending Expenses" toggle → only grants with pending expenses.
    await page.locator('button.admin-pending-filter-btn', { hasText: 'Pending Expenses' }).click();
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.gExpenses.grant_name })).toBeVisible();
    await expect(page.locator('td.grant-name-cell', { hasText: ctx.gBudgets.grant_name })).toHaveCount(0);
    await page.locator('button.admin-pending-filter-btn', { hasText: 'Pending Expenses' }).click();

    // Sort by Grant Name ascending → all our grants share the "WT-" prefix,
    // so "WT-Budgets" sorts first among the tenant's rows.
    const nameHeader = page.locator('.admin-table thead th.sortable', { hasText: 'Grant Name' });
    await nameHeader.click();
    await expect(nameHeader.locator('.sort-arrow')).toBeVisible();
    await expect(page.locator('td.grant-name-cell').first()).toContainText(ctx.gBudgets.grant_name);
    // Click again → descending: "WT-Settings" sorts last → first row.
    await nameHeader.click();
    await expect(page.locator('td.grant-name-cell').first()).toContainText(ctx.gSettings.grant_name);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // §4 — Grant review: REJECT path + status history + add comment
  // ───────────────────────────────────────────────────────────────────────────
  test('§4 admin rejects a grant, sees status history, and adds a comment', async ({ page, supabase }) => {
    await loginAdmin(page);

    const reviewPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.status() === 200);
    await page.goto(`/admin/grants/${ctx.gReject.id}`);
    await reviewPromise;
    await expect(page.locator('.arh-title h2')).toContainText(ctx.gReject.grant_name);

    // While still pending, the disbursed-funds *tip* is shown (card is not).
    await expect(page.locator('.admin-sidebar-tip')).toContainText('Disbursed Funds');

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

    // DB reflects the rejection + notes.
    const { data: updated } = await supabase
      .from('grant_record').select('status, approval_notes').eq('id', ctx.gReject.id).single();
    expect(updated.status).toBe('rejected');
    expect(updated.approval_notes).toContain('reconcile');

    // Status History timeline now records the pending → rejected transition.
    const timeline = page.locator('.status-timeline');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('.timeline-entry')).not.toHaveCount(0);
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

  // ───────────────────────────────────────────────────────────────────────────
  // §4 — Disbursed funds card (shown only once a grant is approved)
  // ───────────────────────────────────────────────────────────────────────────
  test('§4 admin sets disbursed funds on an approved grant', async ({ page, supabase }) => {
    await loginAdmin(page);
    const reviewPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.status() === 200);
    await page.goto(`/admin/grants/${ctx.gDisb.id}`);
    await reviewPromise;
    await expect(page.locator('.arh-title h2')).toContainText(ctx.gDisb.grant_name);

    const disbCard = page.locator('.admin-card', { hasText: 'Disbursed Funds' }).filter({ has: page.locator('input[type="number"]') });
    await expect(disbCard).toBeVisible();
    await disbCard.locator('input[type="number"]').fill('2500');

    const patchPromise = page.waitForResponse(r =>
      r.url().includes('grant_record') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await page.getByRole('button', { name: /Update Disbursed Funds/i }).click();
    await patchPromise;

    await expect(page.locator('text=Disbursed funds updated.')).toBeVisible({ timeout: 10000 });

    const { data: g } = await supabase
      .from('grant_record').select('disbursed_funds').eq('id', ctx.gDisb.id).single();
    expect(Number(g.disbursed_funds)).toBe(2500);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // §5 — Budget items: approve one, reject another
  // ───────────────────────────────────────────────────────────────────────────
  test('§5 admin approves and rejects budget items', async ({ page, supabase }) => {
    await loginAdmin(page);
    const reviewPromise = page.waitForResponse(r =>
      r.url().includes('budget_items') && r.status() === 200);
    await page.goto(`/admin/grants/${ctx.gBudgets.id}`);
    await reviewPromise;

    const alpha = page.locator('.admin-bi-block', { hasText: ctx.biAlpha.item_name });
    const bravo = page.locator('.admin-bi-block', { hasText: ctx.biBravo.item_name });
    await expect(alpha.locator('.status-badge.status-pending')).toBeVisible();
    await expect(bravo.locator('.status-badge.status-pending')).toBeVisible();

    // Approve Alpha.
    const approvePromise = page.waitForResponse(r =>
      r.url().includes('budget_items') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await alpha.locator('button.admin-approve-btn', { hasText: 'Approve' }).click();
    await approvePromise;
    await expect(alpha.locator('.status-badge.status-approved')).toBeVisible();

    // Reject Bravo.
    const rejectPromise = page.waitForResponse(r =>
      r.url().includes('budget_items') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await bravo.locator('button.admin-reject-btn', { hasText: 'Reject' }).click();
    await rejectPromise;
    await expect(bravo.locator('.status-badge.status-rejected')).toBeVisible();

    const { data: items } = await supabase
      .from('budget_items').select('id, status').in('id', [ctx.biAlpha.id, ctx.biBravo.id]);
    const byId = Object.fromEntries(items.map(i => [i.id, i.status]));
    expect(byId[ctx.biAlpha.id]).toBe('approved');
    expect(byId[ctx.biBravo.id]).toBe('rejected');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // §6 — Expenses: view receipt (signed URL), approve one, reject another
  // ───────────────────────────────────────────────────────────────────────────
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

    // View receipt → opens a new tab via a signed URL.
    const popupPromise = page.context().waitForEvent('page');
    await rowOne.locator('button.admin-receipt-btn', { hasText: 'View' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    expect(popup.url()).toContain('receipts');
    await popup.close();

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

  // ───────────────────────────────────────────────────────────────────────────
  // §6 — Cascade: rejecting a budget item resets its linked expenses to pending
  // ───────────────────────────────────────────────────────────────────────────
  test('§6 rejecting a budget item resets linked expenses to pending', async ({ page, supabase }) => {
    await loginAdmin(page);
    const reviewPromise = page.waitForResponse(r =>
      r.url().includes('budget_items') && r.status() === 200);
    await page.goto(`/admin/grants/${ctx.gCascade.id}`);
    await reviewPromise;

    const delta = page.locator('.admin-bi-block', { hasText: ctx.biDelta.item_name });
    await expect(delta.locator('.status-badge.status-pending')).toBeVisible();
    // Linked expense starts approved.
    const expRow = delta.locator('.admin-expense-table tbody tr', { hasText: ctx.expThree.item_name });
    await expect(expRow.locator('.status-badge.status-approved')).toBeVisible();

    // Reject the budget item — the component rejects the item then resets its
    // expenses to pending, then reloads.
    const rejectPromise = page.waitForResponse(r =>
      r.url().includes('budget_items') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await delta.locator('button.admin-reject-btn', { hasText: 'Reject' }).click();
    await rejectPromise;

    await expect(delta.locator('.status-badge.status-rejected')).toBeVisible();
    // Linked expense has cascaded back to pending (now shows action buttons again).
    await expect(expRow.locator('.status-badge.status-pending')).toBeVisible();

    const { data: bi } = await supabase
      .from('budget_items').select('status').eq('id', ctx.biDelta.id).single();
    expect(bi.status).toBe('rejected');
    const { data: exp } = await supabase
      .from('expenses').select('status').eq('id', ctx.expThree.id).single();
    expect(exp.status).toBe('pending');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // §7 — Users: disable then re-enable a grantee
  // ───────────────────────────────────────────────────────────────────────────
  test('§7 admin disables and re-enables a user', async ({ page, supabase }) => {
    await loginAdmin(page);
    const usersPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/users') && r.status() === 200);
    await page.goto('/admin/users');
    await usersPromise;

    await expect(page.locator('.admin-title')).toContainText('User Management');
    const row = page.locator('tr', { hasText: ctx.granteeName });
    await expect(row.locator('.user-status-pill', { hasText: 'Active' })).toBeVisible();

    // Disable → confirm Yes.
    await row.getByRole('button', { name: /^Disable$/ }).click();
    await expect(row.locator('.user-confirm-label', { hasText: /Disable user/ })).toBeVisible();
    let patchPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/users') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Yes' }).click();
    await patchPromise;
    await expect(row.locator('.user-status-pill', { hasText: 'Disabled' })).toBeVisible();

    let { data: u } = await supabase.from('users').select('is_active').eq('id', ctx.granteeUserId).single();
    expect(u.is_active).toBe(false);

    // Re-enable → confirm Yes.
    await row.getByRole('button', { name: /^Enable$/ }).click();
    await expect(row.locator('.user-confirm-label', { hasText: /Enable user/ })).toBeVisible();
    patchPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/users') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Yes' }).click();
    await patchPromise;
    await expect(row.locator('.user-status-pill', { hasText: 'Active' })).toBeVisible();

    ({ data: u } = await supabase.from('users').select('is_active').eq('id', ctx.granteeUserId).single());
    expect(u.is_active).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // §9 — Approval settings: toggling off auto-approves NEW records; on → pending
  // ───────────────────────────────────────────────────────────────────────────
  test('§9 approval-setting toggles change the status of newly created records', async ({ page, supabase }) => {
    await loginAdmin(page);
    await page.goto('/admin/settings');
    await expect(page.locator('.admin-title')).toContainText('Settings');

    // Toggles: [0]=Grant, [1]=Budget Item, [2]=Expense. Turn Budget + Expense OFF.
    const budgetToggle = page.locator('.toggle-switch').nth(1);
    const expenseToggle = page.locator('.toggle-switch').nth(2);
    await expect(budgetToggle.locator('input[type="checkbox"]')).toBeChecked();
    await expect(expenseToggle.locator('input[type="checkbox"]')).toBeChecked();
    await budgetToggle.click();
    await expenseToggle.click();
    await expect(budgetToggle.locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(expenseToggle.locator('input[type="checkbox"]')).not.toBeChecked();

    let savePromise = page.waitForResponse(r =>
      r.url().includes('tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await page.getByRole('button', { name: /Save Settings/i }).click();
    await savePromise;
    await expect(page.locator('text=Settings saved.')).toBeVisible();

    // New records created WITH APPROVAL OFF are auto-approved by the DB triggers
    // (set_tenant_from_grant → auto_approve_budget_item/expense). We don't pass a
    // status so the trigger decides.
    const ts = Date.now();
    const { data: biOff } = await supabase.from('budget_items').insert({
      grant_id: ctx.gSettings.id, item_name: `Auto BI ${ts}`, budget_allocated: 1000,
    }).select().single();
    ctx.ids.budgetIds.push(biOff.id);
    expect(biOff.status).toBe('approved');

    const { data: expOff } = await supabase.from('expenses').insert({
      grant_id: ctx.gSettings.id, budget_item_id: biOff.id, item_name: `Auto Exp ${ts}`,
      amount_spent: 100, expense_date: '2025-06-01',
    }).select().single();
    ctx.ids.expenseIds.push(expOff.id);
    expect(expOff.status).toBe('approved');

    // Turn approvals back ON and save.
    await budgetToggle.click();
    await expenseToggle.click();
    await expect(budgetToggle.locator('input[type="checkbox"]')).toBeChecked();
    await expect(expenseToggle.locator('input[type="checkbox"]')).toBeChecked();
    savePromise = page.waitForResponse(r =>
      r.url().includes('tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await page.getByRole('button', { name: /Save Settings/i }).click();
    await savePromise;
    await expect(page.locator('text=Settings saved.')).toBeVisible();

    // New records created WITH APPROVAL ON default to pending.
    const { data: biOn } = await supabase.from('budget_items').insert({
      grant_id: ctx.gSettings.id, item_name: `Pending BI ${ts}`, budget_allocated: 1000,
    }).select().single();
    ctx.ids.budgetIds.push(biOn.id);
    expect(biOn.status).toBe('pending');

    // DB settings reflect the final ON state.
    const { data: settings } = await supabase
      .from('tenant_settings')
      .select('require_budget_approval, require_expense_approval')
      .eq('tenant_id', ctx.tenantId).single();
    expect(settings.require_budget_approval).toBe(true);
    expect(settings.require_expense_approval).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // §12 — Support contact configuration (clears the dashboard nudge banner)
  // ───────────────────────────────────────────────────────────────────────────
  test('§12 admin configures support contact and the nudge banner clears', async ({ page, supabase }) => {
    await loginAdmin(page);
    await page.goto('/admin/settings');
    await expect(page.locator('.admin-title')).toContainText('Settings');

    const supportEmail = `support+${Date.now()}@admin-wt.test`;
    const supportPhone = '(555) 246-8100';
    await page.locator('input[type="email"]').fill(supportEmail);
    await page.locator('input[type="tel"]').fill(supportPhone);

    const savePromise = page.waitForResponse(r =>
      r.url().includes('tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await page.getByRole('button', { name: /Save Settings/i }).click();
    await savePromise;
    await expect(page.locator('text=Settings saved.')).toBeVisible();

    const { data: settings } = await supabase
      .from('tenant_settings').select('support_email, support_phone').eq('tenant_id', ctx.tenantId).single();
    expect(settings.support_email).toBe(supportEmail);
    expect(settings.support_phone).toBe(supportPhone);

    // The dashboard nudge banner no longer appears (support contact now set).
    await page.goto('/admin');
    await expect(page.locator('.admin-title')).toContainText('Admin Dashboard');
    await expect(
      page.getByText("Your tenant doesn't have support contact info set.", { exact: false })
    ).toHaveCount(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // §13 — Subscriptions: waive then remove-waiver on a grantee
  // ───────────────────────────────────────────────────────────────────────────
  test('§13 admin waives and removes a grantee subscription waiver', async ({ page, supabase }) => {
    await loginAdmin(page);
    const usersPromise = page.waitForResponse(r =>
      r.url().includes('/rest/v1/users') && r.status() === 200);
    await page.goto('/admin/users');
    await usersPromise;

    const row = page.locator('tr', { hasText: ctx.granteeName });
    // No membership yet → "None" badge.
    await expect(row.locator('.user-status-pill', { hasText: 'None' })).toBeVisible();

    // Waive → membership upserted with source 'manual' → "Waived" badge.
    const waivePromise = page.waitForResponse(r =>
      r.url().includes('user_memberships') &&
      (r.request().method() === 'POST' || r.request().method() === 'PATCH') &&
      (r.status() === 200 || r.status() === 201));
    await row.getByRole('button', { name: /^Waive$/ }).click();
    await waivePromise;
    await expect(row.locator('.user-status-pill', { hasText: 'Waived' })).toBeVisible();

    let { data: m } = await supabase
      .from('user_memberships').select('source, is_active').eq('user_id', ctx.granteeUserId).single();
    expect(m.source).toBe('manual');
    expect(m.is_active).toBe(true);

    // Remove waiver → membership deleted → back to "None".
    const removePromise = page.waitForResponse(r =>
      r.url().includes('user_memberships') && r.request().method() === 'DELETE' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: /Remove Waiver/i }).click();
    await removePromise;
    await expect(row.locator('.user-status-pill', { hasText: 'None' })).toBeVisible();

    const { data: after } = await supabase
      .from('user_memberships').select('id').eq('user_id', ctx.granteeUserId);
    expect(after.length).toBe(0);
  });
});
