const base = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

// Helper to clean up arrays of items
async function deleteRows(supabase, table, idCol, ids) {
  if (ids.length === 0) return;
  const { error } = await supabase.from(table).delete().in(idCol, ids);
  if (error) console.error(`Error deleting from ${table}:`, error.message);
}

const test = base.test.extend({
  supabase: async ({}, use) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const client = createClient(supabaseUrl, supabaseKey);
    await use(client);
  },

  // 2. Data Provider that handles teardown automatically
  testData: async ({ supabase }, use) => {
    // Registry of created items for teardown
    const registry = {
      grantIds: [],
      budgetIds: [],
      expenseIds: [],
      subscriptionIds: [],
      userIds: [],     // int PKs in users table
      tenantIds: [],
      authUids: [],    // UUIDs in auth.users
      inviteIds: []
    };

    // The fixture provides helper methods to create things AND track them
    const provider = {
      registry,

      registerUIUser: async (email) => {
        const { data: user, error } = await supabase.from('users').select('id, user_id, tenant_id').eq('email', email.toLowerCase()).single();
        if (error) return; // Maybe not created yet? Wait, this is called after creation.
        if (user) {
          registry.userIds.push(user.id);
          registry.authUids.push(user.user_id);
          registry.tenantIds.push(user.tenant_id);
        }
        return user;
      },

      createAuthUser: async (email, password = 'TestPassword123!') => {
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true
        });
        if (error) throw error;
        registry.authUids.push(data.user.id);
        return data.user;
      },

      provisionSelfServiceTenant: async (authUid, email, firstname = 'Test', lastname = 'User', org = 'Test Org') => {
        const { data, error } = await supabase.rpc('provision_self_service_tenant', {
          p_auth_uid: authUid,
          p_email: email,
          p_firstname: firstname,
          p_lastname: lastname,
          p_organization: org,
          p_phone: '555-0000',
          p_tax_month: 1
        });
        if (error) throw error;
        registry.userIds.push(data.id);
        registry.tenantIds.push(data.tenant_id);
        return data;
      },

      createManagedTenant: async (name) => {
        const { data, error } = await supabase.from('tenants').insert({
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now(),
          tenant_type: 'managed'
        }).select().single();
        if (error) throw error;
        registry.tenantIds.push(data.id);
        return data;
      },

      createTenantSettings: async (tenantId, settings = {}) => {
        const { data, error } = await supabase.from('tenant_settings').insert({
          tenant_id: tenantId,
          ...settings
        }).select().single();
        if (error) throw error;
        return data;
      },

      createUserRecord: async (tenantId, authUid, email, role, firstname = 'Test', lastname = 'User', org = 'Test Org') => {
        const { data, error } = await supabase.from('users').insert({
          tenant_id: tenantId,
          user_id: authUid,
          email,
          role,
          firstname,
          lastname,
          organization_name: org,
          phone_number: '555-0000'
        }).select().single();
        if (error) throw error;
        registry.userIds.push(data.id);
        return data;
      },

      createSubscription: async (userId, tier = 'premium', status = 'active') => {
        // The DB enforces that a subscription's product ID matches the configured
        // platform_settings product ID for its tier (enforce_subscription_tier_product_match).
        // Read the live IDs rather than hard-coding them so the fixture stays
        // correct regardless of which seed the shared stack is running.
        const { data: settings, error: settingsError } = await supabase
          .from('platform_settings')
          .select('basic_membership_product_id, premium_membership_product_id')
          .eq('id', 1)
          .single();
        if (settingsError) throw settingsError;
        const productId = tier === 'premium'
          ? settings.premium_membership_product_id
          : settings.basic_membership_product_id;

        const { data, error } = await supabase.from('subscriptions').insert({
          user_id: userId,
          stripe_customer_id: `cus_${Date.now()}`,
          stripe_subscription_id: `sub_${Date.now()}`,
          stripe_product_id: productId,
          stripe_price_id: `price_${Date.now()}`,
          membership_tier: tier,
          status,
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }).select().single();
        if (error) throw error;
        registry.subscriptionIds.push(data.id);
        
        // Also insert user_membership
        await supabase.from('user_memberships').insert({
          user_id: userId,
          subscription_id: data.id,
          membership_tier: tier,
          is_active: status === 'active',
          source: 'stripe',
          starts_at: new Date().toISOString()
        });

        return data;
      },
      
      createGrant: async (userId, tenantId = null, name = `E2E Grant ${Date.now()}`, status = 'pending') => {
        const { data, error } = await supabase.from('grant_record').insert({
          user_id: userId,
          ...(tenantId && { tenant_id: tenantId }),
          grant_name: name,
          grant_amount: 10000,
          status,
          start_spend_period: '2025-01-01',
          end_spend_period: '2025-12-31'
        }).select().single();
        if (error) throw error;
        registry.grantIds.push(data.id);
        return data;
      },

      createBudgetItem: async (grantId, name, amount) => {
        const { data, error } = await supabase.from('budget_items').insert({
          grant_id: grantId,
          item_name: name,
          budget_allocated: amount
        }).select().single();
        if (error) throw error;
        registry.budgetIds.push(data.id);
        return data;
      },

      createExpense: async (grantId, budgetId, name, amount, date) => {
        const { data, error } = await supabase.from('expenses').insert({
          grant_id: grantId,
          budget_item_id: budgetId,
          item_name: name,
          amount_spent: amount,
          expense_date: date
        }).select().single();
        if (error) throw error;
        registry.expenseIds.push(data.id);
        return data;
      },

      createInvite: async (tenantId, email, role, createdBy) => {
        const { data, error } = await supabase.from('invites').insert({
          tenant_id: tenantId,
          token: require('crypto').randomUUID(),
          role,
          email,
          created_by: createdBy,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }).select().single();
        if (error) throw error;
        registry.inviteIds.push(data.id);
        return data;
      }
    };

    await use(provider);

    // TEARDOWN - STRICT BOTTOM UP ORDER
    await deleteRows(supabase, 'expenses', 'id', registry.expenseIds);
    await deleteRows(supabase, 'budget_items', 'id', registry.budgetIds);
    await deleteRows(supabase, 'grant_record', 'id', registry.grantIds);
    await deleteRows(supabase, 'user_memberships', 'subscription_id', registry.subscriptionIds);
    await deleteRows(supabase, 'subscriptions', 'id', registry.subscriptionIds);
    await deleteRows(supabase, 'users', 'id', registry.userIds);
    await deleteRows(supabase, 'invites', 'id', registry.inviteIds);
    await deleteRows(supabase, 'tenant_settings', 'tenant_id', registry.tenantIds);
    await deleteRows(supabase, 'tenants', 'id', registry.tenantIds);
    
    for (const uid of registry.authUids) {
      await supabase.auth.admin.deleteUser(uid);
    }
  }
});

