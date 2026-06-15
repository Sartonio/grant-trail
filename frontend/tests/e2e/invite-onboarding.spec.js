// tests/e2e/invite-onboarding.spec.js
// E2E: Invite-Only (Managed Tenant) Onboarding Flow
//
// Seeds a managed tenant + invite, then verifies a new user
// can sign up via /signup?invite=<token>, complete their profile,
// and be assigned to the invite's tenant with the invite's role.

const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Supabase service-role client (bypasses RLS)
// ---------------------------------------------------------------------------
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (supabaseUrl && serviceRoleKey) ? createClient(supabaseUrl, serviceRoleKey) : null;

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------
const TEST_PREFIX = 'e2e_invite';
const uniqueId = Date.now();
const inviteToken = crypto.randomUUID();
const inviteEmail = `invite_grantee_${uniqueId}@test.local`;
const invitePassword = 'TestPassword123!';

// Managed tenant details
const tenantName = `${TEST_PREFIX}_tenant_${uniqueId}`;
const tenantSlug = `${TEST_PREFIX}-${uniqueId}`;
const adminEmail = `${TEST_PREFIX}_admin_${uniqueId}@test.local`;
const adminPassword = 'AdminPass123!';

// Profile data the invited user will fill in
const profileData = {
  firstname: 'Invited',
  lastname: 'Grantee',
  phone: '555-0199',
  organization: 'Invite Test Org',
};

// ---------------------------------------------------------------------------
// Seed & teardown
// ---------------------------------------------------------------------------
let tenantId;
let adminAuthId;
let adminUserId;
let inviteId;
// Track the auth uid of the invited user so we can clean it up
let invitedAuthUid;

