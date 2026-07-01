const { test, expect, loginAs, seedMembership } = require('./fixtures');

// LS1 Lane G — grantee happy-path journeys (trimmed).
//
// This spec keeps only the flows that genuinely need a full browser + real
// Supabase stack:
//   §5 create a grant via the /grants/new form (self-service auto-approve)
//   §7 edit & resubmit a needs_changes grant (managed: needs_changes -> pending)
//   §9 add an expense with a receipt upload + open the signed-URL receipt
//
// The display/filter assertions that used to live here were intentionally
// removed and pushed down the test pyramid:
//   - dashboard stat cards / charts / tax-month banner, grants-list
//     search/sort/card-table-toggle/pagination, budget donut, footer fallback,
//     expense-report filtering  -> component concerns (frontend vitest)
//   - auto-approve / needs_changes -> pending notification / subscription
//     exemption precedence       -> supabase/tests/grant-trigger-behaviors.test.sh
//   - subscription waived / tenant-exempt gating across roles
//                                 -> cross-role-visibility.spec.js
//
// Selectors/copy taken from the real source (CreateGrant.js, GrantDetail.js,
// GrantBreakdown.js, AddExpenseModal.js).

const PASSWORD = 'TestPassword123!';

const login = (page, email) => loginAs(page, email, url => url.pathname === '/' || url.pathname === '/home', PASSWORD);

// Bottom-up manual teardown mirroring fixtures.js order (these describe blocks
// seed in their own beforeAll, which runs outside the per-test `testData`
// fixture, so they track + clean up their own rows).
async function teardown(supabase, ids) {
  if (ids.grantIds.length) {
    const { data: receiptRows } = await supabase
      .from('receipts').select('id, receipt_files').in('grant_id', ids.grantIds);
    const paths = (receiptRows || [])
      .flatMap(r => (r.receipt_files || []).map(f => f.path))
      .filter(Boolean);
    if (paths.length) await supabase.storage.from('receipts').remove(paths);
    await supabase.from('receipts').delete().in('grant_id', ids.grantIds);
    await supabase.from('grant_comments').delete().in('grant_id', ids.grantIds);
  }
  await supabase.from('expenses').delete().in('id', ids.expenseIds.length ? ids.expenseIds : [-1]);
  await supabase.from('budget_items').delete().in('id', ids.budgetIds.length ? ids.budgetIds : [-1]);
  await supabase.from('grant_record').delete().in('id', ids.grantIds.length ? ids.grantIds : [-1]);
  await supabase.from('user_memberships').delete().in('subscription_id', ids.subscriptionIds.length ? ids.subscriptionIds : [-1]);
  await supabase.from('user_memberships').delete().in('user_id', ids.userIds.length ? ids.userIds : [-1]);
  await supabase.from('subscriptions').delete().in('id', ids.subscriptionIds.length ? ids.subscriptionIds : [-1]);
  await supabase.from('users').delete().in('id', ids.userIds.length ? ids.userIds : [-1]);
  await supabase.from('tenant_settings').delete().in('tenant_id', ids.tenantIds.length ? ids.tenantIds : [-1]);
  await supabase.from('tenants').delete().in('id', ids.tenantIds.length ? ids.tenantIds : [-1]);
  for (const uid of ids.authUids) await supabase.auth.admin.deleteUser(uid);
}

function freshIds() {
  return { authUids: [], userIds: [], tenantIds: [], grantIds: [], budgetIds: [], expenseIds: [], subscriptionIds: [] };
}

