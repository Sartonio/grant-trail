const { test, expect } = require('./fixtures');
const {
  createCrossRoleRegistry,
  seedAuthUser,
  seedManagedTenant,
  seedUserRecord,
  seedMembership,
  seedGrant,
  seedBudgetItem,
  seedExpense,
  teardownCrossRole,
} = require('./fixtures');

// ============================================================================
// LS1 Lane X — Cross-role visibility.
//
// The core LS1 goal: prove a change made by ONE actor shows up correctly for the
// OTHER actors who should see it. Every test drives at least two browser
// contexts (one per actor) seeded into the SAME managed tenant, then asserts on
// the real UI / notifications the second actor sees — not on the database alone.
//
// Actors (all in one managed, fully-gated tenant unless noted):
//   • admin      — tenant admin (premium membership so it can mutate, not read-only)
//   • granteeA   — subscribed grantee; owns the grants used for review/budget/expense flows
//   • granteeB   — UNsubscribed grantee in the same tenant; used for the admin waiver flow
//   • superAdmin — platform super-admin (own home tenant)
//   • granteeC   — UNsubscribed grantee in a SECOND managed tenant; used for the
//                  super-admin tenant-exempt + tenant-disable flows
//
// Auth in-browser is via /login (#email / #password), exactly like the existing
// specs. Web-first assertions, no arbitrary sleeps. Everything seeded is
// registered and torn down in afterAll (bottom-up; FK cascades do the rest).
// ============================================================================

