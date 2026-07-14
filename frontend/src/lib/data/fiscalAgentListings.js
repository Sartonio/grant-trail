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

// Directory: published + verified full rows (RLS returns them only to entitled
// callers — subscribers/owners/super admins).
export const listPublishedListings = () =>
  supabase
    .from('fiscal_agent_listings')
    .select('*')
    .eq('status', 'published')
    .eq('verification', 'verified');

// Directory teaser: the public view (never exposes contact/fee data).
export const listPublicListings = () =>
  supabase.from('fiscal_agent_listings_public').select('*');

// A single full listing by id (entitled callers only, via RLS). Mirrors the
// verified-only visibility rule: only published + verified listings resolve.
/** @param {number|string} id */
export const getListing = (id) =>
  supabase
    .from('fiscal_agent_listings')
    .select('*')
    .eq('id', Number(id))
    .eq('status', 'published')
    .eq('verification', 'verified')
    .maybeSingle();

// A single teaser listing by id, from the public view.
/** @param {number|string} id */
export const getPublicListing = (id) =>
  supabase.from('fiscal_agent_listings_public').select('*').eq('id', Number(id)).maybeSingle();

// Owner-side listing edits (accepting toggle + full editor save).
/** @param {number|string} id @param {Record<string, unknown>} updates */
export const updateListing = (id, updates) =>
  supabase.from('fiscal_agent_listings').update(updates).eq('id', Number(id));

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
 * @param {'verified' | 'declined'} verification
 */
export const setListingVerification = (id, verification) =>
  supabase
    .from('fiscal_agent_listings')
    .update({ verification, verified: verification === 'verified' })
    .eq('id', id);