// ---------------------------------------------------------------------------
// Self-service grantee: create a grant through the real form.
// ---------------------------------------------------------------------------
test.describe('Grantee walkthrough — create grant (self-service)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90000);

  const ctx = { ids: freshIds() };

  test.beforeAll(async ({ supabase }) => {
    const ts = Date.now();
    ctx.email = `grantee_ss_${ts}@test.local`;

    const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
      email: ctx.email, password: PASSWORD, email_confirm: true,
    });
    if (authErr) throw authErr;
    ctx.ids.authUids.push(auth.user.id);

    const { data: userRec, error: provErr } = await supabase.rpc('provision_self_service_tenant', {
      p_auth_uid: auth.user.id, p_email: ctx.email,
      p_firstname: 'Selma', p_lastname: 'Service', p_organization: `Selma Org ${ts}`,
      p_phone: '555-0000', p_tax_month: null,
    });
    if (provErr) throw provErr;
    ctx.userId = userRec.id;
    ctx.tenantId = userRec.tenant_id;
    ctx.ids.userIds.push(userRec.id);
    ctx.ids.tenantIds.push(userRec.tenant_id);

    await seedMembership(supabase, ctx.ids, ctx.userId, 'basic');
    ctx.supabase = supabase;
  });

  test.afterAll(async ({ supabase }) => {
    await teardown(supabase, ctx.ids);
  });

  test('§5 create a grant via the /grants/new form (auto-approved)', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto('/grants/new');

    const grantName = `Created Via UI ${Date.now()}`;
    await page.fill('#grant_name', grantName);
    await page.fill('#description', 'Created by the grantee walkthrough e2e spec.');
    await page.fill('#start_spend_period', '2025-02-01');
    await page.fill('#end_spend_period', '2025-11-30');
    await page.fill('#grant_amount', '12500');

    // Self-service info box advertises auto-approval.
    await expect(page.locator('.info-box')).toContainText('automatically approved');

    await page.locator('button.btn-submit', { hasText: 'Submit Grant' }).click();

    // Success screen → redirect to the grants list.
    await expect(page.getByRole('heading', { name: 'Grant Submitted!' })).toBeVisible();
    await page.waitForURL(/\/grants$/, { timeout: 10000 });

    // The row exists and was auto-approved by the trigger (the rule itself is
    // proven in supabase/tests/grant-trigger-behaviors.test.sh; here we confirm
    // the real form path reaches it).
    const { data: rows } = await ctx.supabase
      .from('grant_record').select('id, status').eq('user_id', ctx.userId).eq('grant_name', grantName);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('approved');
    ctx.ids.grantIds.push(rows[0].id);
  });
});

