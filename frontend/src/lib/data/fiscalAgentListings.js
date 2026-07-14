// Data-access for the fiscal_agent_listings moderation surface. Super admins
// read pending listings and set verification. The moderation-guard trigger +
// RLS only let super_admin / service_role change the verification column, so
// this is the platform's approval path for new listings.
import { createEntityData } from './_factory';

const listings = createEntityData('fiscal_agent_listings');
const publicListings = createEntityData('fiscal_agent_listings_public');

// Listings awaiting platform verification, oldest first. Super admins see all
// rows via the is_super_admin() SELECT policy on fiscal_agent_listings.
// The tenant's listing (listings are tenant-owned; any admin of the tenant
// manages it). Most recent row wins if a tenant somehow has several.
/**
 * @param {number} tenantId
 */
export const getTenantListing = (tenantId) =>
  listings
    .listBy('tenant_id', Number(tenantId), { order: ['updated_at', { ascending: false }] })
    .limit(1);

// Directory: published + verified full rows (RLS returns them only to entitled
// callers — subscribers/owners/super admins).
export const listPublishedListings = () =>
  listings.listBy('status', 'published').eq('verification', 'verified');

// Directory teaser: the public view (never exposes contact/fee data).
export const listPublicListings = () => publicListings.listAll();

// A single full listing by id (entitled callers only, via RLS). Mirrors the
// verified-only visibility rule: only published + verified listings resolve.
/** @param {number|string} id */
export const getListing = (id) =>
  listings
    .listBy('id', Number(id))
    .eq('status', 'published')
    .eq('verification', 'verified')
    .maybeSingle();

// A single teaser listing by id, from the public view.
/** @param {number|string} id */
export const getPublicListing = (id) =>
  publicListings.listBy('id', Number(id)).maybeSingle();

// Owner-side listing edits (accepting toggle + full editor save).
/** @param {number|string} id @param {Record<string, unknown>} updates */
export const updateListing = (id, updates) => listings.updateBy('id', Number(id), updates);

export const listPendingListings = () =>
  listings.listBy('verification', 'pending', { order: ['created_at', { ascending: true }] });

// Set a listing's verification. Keep the legacy `verified` boolean in sync with
// the `verification` string (both are read across the fiscal-agent surfaces).
// Throws on a supabase error, and on a ZERO-ROW update — that means RLS
// silently dropped it (same guard as the set*Status paths in _factory).
/**
 * @param {number} id
 * @param {'verified' | 'declined'} verification
 * @returns {Promise<any[]>}
 */
export async function setListingVerification(id, verification) {
  const { data, error } = await listings
    .updateBy('id', id, { verification, verified: verification === 'verified' })
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Update was not applied — check RLS policies for fiscal_agent_listings.');
  }
  return data;
}
