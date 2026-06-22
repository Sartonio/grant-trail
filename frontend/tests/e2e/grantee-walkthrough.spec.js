const { test, expect } = require('./fixtures');

// LS1 Lane G — drives a grantee through docs/tutorials/Grantee-Walkthrough.md
// step by step, covering the GAPS from the coverage map in
// docs/roadmap/AGENT_PROMPTS_LS1.md that are NOT already exercised by
// grantee-flows / onboarding / workspace / reporting / subscription /
// notifications-audit:
//
//   §3  dashboard stat cards + charts + tax-month reminder
//   §4  grants list search / status-tabs / sort / card↔table toggle / pagination
//   §5  create a grant via the /grants/new form
//   §6  grant-detail budget donut + admin-comments render
//   §7  edit & resubmit a needs_changes grant (managed) + self-service edit
//   §8  budget items add / edit / delete via the UI
//   §9  expense add / edit / delete + receipt upload + view-receipt signed URL
//   §11 expense-report filtering (search / grant / status / date presets / clear)
//   §13 footer support-contact fallback
//   §14 subscription status-chip states — waived / tenant-exempt
//
// Selectors and copy below were taken from the real source (Main.js, Grants.js,
// CreateGrant.js, GrantDetail.js, GrantBreakdown.js, BudgetItemModal.js,
// AddExpenseModal.js, ConfirmDialog.js, ExpenseReports.js, Footer.js,
// SubscriptionPage.js) — not the walkthrough prose, which is stale in a couple
// of places (e.g. the dashboard card is "Spent" not "Approved Spent", the donut
// center reads only the spent %, deletes use a confirm dialog not a two-click
// toggle, and the waived chip reads "Basic (waived by your administrator)").

const PASSWORD = 'TestPassword123!';
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Resolve a tax_month that is guaranteed to be within 30 days of "now" using the
// exact arithmetic Main.js uses, so the reminder banner is deterministic.
function taxMonthWithin30Days() {
  const now = new Date();
  const year = now.getFullYear();
  for (let m = 1; m <= 12; m++) {
    let taxDate = new Date(year, m - 1, 1);
    if (taxDate < now) taxDate = new Date(year + 1, m - 1, 1);
    const daysUntil = Math.ceil((taxDate - now) / (1000 * 60 * 60 * 24));
    if (daysUntil >= 0 && daysUntil <= 30) return m;
  }
  return ((now.getMonth() + 1) % 12) + 1; // fallback: next month
}

async function login(page, email) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => url.pathname === '/' || url.pathname === '/home', { timeout: 15000 });
}

// Service-role helper: the configured Stripe product id for a tier (the DB
// enforces subscription.stripe_product_id matches platform_settings for the tier).
async function productIdForTier(supabase, tier) {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('basic_membership_product_id, premium_membership_product_id')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return tier === 'premium' ? data.premium_membership_product_id : data.basic_membership_product_id;
}

// Give a seeded user an active Stripe-style subscription + membership so they
// pass the billing gate (same shape as grantee-flows.spec.js / fixtures.js).
async function grantActiveSubscription(supabase, ids, userId, tier = 'basic') {
  const ts = Date.now();
  const productId = await productIdForTier(supabase, tier);
  const { data: sub, error } = await supabase.from('subscriptions').insert({
    user_id: userId,
    stripe_customer_id: `cus_${ts}_${userId}`,
    stripe_subscription_id: `sub_${ts}_${userId}`,
    stripe_product_id: productId,
    stripe_price_id: `price_${ts}_${userId}`,
    membership_tier: tier,
    status: 'active',
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }).select().single();
  if (error) throw error;
  ids.subscriptionIds.push(sub.id);
  await supabase.from('user_memberships').insert({
    user_id: userId, subscription_id: sub.id, membership_tier: tier,
    is_active: true, source: 'stripe', starts_at: new Date().toISOString(),
  });
  return sub;
}