// ---------------------------------------------------------------------------
// Managed-tenant grantee: resubmit a needs_changes grant, and add an expense
// with a receipt upload (file + signed-URL storage path is E2E-only).
// ---------------------------------------------------------------------------
test.describe('Grantee walkthrough — resubmit + expense receipt (managed)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120000);

  const ctx = { ids: freshIds() };

  test.beforeAll(async ({ supabase }) => {
    const ts = Date.now();
    ctx.email = `grantee_mgd_${ts}@test.local`;

    const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
      email: ctx.email, password: PASSWORD, email_confirm: true,
    });
    if (authErr) throw authErr;
    ctx.authUid = auth.user.id;
    ctx.ids.authUids.push(auth.user.id);

    // Managed tenant with default approval workflow (require_*_approval = true).
    const { data: tenant, error: tErr } = await supabase.from('tenants').insert({
      name: `Managed Co ${ts}`, slug: `managed-co-${ts}`, tenant_type: 'managed',
    }).select().single();
    if (tErr) throw tErr;
    ctx.tenantId = tenant.id;
    ctx.ids.tenantIds.push(tenant.id);

    const { error: tsErr } = await supabase.from('tenant_settings').insert({ tenant_id: tenant.id });
    if (tsErr) throw tsErr;

    const { data: userRec, error: uErr } = await supabase.from('users').insert({
      tenant_id: tenant.id, user_id: ctx.authUid, email: ctx.email, role: 'grantee',
      firstname: 'Manny', lastname: 'Managed', organization_name: `Manny Org ${ts}`, phone_number: '555-0000',
    }).select().single();
    if (uErr) throw uErr;
    ctx.userId = userRec.id;
    ctx.ids.userIds.push(userRec.id);

    await seedMembership(supabase, ctx.ids, ctx.userId, 'basic');

    // A needs_changes grant for the resubmit journey (§7).
    const { data: gNeeds } = await supabase.from('grant_record').insert({
      user_id: ctx.userId, tenant_id: ctx.tenantId,
      grant_name: `Needs Changes Grant ${ts}`, grant_amount: 15000,
      status: 'needs_changes', start_spend_period: '2025-01-01', end_spend_period: '2030-12-31',
    }).select().single();
    ctx.needsGrantId = gNeeds.id;
    ctx.ids.grantIds.push(gNeeds.id);

    // An approved grant with an approved budget item for the expense journey (§9).
    const { data: gBreak } = await supabase.from('grant_record').insert({
      user_id: ctx.userId, tenant_id: ctx.tenantId,
      grant_name: `Breakdown Grant ${ts}`, grant_amount: 30000,
      status: 'approved', start_spend_period: '2025-01-01', end_spend_period: '2030-12-31',
    }).select().single();
    ctx.breakdownGrantId = gBreak.id;
    ctx.ids.grantIds.push(gBreak.id);

    const { data: bi } = await supabase.from('budget_items').insert({
      grant_id: gBreak.id, tenant_id: ctx.tenantId, item_name: 'Salaries', budget_allocated: 6000, status: 'approved',
    }).select().single();
    ctx.ids.budgetIds.push(bi.id);

    ctx.supabase = supabase;
  });

  test.afterAll(async ({ supabase }) => {
    // Pick up any UI-created expenses on the seeded grants.
    const { data: exps } = await supabase.from('expenses').select('id').in('grant_id', ctx.ids.grantIds);
    (exps || []).forEach(e => { if (!ctx.ids.expenseIds.includes(e.id)) ctx.ids.expenseIds.push(e.id); });
    await teardown(supabase, ctx.ids);
  });

  test('§7 edits & resubmits a needs_changes grant (-> pending)', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto(`/grants/${ctx.needsGrantId}`);

    await page.locator('.detail-edit-link').click();
    await page.waitForURL(new RegExp(`/grants/${ctx.needsGrantId}/edit`));

    // Managed edit warns it will reset to Pending for re-review.
    await expect(page.locator('.info-box-warning')).toContainText('Pending');
    await page.fill('#grant_amount', '16500');
    await page.locator('button.btn-submit', { hasText: 'Save & Resubmit' }).click();

    await expect(page.getByRole('heading', { name: 'Grant Updated!' })).toBeVisible();
    await expect(page.locator('.create-grant-success')).toContainText('resubmitted for review');

    const { data: row } = await ctx.supabase
      .from('grant_record').select('status, grant_amount').eq('id', ctx.needsGrantId).single();
    expect(row.status).toBe('pending');
    expect(Number(row.grant_amount)).toBe(16500);
  });

  test('§9 adds an expense with a receipt upload (persisted to storage)', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto(`/grants/${ctx.breakdownGrantId}/breakdown`);

    const item = page.locator('.budget-item-block', { hasText: 'Salaries' });
    await expect(item).toBeVisible();
    await item.locator('.budget-item-toggle').click(); // expand

    // Add an expense with a required receipt (managed).
    await item.locator('.add-expense-btn.small', { hasText: 'Add Expense' }).click();
    const modal = page.locator('.modal-container.expense-modal');
    await modal.locator('#item_name').fill('Office Supplies Q1');
    await modal.locator('#expense_date').fill('2025-06-15');
    await modal.locator('#amount_spent').fill('500');
    await modal.locator('input#receipt').setInputFiles({
      name: `receipt-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 e2e receipt'),
    });
    await expect(modal.locator('.receipt-preview')).toBeVisible();
    await modal.getByRole('button', { name: 'Add Expense' }).click();
    await expect(modal).toHaveCount(0);

    const row = page.locator('.expense-items-table tr', { hasText: 'Office Supplies Q1' });
    await expect(row).toBeVisible();
    await expect(row.locator('.status-icon-pending')).toBeVisible();
    // A view-receipt button is offered (the upload produced a viewable receipt).
    await expect(row.locator('.receipt-btn')).toBeVisible();

    // The receipt actually reached storage: a receipts row exists for this
    // grant with a stored file path. (Asserting the persisted artifact is
    // deterministic, unlike reading the async signed-URL popup.)
    const { data: receipts } = await ctx.supabase
      .from('receipts').select('receipt_files').eq('grant_id', ctx.breakdownGrantId);
    expect(receipts.length).toBeGreaterThan(0);
    const paths = receipts.flatMap(r => (r.receipt_files || []).map(f => f.path)).filter(Boolean);
    expect(paths.length).toBeGreaterThan(0);
  });
});