test.beforeAll(async () => {
  if (!supabase) return;
  // 1. Create a managed tenant
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .insert({ name: tenantName, slug: tenantSlug, tenant_type: 'managed' })
    .select()
    .single();
  expect(tenantErr).toBeNull();
  tenantId = tenant.id;

  // 2. Create tenant_settings for that tenant
  const { error: settingsErr } = await supabase
    .from('tenant_settings')
    .insert({
      tenant_id: tenantId,
      require_grant_approval: true,
      require_budget_approval: true,
      require_expense_approval: true,
      require_subscription: false,
    });
  expect(settingsErr).toBeNull();

  // 3. Create an admin auth user via the Admin API
  const { data: adminAuth, error: adminAuthErr } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  expect(adminAuthErr).toBeNull();
  adminAuthId = adminAuth.user.id;

  // 4. Insert the admin into the users table
  const { data: adminUser, error: adminUserErr } = await supabase
    .from('users')
    .insert({
      tenant_id: tenantId,
      email: adminEmail,
      user_id: adminAuthId,
      firstname: 'Admin',
      lastname: 'User',
      organization_name: tenantName,
      phone_number: '555-0001',
      role: 'admin',
    })
    .select()
    .single();
  expect(adminUserErr).toBeNull();
  adminUserId = adminUser.id;

  // 5. Create an invite row linked to the managed tenant
  const { data: invite, error: inviteErr } = await supabase
    .from('invites')
    .insert({
      tenant_id: tenantId,
      token: inviteToken,
      role: 'grantee',
      email: inviteEmail,
      created_by: adminAuthId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();
  expect(inviteErr).toBeNull();
  inviteId = invite.id;
});

test.afterAll(async () => {
  if (!supabase) return;
  // Clean up in reverse order (respect FK constraints)
  // Delete the invited user's users record (if created)
  if (invitedAuthUid) {
    await supabase.from('users').delete().eq('user_id', invitedAuthUid);
    await supabase.auth.admin.deleteUser(invitedAuthUid);
  }
  // Delete invite
  if (inviteId) {
    await supabase.from('invites').delete().eq('id', inviteId);
  }
  // Delete admin user record + auth
  if (adminUserId) {
    await supabase.from('users').delete().eq('id', adminUserId);
  }
  if (adminAuthId) {
    await supabase.auth.admin.deleteUser(adminAuthId);
  }
  // Delete tenant settings + tenant
  if (tenantId) {
    await supabase.from('tenant_settings').delete().eq('tenant_id', tenantId);
    await supabase.from('tenants').delete().eq('id', tenantId);
  }
});

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
test('Invite-only onboarding: signup via invite link → correct tenant & role', async ({ page }) => {
  test.skip(!supabase, 'Supabase client is not configured');
  // ── Step 1: Navigate to /signup with invite token ──────────────────
  await page.goto(`/signup?invite=${inviteToken}`);

  // The signup page should show the invite context (e.g. "invited to join as a grantee")
  await expect(page.getByText('grantee', { exact: false })).toBeVisible({ timeout: 10000 });

  // Email field should be pre-filled with the invite email and disabled
  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toHaveValue(inviteEmail);

  // Fill password
  await page.fill('input[type="password"]', invitePassword);

  // Submit signup
  await page.click('button[type="submit"]');

  // ── Step 2: Land on /complete-profile with invite token ────────────
  await page.waitForURL(/\/complete-profile.*invite=/, { timeout: 15000 });

  // The invite context should be shown (tenant name visible)
  await expect(page.getByText(tenantName, { exact: false })).toBeVisible({ timeout: 10000 });

  // ── Step 3: Fill in profile fields ─────────────────────────────────
  // Field IDs from CompleteProfile.js: firstname, lastname, phone, organization
  await page.getByPlaceholder('First name').fill(profileData.firstname);
  await page.getByPlaceholder('Last name').fill(profileData.lastname);
  await page.getByPlaceholder('Phone number').fill(profileData.phone);
  await page.getByPlaceholder('Organization name').fill(profileData.organization);

  // Submit profile
  await page.getByRole('button', { name: 'Complete Setup' }).click();

  // ── Step 4: Expect redirect to grantee home ────────────────────────
  // Login.js sends grantees to '/', App.js renders <Main> for grantees at '/'
  // After CompleteProfile, App.js handleProfileComplete sets session → redirects to '/'
  // We also accept /home (subscription paywall) or /subscription
  await expect(page).toHaveURL(/\:\d+\/?$|\/home|\/subscription/, { timeout: 15000 });

  // ── Step 5: Verify database state ──────────────────────────────────
  // 5a. Find the new user record
  let userRecord = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('email', inviteEmail.toLowerCase())
      .single();

    if (data) {
      userRecord = data;
      break;
    }
    await page.waitForTimeout(500);
  }

  expect(userRecord).not.toBeNull();
  // Save auth uid for cleanup
  invitedAuthUid = userRecord.user_id;

  // The user must belong to the invite's managed tenant, NOT a new self-service one
  expect(userRecord.tenant_id).toBe(tenantId);
  // The user must have the invite's role
  expect(userRecord.role).toBe('grantee');
  // Profile data should match what was filled in
  expect(userRecord.firstname).toBe(profileData.firstname);
  expect(userRecord.lastname).toBe(profileData.lastname);
  expect(userRecord.phone_number).toBe(profileData.phone);
  expect(userRecord.organization_name).toBe(profileData.organization);

  // 5b. Verify the invite was consumed (used_at is set).
  //     CompleteProfile.js marks the invite via the browser-side Supabase client.
  let consumedInvite = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error: invFetchErr } = await supabase
      .from('invites')
      .select('*')
      .eq('id', inviteId)
      .single();
    expect(invFetchErr).toBeNull();

    if (data && data.used_at) {
      consumedInvite = data;
      break;
    }
    await page.waitForTimeout(500);
  }

  expect(consumedInvite).not.toBeNull();
  expect(consumedInvite.used_at).not.toBeNull();
  expect(consumedInvite.used_by).toBe(invitedAuthUid);

  // Regardless of the RLS edge-case, the user IS in the correct tenant —
  // which proves the invite flow worked end-to-end.
  expect(userRecord.tenant_id).toBe(tenantId);
  expect(userRecord.role).toBe('grantee');

  console.log('✅ Invite onboarding verified: user assigned to managed tenant with role=grantee');
});