module.exports = { test, expect: base.expect };

// ============================================================================
// Lane X — Cross-role visibility multi-actor seed helpers (APPEND-ONLY).
//
// These are standalone helpers used by frontend/tests/e2e/cross-role-visibility.spec.js.
// They intentionally do NOT touch the `testData` fixture above or its teardown
// order. The cross-role spec drives several actors (admin / grantee / second
// grantee / super-admin / another grantee) each in their own browser context,
// seeded once into shared managed tenants in `beforeAll`. Because `beforeAll`
// runs outside the per-test `testData` fixture, these helpers take an explicit
// service-role client + a caller-owned registry and the spec tears everything
// down itself in `afterAll` (mirroring the bottom-up order used by the fixture).
//
// Only additive: new exported functions, attached to module.exports below. No
// existing helper or teardown step is modified.
// ============================================================================

// Build a fresh service-role client from the same env the `supabase` fixture uses.
function createServiceClient() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(supabaseUrl, supabaseKey);
}

// A registry of every row a cross-role spec creates, for deterministic teardown.
function createCrossRoleRegistry() {
  return {
    authUids: [],
    userIds: [],
    tenantIds: [],
    grantIds: [],
    budgetIds: [],
    expenseIds: [],
    subscriptionIds: [],
    inviteIds: [],
  };
}

async function seedAuthUser(supabase, registry, email, password = 'TestPassword123!') {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  registry.authUids.push(data.user.id);
  return data.user;
}

// A managed tenant + its settings. Defaults to a fully-gated tenant (all
// approvals + subscription required) so cross-role review/billing flows have
// something to assert against; callers override via `settings`.
async function seedManagedTenant(supabase, registry, name, settings = {}) {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const { data: tenant, error } = await supabase
    .from('tenants')
    .insert({ name, slug, tenant_type: 'managed', is_active: true })
    .select()
    .single();
  if (error) throw error;
  registry.tenantIds.push(tenant.id);

  const { error: sErr } = await supabase.from('tenant_settings').insert({
    tenant_id: tenant.id,
    require_grant_approval: true,
    require_budget_approval: true,
    require_expense_approval: true,
    require_subscription: true,
    ...settings,
  });
  if (sErr) throw sErr;
  return tenant;
}

