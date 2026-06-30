// Data-access for the grant_record table. Thin wrappers around the exact
// queries previously inlined in components (modularity.md, Phase 2). Each
// read returns Supabase's native { data, error } so call sites keep their own
// error handling unchanged.
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').GrantUpdate} GrantUpdate */

/** @param {number} id */
export const getGrant = (id) => supabase.from('grant_record').select('*').eq('id', id).single();

/**
 * @param {number} id
 * @param {GrantUpdate} updates
 */
export const updateGrant = (id, updates) =>
  supabase.from('grant_record').update(updates).eq('id', id);