test.describe('Cross-role visibility', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120000);

  const ctx = {
    pass: 'TestPassword123!',
    contexts: [],
  };

  // --- login helper: fill /login and wait for the role/access-specific landing.
  async function login(page, email, expectedUrl) {
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', ctx.pass);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(expectedUrl, { timeout: 20000 });
  }

  // Open the grantee's notification bell on a stable logged-in page and assert a
  // notification whose text matches `needle` is present. A fresh page load
  // re-fetches notifications, so this also proves the cross-actor write reached
  // the grantee's feed (not just realtime).
  async function expectGranteeNotification(page, needle) {
    await page.goto('/');
    await page.locator('.notification-bell-trigger').click();
    await expect(
      page.locator('.notification-item', { hasText: needle }).first()
    ).toBeVisible({ timeout: 10000 });
  }

  test.beforeAll(async ({ browser, supabase }) => {
    test.setTimeout(180000);
    ctx.supabase = supabase;
    ctx.reg = createCrossRoleRegistry();
    const ts = Date.now();

    // ---- Main managed tenant: admin + granteeA + granteeB ------------------
    ctx.adminEmail   = `xrole_admin_${ts}@test.local`;
    ctx.granteeAEmail = `xrole_granteea_${ts}@test.local`;
    ctx.granteeBEmail = `xrole_granteeb_${ts}@test.local`;

    const adminAuth    = await seedAuthUser(supabase, ctx.reg, ctx.adminEmail, ctx.pass);
    const granteeAAuth = await seedAuthUser(supabase, ctx.reg, ctx.granteeAEmail, ctx.pass);
    const granteeBAuth = await seedAuthUser(supabase, ctx.reg, ctx.granteeBEmail, ctx.pass);

    ctx.tenantName = `Cross Role Tenant ${ts}`;
    const tenant = await seedManagedTenant(supabase, ctx.reg, ctx.tenantName);
    ctx.tenantId = tenant.id;

    const admin = await seedUserRecord(
      supabase, ctx.reg, tenant.id, adminAuth.id, ctx.adminEmail, 'admin',
      { firstname: 'Ada', lastname: 'Admin', org: ctx.tenantName });
    ctx.adminUserId = admin.id;
    // Admin is in a subscription-required tenant, so it needs premium to keep
    // write access (otherwise the console degrades to read-only and the
    // approve/reject/comment controls are disabled).
    await seedMembership(supabase, ctx.reg, admin.id, 'premium');

    const granteeA = await seedUserRecord(
      supabase, ctx.reg, tenant.id, granteeAAuth.id, ctx.granteeAEmail, 'grantee',
      { firstname: 'Aria', lastname: 'Grantee', org: 'Helping Hands' });
    ctx.granteeAUserId = granteeA.id;
    await seedMembership(supabase, ctx.reg, granteeA.id, 'basic');

    // granteeB has NO membership on purpose (gated until the admin waives it).
    const granteeB = await seedUserRecord(
      supabase, ctx.reg, tenant.id, granteeBAuth.id, ctx.granteeBEmail, 'grantee',
      { firstname: 'Bea', lastname: 'Grantee', org: 'Hope Foundation' });
    ctx.granteeBUserId = granteeB.id;
    ctx.granteeBName = 'Bea Grantee';

    // ---- Grants owned by granteeA -----------------------------------------
    ctx.grantApproveName = `XRole Approve ${ts}`;
    ctx.grantChangesName = `XRole Changes ${ts}`;
    ctx.grantRejectName  = `XRole Reject ${ts}`;
    ctx.grantItemsName   = `XRole Items ${ts}`;

    ctx.grantApprove = await seedGrant(supabase, ctx.reg, granteeA.id, tenant.id, ctx.grantApproveName, 'pending');
    ctx.grantChanges = await seedGrant(supabase, ctx.reg, granteeA.id, tenant.id, ctx.grantChangesName, 'pending');
    ctx.grantReject  = await seedGrant(supabase, ctx.reg, granteeA.id, tenant.id, ctx.grantRejectName, 'pending');
    // Approved grant carrying budget items + expenses for the item-review flow.
    ctx.grantItems   = await seedGrant(supabase, ctx.reg, granteeA.id, tenant.id, ctx.grantItemsName, 'approved');

    ctx.biApproveName = `BI Approve ${ts}`;
    ctx.biRejectName  = `BI Reject ${ts}`;
    ctx.expApproveName = `Exp Approve ${ts}`;
    ctx.expCascadeName = `Exp Cascade ${ts}`;

    ctx.biApprove = await seedBudgetItem(supabase, ctx.reg, ctx.grantItems.id, ctx.biApproveName, 4000, 'pending');
    ctx.biReject  = await seedBudgetItem(supabase, ctx.reg, ctx.grantItems.id, ctx.biRejectName, 3000, 'pending');
    ctx.expApprove = await seedExpense(
      supabase, ctx.reg, ctx.grantItems.id, ctx.biApprove.id, ctx.expApproveName, 500, '2025-05-10', 'pending');
    // expCascade starts APPROVED under biReject so rejecting biReject must reset
    // it back to pending on the grantee's side (the documented cascade rule).
    ctx.expCascade = await seedExpense(
      supabase, ctx.reg, ctx.grantItems.id, ctx.biReject.id, ctx.expCascadeName, 700, '2025-05-12', 'approved');

    // ---- Super-admin + second tenant (granteeC) ---------------------------
    ctx.superEmail = `xrole_super_${ts}@test.local`;
    ctx.granteeCEmail = `xrole_granteec_${ts}@test.local`;
    const superAuth   = await seedAuthUser(supabase, ctx.reg, ctx.superEmail, ctx.pass);
    const granteeCAuth = await seedAuthUser(supabase, ctx.reg, ctx.granteeCEmail, ctx.pass);

    // Super-admin needs a home tenant (users.tenant_id is NOT NULL).
    const superHome = await seedManagedTenant(
      supabase, ctx.reg, `Super Home ${ts}`, { require_subscription: false });
    await seedUserRecord(
      supabase, ctx.reg, superHome.id, superAuth.id, ctx.superEmail, 'super_admin',
      { firstname: 'Sam', lastname: 'Super', org: `Super Home ${ts}` });

    ctx.subTenantName = `Sub Toggle Tenant ${ts}`;
    const subTenant = await seedManagedTenant(supabase, ctx.reg, ctx.subTenantName);
    ctx.subTenantId = subTenant.id;
    const granteeC = await seedUserRecord(
      supabase, ctx.reg, subTenant.id, granteeCAuth.id, ctx.granteeCEmail, 'grantee',
      { firstname: 'Cleo', lastname: 'Grantee', org: 'Bright Org' });
    ctx.granteeCUserId = granteeC.id;

    // ---- Browser contexts (one per actor) ---------------------------------
    const newCtxPage = async () => {
      const c = await browser.newContext();
      ctx.contexts.push(c);
      return c.newPage();
    };
    ctx.adminPage    = await newCtxPage();
    ctx.granteeAPage = await newCtxPage();
    ctx.granteeBPage = await newCtxPage();
    ctx.superPage    = await newCtxPage();
    ctx.granteeCPage = await newCtxPage();

    // Log everyone in to their role/access-appropriate landing.
    await login(ctx.adminPage, ctx.adminEmail, '**/admin');
    await login(ctx.granteeAPage, ctx.granteeAEmail, (url) => url.pathname === '/');
    await login(ctx.granteeBPage, ctx.granteeBEmail, '**/home'); // gated (no subscription)
    await login(ctx.superPage, ctx.superEmail, '**/super/tenants');
    await login(ctx.granteeCPage, ctx.granteeCEmail, '**/home'); // gated (no subscription)
  });

  test.afterAll(async () => {
    for (const c of ctx.contexts) await c.close().catch(() => {});
    await teardownCrossRole(ctx.supabase, ctx.reg);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Grantee submits a grant → admin sees it everywhere it should appear.
  // ──────────────────────────────────────────────────────────────────────────
  test('grantee submits a grant → admin sees it in /admin/grants, the review queue and the pending count', async ({ supabase }) => {
    const granteeA = ctx.granteeAPage;
    const admin = ctx.adminPage;
    const submittedName = `XRole Submitted ${Date.now()}`;

    // Grantee fills the real /grants/new form and submits.
    await granteeA.goto('/grants/new');
    await granteeA.fill('#grant_name', submittedName);
    await granteeA.fill('#start_spend_period', '2025-01-01');
    await granteeA.fill('#end_spend_period', '2025-12-31');
    await granteeA.fill('#grant_amount', '15000');

    const insertPromise = granteeA.waitForResponse(r =>
      r.url().includes('grant_record') && r.request().method() === 'POST' &&
      (r.status() === 201 || r.status() === 200));
    await granteeA.getByRole('button', { name: /Submit Application/i }).click();
    await insertPromise;
    await granteeA.waitForURL('**/grants', { timeout: 15000 });

    // Track the new grant for teardown + locate it for the admin assertions.
    const { data: row } = await supabase
      .from('grant_record').select('id').eq('grant_name', submittedName).single();
    expect(row).toBeTruthy();
    ctx.reg.grantIds.push(row.id);

    // Admin dashboard: review queue contains the grant, and a Pending stat shows.
    await admin.goto('/admin');
    await expect(admin.locator('.admin-queue-item', { hasText: submittedName })).toBeVisible({ timeout: 10000 });
    const pendingCard = admin.locator('.admin-stat-card', { hasText: 'Pending' }).first();
    await expect(pendingCard.locator('.asc-value')).toBeVisible();
    // The grant is reviewable straight from the queue.
    await expect(
      admin.locator('.admin-queue-item', { hasText: submittedName }).getByRole('link', { name: /Review/i })
    ).toBeVisible();

    // Admin all-grants list also lists the freshly submitted grant.
    await admin.goto('/admin/grants');
    await expect(admin.locator('td.grant-name-cell', { hasText: submittedName })).toBeVisible({ timeout: 10000 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Admin approve + comment + disbursed → grantee sees status, history,
  //    comment, disbursed amount and notifications.
  // ──────────────────────────────────────────────────────────────────────────
  test('admin approves + comments + sets disbursed → grantee sees status, history, comment, disbursed amount and notifications', async () => {
    const admin = ctx.adminPage;
    const granteeA = ctx.granteeAPage;
    const id = ctx.grantApprove.id;
    const commentText = `Looks great — approved by admin ${Date.now()}`;

    await admin.goto(`/admin/grants/${id}`);
    await expect(admin.locator('.arh-title h2')).toContainText(ctx.grantApproveName);

    // Approve.
    await admin.locator('button.action-btn.approve').click();
    const approvePromise = admin.waitForResponse(r =>
      r.url().includes('grant_record') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await admin.locator('button.action-submit-btn.approve').click();
    await approvePromise;
    await expect(admin.locator('text=Grant approved.')).toBeVisible({ timeout: 10000 });

    // Set disbursed funds (control only appears once approved).
    const disbursedCard = admin.locator('.admin-card', { hasText: 'Disbursed Funds' });
    await disbursedCard.locator('input[type="number"]').fill('4321');
    const disbursePromise = admin.waitForResponse(r =>
      r.url().includes('grant_record') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await disbursedCard.getByRole('button', { name: /Update Disbursed Funds/i }).click();
    await disbursePromise;
    await expect(admin.locator('text=Disbursed funds updated.')).toBeVisible({ timeout: 10000 });

    // Post a comment.
    await admin.locator('.comment-textarea').fill(commentText);
    const commentPromise = admin.waitForResponse(r =>
      r.url().includes('grant_comments') && r.request().method() === 'POST' &&
      (r.status() === 201 || r.status() === 200));
    await admin.getByRole('button', { name: /Post Comment/i }).click();
    await commentPromise;
    await expect(admin.locator('text=Comment posted successfully.')).toBeVisible({ timeout: 10000 });

    // Grantee detail: new status + a status-history entry + the admin comment.
    await granteeA.goto(`/grants/${id}`);
    await expect(granteeA.locator('.detail-banner-title .status-badge')).toContainText('Approved');
    await expect(granteeA.locator('.status-timeline')).toContainText('Approved');
    const commentsSection = granteeA.locator('.detail-section', { hasText: 'Admin Comments' });
    await expect(commentsSection).toContainText(commentText);

    // Grantee grants list shows the disbursed amount the admin set.
    await granteeA.goto('/grants');
    const grantRow = granteeA.locator('tr', { hasText: ctx.grantApproveName });
    await expect(grantRow).toContainText('$4,321');

    // Grantee notifications: grant approved + new comment.
    await expectGranteeNotification(granteeA, 'has been approved');
    await expectGranteeNotification(granteeA, 'New Comment');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Admin request-changes → grantee sees needs_changes + notes + notification.
  // ──────────────────────────────────────────────────────────────────────────
  test('admin requests changes → grantee sees Needs Changes status, the notes and a notification', async () => {
    const admin = ctx.adminPage;
    const granteeA = ctx.granteeAPage;
    const id = ctx.grantChanges.id;
    const notes = `Please itemise the travel budget ${Date.now()}`;

    await admin.goto(`/admin/grants/${id}`);
    await expect(admin.locator('.arh-title h2')).toContainText(ctx.grantChangesName);
    await admin.locator('button.action-btn.changes').click();
    await admin.locator('.action-form textarea').fill(notes);
    const patchPromise = admin.waitForResponse(r =>
      r.url().includes('grant_record') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await admin.locator('button.action-submit-btn.needs_changes').click();
    await patchPromise;
    await expect(admin.locator('text=Grant returned for changes.')).toBeVisible({ timeout: 10000 });

    await granteeA.goto(`/grants/${id}`);
    await expect(granteeA.locator('.detail-banner-title .status-badge')).toContainText('Needs Changes');
    await expect(granteeA.locator('.status-timeline')).toContainText('Needs Changes');
    // Approval notes render in the Grant Information grid.
    await expect(granteeA.locator('.detail-info-value.notes')).toContainText(notes);
    // The grantee gets the "Edit Application" affordance for a needs_changes grant.
    await expect(granteeA.getByRole('link', { name: /Edit Application/i })).toBeVisible();

    await expectGranteeNotification(granteeA, 'requires changes');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Admin reject → grantee sees rejected + notification.
  // ──────────────────────────────────────────────────────────────────────────
  test('admin rejects a grant → grantee sees Rejected status and a notification', async () => {
    const admin = ctx.adminPage;
    const granteeA = ctx.granteeAPage;
    const id = ctx.grantReject.id;

    await admin.goto(`/admin/grants/${id}`);
    await expect(admin.locator('.arh-title h2')).toContainText(ctx.grantRejectName);
    await admin.locator('button.action-btn.reject').click();
    await admin.locator('.action-form textarea').fill('Out of scope for this cycle.');
    const patchPromise = admin.waitForResponse(r =>
      r.url().includes('grant_record') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await admin.locator('button.action-submit-btn.reject').click();
    await patchPromise;
    await expect(admin.locator('text=Grant rejected.')).toBeVisible({ timeout: 10000 });

    await granteeA.goto(`/grants/${id}`);
    await expect(granteeA.locator('.detail-banner-title .status-badge')).toContainText('Rejected');
    await expect(granteeA.locator('.status-timeline')).toContainText('Rejected');

    await expectGranteeNotification(granteeA, 'has been rejected');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Admin approve/reject budget item + expense → grantee sees the badge
  //    change + notification, and rejecting a budget item resets its expenses
  //    to pending for the grantee (the cascade rule).
  // ──────────────────────────────────────────────────────────────────────────
  test('admin approves/rejects budget items & expenses → grantee sees badge changes, notifications and the reject→expenses-reset cascade', async ({ supabase }) => {
    const admin = ctx.adminPage;
    const granteeA = ctx.granteeAPage;
    const id = ctx.grantItems.id;

    await admin.goto(`/admin/grants/${id}`);
    await expect(admin.locator('.arh-title h2')).toContainText(ctx.grantItemsName);

    // Approve the pending budget item.
    const biApproveBlock = admin.locator('.admin-bi-block', { hasText: ctx.biApproveName });
    const biApprovePromise = admin.waitForResponse(r =>
      r.url().includes('budget_items') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await biApproveBlock.locator('button.admin-approve-btn').first().click();
    await biApprovePromise;

    // Approve the pending expense under it.
    const expApproveRow = admin.locator('tr', { hasText: ctx.expApproveName });
    const expApprovePromise = admin.waitForResponse(r =>
      r.url().includes('expenses') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await expApproveRow.locator('button.admin-approve-btn').first().click();
    await expApprovePromise;

    // Reject the other budget item — this must cascade its (approved) expense
    // back to pending. Wait on the expenses cascade PATCH explicitly.
    const biRejectBlock = admin.locator('.admin-bi-block', { hasText: ctx.biRejectName });
    const biRejectPromise = admin.waitForResponse(r =>
      r.url().includes('budget_items') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    const cascadePromise = admin.waitForResponse(r =>
      r.url().includes('expenses') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await biRejectBlock.locator('button.admin-reject-btn').first().click();
    await biRejectPromise;
    await cascadePromise;

    // DB sanity for the cascade (the grantee assertion below is the real proof).
    await expect.poll(async () => {
      const { data } = await supabase.from('expenses').select('status').eq('id', ctx.expCascade.id).single();
      return data?.status;
    }, { timeout: 10000 }).toBe('pending');

    // Grantee breakdown reflects all of it.
    await granteeA.goto(`/grants/${id}/breakdown`);

    const granteeBiApprove = granteeA.locator('.budget-item-block', { hasText: ctx.biApproveName });
    await expect(granteeBiApprove.locator('.status-icon-approved').first()).toBeVisible({ timeout: 10000 });
    // Expand to see the approved expense badge.
    await granteeBiApprove.locator('.budget-item-toggle').click();
    const granteeExpApproveRow = granteeBiApprove.locator('tr', { hasText: ctx.expApproveName });
    await expect(granteeExpApproveRow.locator('.status-icon-approved')).toBeVisible();

    const granteeBiReject = granteeA.locator('.budget-item-block', { hasText: ctx.biRejectName });
    await expect(granteeBiReject.locator('.status-icon-rejected').first()).toBeVisible();
    // Its expense was reset to pending for the grantee (cascade).
    await granteeBiReject.locator('.budget-item-toggle').click();
    const granteeExpCascadeRow = granteeBiReject.locator('tr', { hasText: ctx.expCascadeName });
    await expect(granteeExpCascadeRow.locator('.status-icon-pending')).toBeVisible();

    // Notifications for the budget/expense decisions.
    await expectGranteeNotification(granteeA, 'Budget Item Approved');
    await expectGranteeNotification(granteeA, 'Expense Approved');
    await expectGranteeNotification(granteeA, 'Budget Item Rejected');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Admin waive subscription → grantee gains access; remove waiver → gated.
  // ──────────────────────────────────────────────────────────────────────────
  test('admin waives a grantee subscription → grantee gains access (Basic waived); remove waiver → grantee gated again', async () => {
    const admin = ctx.adminPage;
    const granteeB = ctx.granteeBPage;

    // Precondition: granteeB is gated. A full navigation re-bootstraps the
    // session, so a guarded grantee route bounces to the billing-nudge landing.
    await granteeB.goto('/grants');
    await granteeB.waitForURL('**/home', { timeout: 15000 });
    await granteeB.goto('/subscription');
    await expect(granteeB.locator('.subscription-status-chip')).toContainText('No active subscription');

    // Admin waives granteeB from User Management.
    await admin.goto('/admin/users');
    await expect(admin.locator('.admin-title')).toContainText('User Management');
    const row = admin.locator('tr', { hasText: ctx.granteeBName });
    const waivePromise = admin.waitForResponse(r =>
      r.url().includes('user_memberships') &&
      (r.request().method() === 'POST' || r.request().method() === 'PATCH') &&
      (r.status() === 200 || r.status() === 201));
    await row.getByRole('button', { name: /^Waive/ }).click();
    await waivePromise;
    await expect(row.locator('.user-status-pill', { hasText: 'Waived' })).toBeVisible({ timeout: 10000 });

    // Grantee now has access — a guarded route renders, and the chip says waived.
    await granteeB.goto('/grants');
    await expect(granteeB.locator('.grants-page-title')).toBeVisible({ timeout: 15000 });
    await granteeB.goto('/subscription');
    await expect(granteeB.locator('.subscription-status-chip')).toContainText('waived by your administrator');

    // Admin removes the waiver.
    await admin.goto('/admin/users');
    const row2 = admin.locator('tr', { hasText: ctx.granteeBName });
    const removePromise = admin.waitForResponse(r =>
      r.url().includes('user_memberships') && r.request().method() === 'DELETE' &&
      (r.status() === 200 || r.status() === 204));
    await row2.getByRole('button', { name: /Remove Waiver/i }).click();
    await removePromise;
    await expect(row2.locator('.user-status-pill', { hasText: 'None' })).toBeVisible({ timeout: 10000 });

    // Grantee is gated again on the next load.
    await granteeB.goto('/grants');
    await granteeB.waitForURL('**/home', { timeout: 15000 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Super-admin exempt tenant → grantee in it gains access; re-require → gated.
  // ──────────────────────────────────────────────────────────────────────────
  test('super-admin exempts a tenant → grantee in it gains access; re-require → grantee gated', async () => {
    const superPage = ctx.superPage;
    const granteeC = ctx.granteeCPage;

    // Precondition: granteeC is gated.
    await granteeC.goto('/grants');
    await granteeC.waitForURL('**/home', { timeout: 15000 });

    // Super-admin flips the tenant to Exempt.
    await superPage.goto('/super/tenants');
    await superPage.locator('.admin-search-box input').fill(ctx.subTenantName);
    const row = superPage.locator('tr', { hasText: ctx.subTenantName });
    const exemptPromise = superPage.waitForResponse(r =>
      r.url().includes('tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: /^Required/ }).click();
    await exemptPromise;
    await expect(row.getByRole('button', { name: /^Exempt/ })).toBeVisible({ timeout: 10000 });

    // Grantee in that tenant now has full access without subscribing.
    await granteeC.goto('/grants');
    await expect(granteeC.locator('.grants-page-title')).toBeVisible({ timeout: 15000 });
    await granteeC.goto('/subscription');
    await expect(granteeC.locator('.subscription-status-chip')).toContainText('Full Access');

    // Super-admin requires subscriptions again.
    await superPage.goto('/super/tenants');
    await superPage.locator('.admin-search-box input').fill(ctx.subTenantName);
    const row2 = superPage.locator('tr', { hasText: ctx.subTenantName });
    const requirePromise = superPage.waitForResponse(r =>
      r.url().includes('tenant_settings') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row2.getByRole('button', { name: /^Exempt/ }).click();
    await requirePromise;
    await expect(row2.getByRole('button', { name: /^Required/ })).toBeVisible({ timeout: 10000 });

    // Grantee is gated again.
    await granteeC.goto('/grants');
    await granteeC.waitForURL('**/home', { timeout: 15000 });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Super-admin disable tenant → its users locked out on next load;
  //    re-enable → restored.
  // ──────────────────────────────────────────────────────────────────────────
  test('super-admin disables a tenant → its grantee is locked out on next load; re-enable → restored', async () => {
    const superPage = ctx.superPage;
    const granteeC = ctx.granteeCPage;

    // Disable the tenant.
    await superPage.goto('/super/tenants');
    await superPage.locator('.admin-search-box input').fill(ctx.subTenantName);
    const row = superPage.locator('tr', { hasText: ctx.subTenantName });
    await expect(row.locator('.user-status-pill')).toContainText('Active');
    await row.getByRole('button', { name: /^Disable/ }).click();
    const disablePromise = superPage.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row.getByRole('button', { name: 'Yes' }).click();
    await disablePromise;
    await expect(row.locator('.user-status-pill')).toContainText('Disabled');

    // Grantee in the disabled tenant is locked out on the next page load.
    await granteeC.goto('/');
    await expect(granteeC.getByText('Account Disabled')).toBeVisible({ timeout: 15000 });

    // Re-enable the tenant.
    await superPage.goto('/super/tenants');
    await superPage.locator('.admin-search-box input').fill(ctx.subTenantName);
    const row2 = superPage.locator('tr', { hasText: ctx.subTenantName });
    await row2.getByRole('button', { name: /^Enable/ }).click();
    const enablePromise = superPage.waitForResponse(r =>
      r.url().includes('/rest/v1/tenants') && r.request().method() === 'PATCH' &&
      (r.status() === 200 || r.status() === 204));
    await row2.getByRole('button', { name: 'Yes' }).click();
    await enablePromise;
    await expect(row2.locator('.user-status-pill')).toContainText('Active');

    // Access restored: the grantee (signed out by the disable) can log in again.
    // It is unsubscribed, so it lands on the billing-nudge home rather than being
    // blocked by the Account Disabled screen.
    await login(granteeC, ctx.granteeCEmail, '**/home');
  });
});