// Bottom-up manual teardown mirroring fixtures.js order (these describe blocks
// seed in their own beforeAll, which runs outside the per-test `testData`
// fixture, so they track + clean up their own rows).
async function teardown(supabase, ids) {
  // Receipts + their storage objects first (FK + storage are not cascaded here).
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
// Self-service grantee: dashboard, grants list, create-grant, self-service
// edit, and footer fallback.
// ---------------------------------------------------------------------------
test.describe('Grantee walkthrough — dashboard, grants list, create (self-service)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90000);

  const ctx = { ids: freshIds() };

  test.beforeAll(async ({ supabase }) => {
    const ts = Date.now();
    ctx.email = `grantee_ss_${ts}@test.local`;
    ctx.taxMonth = taxMonthWithin30Days();

    const { data: auth, error: authErr } = await supabase.auth.admin.createUser({
      email: ctx.email, password: PASSWORD, email_confirm: true,
    });
    if (authErr) throw authErr;
    ctx.ids.authUids.push(auth.user.id);

    const { data: userRec, error: provErr } = await supabase.rpc('provision_self_service_tenant', {
      p_auth_uid: auth.user.id, p_email: ctx.email,
      p_firstname: 'Selma', p_lastname: 'Service', p_organization: `Selma Org ${ts}`,
      p_phone: '555-0000', p_tax_month: ctx.taxMonth,
    });
    if (provErr) throw provErr;
    ctx.userId = userRec.id;
    ctx.tenantId = userRec.tenant_id;
    ctx.ids.userIds.push(userRec.id);
    ctx.ids.tenantIds.push(userRec.tenant_id);

    // Make the tax-month reminder fire deterministically.
    await supabase.from('users').update({ tax_month: ctx.taxMonth }).eq('id', ctx.userId);

    await grantActiveSubscription(supabase, ctx.ids, ctx.userId, 'basic');

    // 7 grants → card view (6/page) has 2 pages, so pagination is exercisable.
    // Distinct amounts let us assert the amount sort; the "Zebra" grant is the
    // largest so it sorts first and is the unique search target.
    ctx.searchToken = `Zebra${ts}`;
    const grantSpecs = [
      { name: `List Grant Alpha ${ts}`,   amount: 1000 },
      { name: `List Grant Bravo ${ts}`,   amount: 2000 },
      { name: `List Grant Charlie ${ts}`, amount: 3000 },
      { name: `List Grant Delta ${ts}`,   amount: 4000 },
      { name: `List Grant Echo ${ts}`,    amount: 5000 },
      { name: `List Grant Foxtrot ${ts}`, amount: 6000 },
      { name: `${ctx.searchToken} Grant`, amount: 99000 },
    ];
    for (const g of grantSpecs) {
      const { data, error } = await supabase.from('grant_record').insert({
        user_id: ctx.userId, tenant_id: ctx.tenantId,
        grant_name: g.name, grant_amount: g.amount, status: 'approved',
        start_spend_period: '2025-01-01', end_spend_period: '2030-12-31',
      }).select().single();
      if (error) throw error;
      ctx.ids.grantIds.push(data.id);
    }
    ctx.zebraName = `${ctx.searchToken} Grant`;

    // A dedicated grant for the self-service edit test (so renaming it doesn't
    // disturb the list/search assertions above).
    const { data: editGrant, error: egErr } = await supabase.from('grant_record').insert({
      user_id: ctx.userId, tenant_id: ctx.tenantId,
      grant_name: `EditMe SelfService ${ts}`, grant_amount: 7000, status: 'approved',
      start_spend_period: '2025-01-01', end_spend_period: '2030-12-31',
    }).select().single();
    if (egErr) throw egErr;
    ctx.editGrantId = editGrant.id;
    ctx.ids.grantIds.push(editGrant.id);

    ctx.supabase = supabase;
  });

  test.afterAll(async ({ supabase }) => {
    await teardown(supabase, ctx.ids);
  });

  test('§3 dashboard renders stat cards, charts and the tax-month reminder', async ({ page }) => {
    await login(page, ctx.email);

    await expect(page.getByRole('heading', { name: /Welcome Back, Selma/ })).toBeVisible();

    // Tax-month reminder banner (tax_month was set within 30 days).
    const taxBanner = page.locator('.tax-month-alert');
    await expect(taxBanner).toBeVisible();
    await expect(taxBanner).toContainText(MONTH_NAMES[ctx.taxMonth - 1]);

    // Core stat cards present.
    for (const label of ['Total Grants', 'Approved', 'Total Funding', 'Spent']) {
      await expect(page.locator('.stat-card h3', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
    // Self-service tenants hide the approval-workflow cards.
    await expect(page.locator('.stat-card h3', { hasText: /^Pending$/ })).toHaveCount(0);
    await expect(page.locator('.stat-card h3', { hasText: /^Needs Changes$/ })).toHaveCount(0);
    await expect(page.locator('.stat-card h3', { hasText: /^Rejected$/ })).toHaveCount(0);

    // Charts render once there is at least one grant.
    await expect(page.locator('.chart-card-title', { hasText: 'Grants by Status' })).toBeVisible();
    await expect(page.locator('.chart-card-title', { hasText: 'Funding vs Spent' })).toBeVisible();

    // Dismiss the tax banner (session-scoped).
    await taxBanner.locator('.tax-alert-close').click();
    await expect(taxBanner).toHaveCount(0);

    // Clicking the "Approved" stat card deep-links to the filtered grants list.
    await page.locator('a.stat-card-link[href="/grants?status=approved"]').click();
    await page.waitForURL(/\/grants\?status=approved/);
    await expect(page.locator('.tabs button.active-tab')).toHaveText('Approved');
  });

  test('§4 grants list: search, status tabs, sort, card↔table toggle, pagination', async ({ page }) => {
    await login(page, ctx.email);

    // --- default (table) view + summary strip ---
    await page.goto('/grants');
    await expect(page.locator('.grants-table')).toBeVisible();
    await expect(page.locator('.grants-stat-strip')).toContainText('grants');
    await expect(page.locator('.gt-name-link', { hasText: ctx.zebraName })).toBeVisible();

    // --- card/table toggle + pagination (card view = 6/page → 2 pages) ---
    await page.goto('/grants');
    await page.locator('button[title="Card view"]').click();
    await expect(page.locator('.grants-grant-card')).toHaveCount(6);
    await expect(page.locator('.pagination span')).toContainText('Page 1 of 2');
    await expect(page.locator('.pagination button', { hasText: 'Previous' })).toBeDisabled();
    await page.locator('.pagination button', { hasText: 'Next' }).click();
    await expect(page.locator('.pagination span')).toContainText('Page 2 of 2');
    await expect(page.locator('.pagination button', { hasText: 'Next' })).toBeDisabled();

    // --- search (card view) ---
    await page.goto('/grants');
    await page.locator('button[title="Card view"]').click();
    await page.locator('.search-box input').fill(ctx.searchToken);
    await expect(page.locator('.grants-grant-card')).toHaveCount(1);
    await expect(page.locator('.grant-title-link', { hasText: ctx.zebraName })).toBeVisible();

    // --- sort by amount (card view): largest first ---
    await page.goto('/grants');
    await page.locator('button[title="Card view"]').click();
    await page.locator('.left-tools select').selectOption('grant_amount');
    await expect(page.locator('.grant-title-link').first()).toHaveText(ctx.zebraName);

    // --- status tabs: self-service shows only All + Approved ---
    await page.goto('/grants');
    await expect(page.locator('.tabs button')).toHaveCount(2);
    await expect(page.locator('.tabs button').nth(0)).toHaveText('All');
    await expect(page.locator('.tabs button').nth(1)).toHaveText('Approved');
    await page.locator('.tabs button', { hasText: 'Approved' }).click();
    await expect(page.locator('.tabs button.active-tab')).toHaveText('Approved');
    await expect(page.locator('.grants-table tbody tr').first()).toBeVisible();
  });

  test('§5 create a grant via the /grants/new form', async ({ page }) => {
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

    await page.locator('button.btn-submit', { hasText: 'Submit Application' }).click();

    // Success screen → redirect to the grants list.
    await expect(page.getByRole('heading', { name: 'Grant Application Submitted!' })).toBeVisible();
    await page.waitForURL(/\/grants$/, { timeout: 10000 });

    // Verify the row and register it for teardown.
    const { data: rows } = await ctx.supabase
      .from('grant_record').select('id, status').eq('user_id', ctx.userId).eq('grant_name', grantName);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('approved'); // self-service auto-approve trigger
    ctx.ids.grantIds.push(rows[0].id);
  });

  test('§7 self-service grantee can edit a grant in place (stays approved)', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto(`/grants/${ctx.editGrantId}`);

    // Self-service: Edit Application is always available.
    await page.locator('.detail-edit-link').click();
    await page.waitForURL(new RegExp(`/grants/${ctx.editGrantId}/edit`));

    const newName = `Edited SelfService ${Date.now()}`;
    await page.fill('#grant_name', newName);
    await expect(page.locator('.info-box')).toContainText('status will not change');
    await page.locator('button.btn-submit', { hasText: 'Save Changes' }).click();

    await expect(page.getByRole('heading', { name: 'Application Updated!' })).toBeVisible();
    await expect(page.locator('.create-grant-success')).toContainText('Your changes have been saved.');

    const { data: row } = await ctx.supabase
      .from('grant_record').select('grant_name, status').eq('id', ctx.editGrantId).single();
    expect(row.grant_name).toBe(newName);
    expect(row.status).toBe('approved');
  });

  test('§13 footer falls back to the platform-default support contact', async ({ page }) => {
    await login(page, ctx.email);
    // Self-service tenant_settings has no support_email → platform default shown.
    const contact = page.locator('.footer-contact a.contact-item');
    await expect(contact).toHaveCount(1);
    await expect(contact).toHaveAttribute('href', /^mailto:.+@.+/);
    await expect(page.locator('.footer-contact')).toContainText('support@granttrail.org');
  });
});

// ---------------------------------------------------------------------------
// Managed-tenant grantee: grant detail (donut + admin comments), needs_changes
// resubmit, budget-item CRUD, expense CRUD + receipt, expense-report filtering.
// ---------------------------------------------------------------------------
test.describe('Grantee walkthrough — detail, budget, expenses (managed)', () => {
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

    await grantActiveSubscription(supabase, ctx.ids, ctx.userId, 'basic');

    // --- G_detail: approved grant with a budget item, seeded expenses of
    //     varying status/date, and an admin comment (for §6 + §11) ---
    const { data: gDetail } = await supabase.from('grant_record').insert({
      user_id: ctx.userId, tenant_id: ctx.tenantId,
      grant_name: `Detail Grant ${ts}`, grant_amount: 20000, disbursed_funds: 8000,
      status: 'approved', start_spend_period: '2025-01-01', end_spend_period: '2030-12-31',
    }).select().single();
    ctx.detailGrantId = gDetail.id;
    ctx.detailGrantName = gDetail.grant_name;
    ctx.ids.grantIds.push(gDetail.id);

    const { data: bi } = await supabase.from('budget_items').insert({
      grant_id: gDetail.id, tenant_id: ctx.tenantId, item_name: 'Operations', budget_allocated: 10000, status: 'approved',
    }).select().single();
    ctx.detailBudgetId = bi.id;
    ctx.ids.budgetIds.push(bi.id);

    const now = new Date();
    const thisMonthDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const oldDate = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-10`;

    const expenseSpecs = [
      { name: 'Approved Audit Fee', amount: 500, date: thisMonthDate, status: 'approved' },
      { name: 'Pending Travel',     amount: 300, date: oldDate,       status: 'pending'  },
      { name: 'Rejected Meal',      amount: 120, date: oldDate,       status: 'rejected' },
    ];
    for (const e of expenseSpecs) {
      const { data: exp } = await supabase.from('expenses').insert({
        grant_id: gDetail.id, budget_item_id: bi.id, tenant_id: ctx.tenantId,
        item_name: e.name, amount_spent: e.amount, expense_date: e.date, status: e.status,
      }).select().single();
      ctx.ids.expenseIds.push(exp.id);
    }
    ctx.approvedExpenseName = 'Approved Audit Fee';

    // Admin comment so GrantDetail renders the Admin Comments section.
    ctx.adminCommentText = `Please keep receipts for all travel ${ts}.`;
    await supabase.from('grant_comments').insert({
      grant_id: gDetail.id, tenant_id: ctx.tenantId, user_id: ctx.authUid, comment: ctx.adminCommentText,
    });

    // --- G_breakdown: empty approved grant for budget/expense CRUD (§8/§9) ---
    const { data: gBreak } = await supabase.from('grant_record').insert({
      user_id: ctx.userId, tenant_id: ctx.tenantId,
      grant_name: `Breakdown Grant ${ts}`, grant_amount: 30000,
      status: 'approved', start_spend_period: '2025-01-01', end_spend_period: '2030-12-31',
    }).select().single();
    ctx.breakdownGrantId = gBreak.id;
    ctx.ids.grantIds.push(gBreak.id);

    // --- G_needs: needs_changes grant for resubmit (§7) ---
    const { data: gNeeds } = await supabase.from('grant_record').insert({
      user_id: ctx.userId, tenant_id: ctx.tenantId,
      grant_name: `Needs Changes Grant ${ts}`, grant_amount: 15000,
      status: 'needs_changes', start_spend_period: '2025-01-01', end_spend_period: '2030-12-31',
    }).select().single();
    ctx.needsGrantId = gNeeds.id;
    ctx.ids.grantIds.push(gNeeds.id);

    ctx.supabase = supabase;
  });

  test.afterAll(async ({ supabase }) => {
    // Pick up any UI-created budget items / expenses on the seeded grants.
    const { data: bis } = await supabase.from('budget_items').select('id').in('grant_id', ctx.ids.grantIds);
    (bis || []).forEach(b => { if (!ctx.ids.budgetIds.includes(b.id)) ctx.ids.budgetIds.push(b.id); });
    const { data: exps } = await supabase.from('expenses').select('id').in('grant_id', ctx.ids.grantIds);
    (exps || []).forEach(e => { if (!ctx.ids.expenseIds.includes(e.id)) ctx.ids.expenseIds.push(e.id); });
    await teardown(supabase, ctx.ids);
  });

  test('§6 grant detail shows the budget donut and admin comments', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto(`/grants/${ctx.detailGrantId}`);

    await expect(page.locator('.detail-banner-title h2')).toContainText(ctx.detailGrantName);

    // Budget Used donut: spent 500 of 20000 → 3%.
    const donut = page.locator('.detail-section', { hasText: 'Budget Used' });
    await expect(donut).toBeVisible();
    await expect(donut).toContainText('3%');
    await expect(donut).toContainText('spent');

    // Admin Comments section (managed tenant, comment seeded).
    const comments = page.locator('.detail-section', { hasText: 'Admin Comments' });
    await expect(comments).toBeVisible();
    await expect(comments.locator('.comment-text')).toContainText(ctx.adminCommentText);
  });

  test('§7 managed grantee edits & resubmits a needs_changes grant', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto(`/grants/${ctx.needsGrantId}`);

    // Edit Application link is exposed for needs_changes grants.
    await page.locator('.detail-edit-link').click();
    await page.waitForURL(new RegExp(`/grants/${ctx.needsGrantId}/edit`));

    // Managed edit warns it will reset to Pending for re-review.
    await expect(page.locator('.info-box-warning')).toContainText('Pending');
    await page.fill('#grant_amount', '16500');
    await page.locator('button.btn-submit', { hasText: 'Save & Resubmit' }).click();

    await expect(page.getByRole('heading', { name: 'Application Updated!' })).toBeVisible();
    await expect(page.locator('.create-grant-success')).toContainText('resubmitted for review');

    const { data: row } = await ctx.supabase
      .from('grant_record').select('status, grant_amount').eq('id', ctx.needsGrantId).single();
    expect(row.status).toBe('pending');
    expect(Number(row.grant_amount)).toBe(16500);
  });

  test('§8 budget item add + edit on the breakdown page', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto(`/grants/${ctx.breakdownGrantId}/breakdown`);

    // Add a budget item.
    await page.getByRole('button', { name: 'Add Budget Item' }).click();
    const modal = page.locator('.modal-container.expense-modal');
    await modal.locator('#bi_item_name').fill('Salaries');
    await modal.locator('#bi_budget_allocated').fill('4000');
    await modal.getByRole('button', { name: 'Add Budget Item' }).click();
    await expect(modal).toHaveCount(0);

    const item = page.locator('.budget-item-block', { hasText: 'Salaries' });
    await expect(item).toBeVisible();
    await expect(item).toContainText('$4,000');
    // New items are pending in a managed tenant.
    await expect(item.locator('.status-icon-pending').first()).toBeVisible();

    // Edit it: managed edits warn about a pending reset; the new amount sticks.
    await item.locator('.budget-item-actions .edit-btn').click();
    const editModal = page.locator('.modal-container.expense-modal');
    await expect(editModal.locator('.info-note')).toContainText('pending');
    await editModal.locator('#bi_budget_allocated').fill('6000');
    await editModal.getByRole('button', { name: 'Update Budget Item' }).click();
    await expect(editModal).toHaveCount(0);
    await expect(page.locator('.budget-item-block', { hasText: 'Salaries' })).toContainText('$6,000');
  });

  test('§9 expense add + receipt upload + view-receipt + edit + delete', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto(`/grants/${ctx.breakdownGrantId}/breakdown`);

    const item = page.locator('.budget-item-block', { hasText: 'Salaries' });
    await expect(item).toBeVisible();
    await item.locator('.budget-item-toggle').click(); // expand

    // --- add expense with a required receipt (managed) ---
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

    // --- view receipt: opens a signed URL in a new tab ---
    const popupPromise = page.waitForEvent('popup');
    await row.locator('.receipt-btn').click();
    const popup = await popupPromise;
    expect(popup.url()).toContain('/storage/v1/object/sign/receipts');
    await popup.close();

    // --- edit the expense amount ---
    await row.locator('.actions .edit-btn').click();
    const editModal = page.locator('.modal-container.expense-modal');
    await editModal.locator('#amount_spent').fill('650');
    await editModal.getByRole('button', { name: 'Update Expense' }).click();
    await expect(editModal).toHaveCount(0);
    await expect(page.locator('.expense-items-table tr', { hasText: 'Office Supplies Q1' }))
      .toContainText('$650.00');

    // --- delete the expense (confirm dialog) ---
    await page.locator('.expense-items-table tr', { hasText: 'Office Supplies Q1' })
      .locator('.delete-btn.inline').click();
    const confirm = page.locator('.modal-container.confirm-dialog');
    await expect(confirm).toBeVisible();
    await confirm.locator('.btn-danger').click();
    await expect(page.locator('.expense-items-table tr', { hasText: 'Office Supplies Q1' })).toHaveCount(0);
  });

  test('§8 budget item delete (confirm dialog removes it)', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto(`/grants/${ctx.breakdownGrantId}/breakdown`);

    const item = page.locator('.budget-item-block', { hasText: 'Salaries' });
    await expect(item).toBeVisible();
    await item.locator('.budget-item-actions .delete-btn').click();
    const confirm = page.locator('.modal-container.confirm-dialog');
    await expect(confirm).toBeVisible();
    await confirm.locator('.btn-danger').click();
    await expect(page.locator('.budget-item-block', { hasText: 'Salaries' })).toHaveCount(0);
  });

  test('§11 expense reports: search, grant, status, date presets and clear', async ({ page }) => {
    await login(page, ctx.email);
    await page.goto('/expenses');

    await expect(page.locator('.expenses-table-main')).toBeVisible();

    // Scope to the detail grant so the breakdown-grant rows can't interfere.
    await page.locator('.ef-group select').first().selectOption(String(ctx.detailGrantId));
    await expect(page.locator('.expenses-table-main tbody tr')).toHaveCount(3);

    // Status filter → only the approved seeded expense remains.
    await page.locator('.ef-group select').nth(1).selectOption('approved');
    const rows = page.locator('.expenses-table-main tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.item-name')).toHaveText(ctx.approvedExpenseName);

    // Search filter.
    await page.locator('.ef-search-box input').fill('Audit');
    await expect(page.locator('.expenses-table-main tbody tr .item-name')).toHaveText(ctx.approvedExpenseName);

    // "This Month" preset populates the date range inputs.
    await page.locator('.ef-preset-btn', { hasText: 'This Month' }).click();
    const dateInputs = page.locator('.ef-group input[type="date"]');
    await expect(dateInputs.first()).not.toHaveValue('');

    // Clear resets every filter.
    await page.locator('.ef-clear-btn').click();
    await expect(page.locator('.ef-search-box input')).toHaveValue('');
    await expect(dateInputs.first()).toHaveValue('');
    await expect(page.locator('.ef-group select').first()).toHaveValue('all');
    await expect(page.locator('.ef-group select').nth(1)).toHaveValue('all');
  });
});

// ---------------------------------------------------------------------------
// §14 Subscription status-chip states: waived (manual membership) and
// tenant-exempt (require_subscription = false).
// ---------------------------------------------------------------------------
test.describe('Grantee walkthrough — subscription status chips', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90000);

  const ctx = { ids: freshIds() };

  test.beforeAll(async ({ supabase }) => {
    const ts = Date.now();

    // --- Waived grantee: managed tenant + manual (waived) membership, no sub ---
    ctx.waivedEmail = `grantee_waived_${ts}@test.local`;
    const { data: wAuth } = await supabase.auth.admin.createUser({
      email: ctx.waivedEmail, password: PASSWORD, email_confirm: true,
    });
    ctx.ids.authUids.push(wAuth.user.id);
    const { data: wTenant } = await supabase.from('tenants').insert({
      name: `Waived Co ${ts}`, slug: `waived-co-${ts}`, tenant_type: 'managed',
    }).select().single();
    ctx.ids.tenantIds.push(wTenant.id);
    await supabase.from('tenant_settings').insert({ tenant_id: wTenant.id }); // require_subscription = true
    const { data: wUser } = await supabase.from('users').insert({
      tenant_id: wTenant.id, user_id: wAuth.user.id, email: ctx.waivedEmail, role: 'grantee',
      firstname: 'Wanda', lastname: 'Waived', organization_name: `Waived Org ${ts}`, phone_number: '555-0000',
    }).select().single();
    ctx.ids.userIds.push(wUser.id);
    // Manual membership = admin-granted waiver (source 'manual', no subscription).
    await supabase.from('user_memberships').insert({
      user_id: wUser.id, membership_tier: 'basic', is_active: true, source: 'manual',
      starts_at: new Date().toISOString(),
    });

    // --- Exempt grantee: tenant with require_subscription = false, no sub ---
    ctx.exemptEmail = `grantee_exempt_${ts}@test.local`;
    const { data: eAuth } = await supabase.auth.admin.createUser({
      email: ctx.exemptEmail, password: PASSWORD, email_confirm: true,
    });
    ctx.ids.authUids.push(eAuth.user.id);
    const { data: eTenant } = await supabase.from('tenants').insert({
      name: `Exempt Co ${ts}`, slug: `exempt-co-${ts}`, tenant_type: 'managed',
    }).select().single();
    ctx.ids.tenantIds.push(eTenant.id);
    await supabase.from('tenant_settings').insert({ tenant_id: eTenant.id, require_subscription: false });
    const { data: eUser } = await supabase.from('users').insert({
      tenant_id: eTenant.id, user_id: eAuth.user.id, email: ctx.exemptEmail, role: 'grantee',
      firstname: 'Xavier', lastname: 'Exempt', organization_name: `Exempt Org ${ts}`, phone_number: '555-0000',
    }).select().single();
    ctx.ids.userIds.push(eUser.id);
  });

  test.afterAll(async ({ supabase }) => {
    await teardown(supabase, ctx.ids);
  });

  test('waived membership shows the "waived by your administrator" chip', async ({ page }) => {
    await login(page, ctx.waivedEmail);
    await page.goto('/subscription');

    await expect(page.locator('.subscription-status-chip'))
      .toContainText('Basic (waived by your administrator)');
    // No billing-portal button for a waived account.
    await expect(page.getByRole('button', { name: 'Manage Subscription' })).toHaveCount(0);
  });

  test('tenant-exempt account shows the "subscription not required" chip', async ({ page }) => {
    await login(page, ctx.exemptEmail);
    await page.goto('/subscription');

    await expect(page.locator('.subscription-status-chip'))
      .toContainText('Full Access (subscription not required for your account)');
    await expect(page.getByRole('button', { name: 'Manage Subscription' })).toHaveCount(0);
  });
});