async function seedUserRecord(supabase, registry, tenantId, authUid, email, role, opts = {}) {
  const { data, error } = await supabase
    .from('users')
    .insert({
      tenant_id: tenantId,
      user_id: authUid,
      email,
      role,
      firstname: opts.firstname || 'Test',
      lastname: opts.lastname || 'User',
      organization_name: opts.org || 'Cross Role Org',
      phone_number: '555-0000',
    })
    .select()
    .single();
  if (error) throw error;
  registry.userIds.push(data.id);
  return data;
}

// An active Stripe-sourced membership so the user passes the subscription gate.
// Mirrors testData.createSubscription's product-id resolution so it stays valid
// regardless of which seed the shared stack is running.
async function seedMembership(supabase, registry, userId, tier = 'basic') {
  const { data: settings, error: settingsError } = await supabase
    .from('platform_settings')
    .select('basic_membership_product_id, premium_membership_product_id')
    .eq('id', 1)
    .single();
  if (settingsError) throw settingsError;
  const productId = tier === 'premium'
    ? settings.premium_membership_product_id
    : settings.basic_membership_product_id;

  const tag = `${Date.now()}_${userId}`;
  const { data: sub, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: userId,
      stripe_customer_id: `cus_${tag}`,
      stripe_subscription_id: `sub_${tag}`,
      stripe_product_id: productId,
      stripe_price_id: `price_${tag}`,
      membership_tier: tier,
      status: 'active',
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  registry.subscriptionIds.push(sub.id);

  await supabase.from('user_memberships').insert({
    user_id: userId,
    subscription_id: sub.id,
    membership_tier: tier,
    is_active: true,
    source: 'stripe',
    starts_at: new Date().toISOString(),
  });
  return sub;
}

async function seedGrant(supabase, registry, userId, tenantId, name, status = 'pending') {
  const { data, error } = await supabase
    .from('grant_record')
    .insert({
      user_id: userId,
      tenant_id: tenantId,
      grant_name: name,
      grant_amount: 10000,
      status,
      start_spend_period: '2025-01-01',
      end_spend_period: '2025-12-31',
      submitted_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  registry.grantIds.push(data.id);
  return data;
}

async function seedBudgetItem(supabase, registry, grantId, name, amount, status = 'pending') {
  // tenant_id is populated by a BEFORE INSERT trigger from the grant; status is
  // left as supplied (the auto-approve trigger only overrides when the tenant
  // has the matching approval requirement turned OFF).
  const { data, error } = await supabase
    .from('budget_items')
    .insert({ grant_id: grantId, item_name: name, budget_allocated: amount, status })
    .select()
    .single();
  if (error) throw error;
  registry.budgetIds.push(data.id);
  return data;
}

async function seedExpense(supabase, registry, grantId, budgetId, name, amount, date, status = 'pending') {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      grant_id: grantId,
      budget_item_id: budgetId,
      item_name: name,
      amount_spent: amount,
      expense_date: date,
      status,
    })
    .select()
    .single();
  if (error) throw error;
  registry.expenseIds.push(data.id);
  return data;
}

// Bottom-up teardown. FK cascades handle child rows (budget_items, expenses,
// grant_comments, grant_status_history, notifications, user_memberships), but we
// delete the registered top-level rows explicitly and in the same order the
// `testData` fixture uses, then remove the auth users last.
async function teardownCrossRole(supabase, registry) {
  await deleteRows(supabase, 'expenses', 'id', registry.expenseIds);
  await deleteRows(supabase, 'budget_items', 'id', registry.budgetIds);
  await deleteRows(supabase, 'grant_record', 'id', registry.grantIds);
  await deleteRows(supabase, 'subscriptions', 'id', registry.subscriptionIds);
  await deleteRows(supabase, 'users', 'id', registry.userIds);
  await deleteRows(supabase, 'invites', 'id', registry.inviteIds);
  await deleteRows(supabase, 'tenant_settings', 'tenant_id', registry.tenantIds);
  await deleteRows(supabase, 'tenants', 'id', registry.tenantIds);
  for (const uid of registry.authUids) {
    await supabase.auth.admin.deleteUser(uid);
  }
}

module.exports.createServiceClient = createServiceClient;
module.exports.createCrossRoleRegistry = createCrossRoleRegistry;
module.exports.seedAuthUser = seedAuthUser;
module.exports.seedManagedTenant = seedManagedTenant;
module.exports.seedUserRecord = seedUserRecord;
module.exports.seedMembership = seedMembership;
module.exports.seedGrant = seedGrant;
module.exports.seedBudgetItem = seedBudgetItem;
module.exports.seedExpense = seedExpense;
module.exports.teardownCrossRole = teardownCrossRole;
