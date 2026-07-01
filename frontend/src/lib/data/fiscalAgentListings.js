// Data-access for the fiscal_agent_listings moderation surface. Super admins
// read pending listings and set verification. The moderation-guard trigger +
// RLS only let super_admin / service_role change the verification column, so
// this is the platform's approval path for new listings.
import { supabase } from '../../supabaseClient';

// Listings awaiting platform verification, oldest first. Super admins see all
// rows via the is_super_admin() SELECT policy on fiscal_agent_listings.
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
