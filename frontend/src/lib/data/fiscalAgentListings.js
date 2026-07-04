// Data-access for the fiscal_agent_listings moderation surface. Super admins
// read pending listings and set verification. The moderation-guard trigger +
// RLS only let super_admin / service_role change the verification column, so
// this is the platform's approval path for new listings.
import { supabase } from '../../supabaseClient';

// Listings awaiting platform verification, oldest first. Super admins see all
// rows via the is_super_admin() SELECT policy on fiscal_agent_listings.
// The tenant's listing (listings are tenant-owned; any admin of the tenant
// manages it). Most recent row wins if a tenant somehow has several.
/**
 * @param {number} tenantId
 */
export const getTenantListing = (tenantId) =>
  supabase
    .from('fiscal_agent_listings')
    .select('*')
    .eq('tenant_id', Number(tenantId))
    .order('updated_at', { ascending: false })
    .limit(1);

// Toggle whether the tenant's listing is accepting projects. RLS scopes the
// write to tenant-admin membership + the fiscal_agent entitlement.
/**
 * @param {number|string} id
 * @param {boolean} accepting
 */
export const updateListingAccepting = (id, accepting) =>
  supabase
    .from('fiscal_agent_listings')
    .update({ accepting })
    .eq('id', Number(id));

// Save owner-editable columns on the tenant's listing (see listingToRow — never
// the verified/verification columns, which only super_admin can change).
/**
 * @param {number|string} id
 * @param {object} row
 */
export const updateTenantListing = (id, row) =>
  supabase
    .from('fiscal_agent_listings')
    .update(row)
    .eq('id', Number(id));

export const listPendingListings = () =>
  supabase
    .from('fiscal_agent_listings')
    .select('*')
    .eq('verification', 'pending')
    .order('created_at', { ascending: true });

// Set a listing's verification. Keep the legacy `verified` boolean in sync with
// the `verification` string (both are read across the fiscal-agent surfaces).
/**
 * @param {number} id
 * @param {'verified' | 'rejected'} verification
 */
export const setListingVerification = (id, verification) =>
  supabase
    .from('fiscal_agent_listings')
    .update({ verification, verified: verification === 'verified' })
    .eq('id', id);
