const base = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

// Helper to clean up arrays of items
async function deleteRows(supabase, table, idCol, ids) {
  if (ids.length === 0) return;
  const { error } = await supabase.from(table).delete().in(idCol, ids);
  if (error) console.error(`Error deleting from ${table}:`, error.message);
}

const test = base.test.extend({
  supabase: async ({}, use, testInfo) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      testInfo.skip(true, 'Supabase credentials are not configured');
      return;
    }
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
        const { data, error } = await supabase.from('subscriptions').insert({
          user_id: userId,
          stripe_customer_id: `cus_${Date.now()}`,
          stripe_subscription_id: `sub_${Date.now()}`,
          stripe_product_id: tier === 'premium' ? 'prod_UDClBMtvFLKyNW' : 'prod_UKEACUGjIeg3MU',
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
