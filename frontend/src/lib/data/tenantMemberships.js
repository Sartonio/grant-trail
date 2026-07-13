// Data-access for the tenant_memberships table (tenant-owned premium billing).
// Premium ("Fiscal Agents Plan") entitlement is TENANT-owned: one active row per
// tenant, keyed UNIQUE(tenant_id). RLS lets a member SELECT their own tenant's
// row (super_admin sees all; no authenticated writes — the Stripe sync manages
// them via service_role). Callers get Supabase's native { data, error }.
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').TenantMembershipRow} TenantMembershipRow */

// The caller's tenant's active premium membership row, or null. RLS scopes the
// result to the caller's own tenant, so no client-side tenant filter is needed.
// Returns Supabase's native { data, error } (data is the row or null).
export const getMyTenantMembership = () =>
  supabase
    .from('tenant_memberships')
    .select('*')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
