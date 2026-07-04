// Data-access for the grant_record table. Thin wrappers around the exact
// queries previously inlined in components (modularity.md, Phase 2). Each
// read returns Supabase's native { data, error } so call sites keep their own
// error handling unchanged.
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').GrantUpdate} GrantUpdate */
/** @typedef {import('../types').GrantInsert} GrantInsert */

/** @param {number} id */
export const getGrant = (id) => supabase.from('grant_record').select('*').eq('id', id).single();

/** @param {number} id @param {string} userId */
export const getOwnGrant = (id, userId) =>
  supabase.from('grant_record').select('*').eq('id', id).eq('user_id', userId).single();

/** @param {string} userId */
export const listGrantsForUser = (userId) =>
  supabase.from('grant_record').select('*').eq('user_id', userId);

// Narrow projection for the grantee dashboard stat cards.
/** @param {string} userId */
export const listGrantStatsForUser = (userId) =>
  supabase
    .from('grant_record')
    .select('id, status, grant_amount, disbursed_funds, total_spent')
    .eq('user_id', userId);

/** @param {string} userId @param {number} limit */
export const listRecentGrantsForUser = (userId, limit = 5) =>
  supabase
    .from('grant_record')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

// Admin dashboard: every grant with its owner name, for stats + review queue.
export const listGrantsForDashboard = () =>
  supabase
    .from('grant_record')
    .select('id, grant_name, grant_amount, total_spent, status, created_at, user_id, users(firstname, lastname, organization_name)');

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<GrantInsert, 'tenant_id'>} grant */
export const insertGrant = (grant) =>
  supabase.from('grant_record').insert([grant]).select();

// Admin grant list: narrow projection + owner name, newest first.
export const listAllGrantsForAdmin = () =>
  supabase
    .from('grant_record')
    .select(
      'id, grant_name, grant_amount, status, created_at, end_spend_period, user_id, users(firstname, lastname, organization_name)'
    )
    .order('created_at', { ascending: false });

/**
 * @param {number} id
 * @param {GrantUpdate} updates
 */
export const updateGrant = (id, updates) =>
  supabase.from('grant_record').update(updates).eq('id', id);

// Update a grant scoped to its owner (grantee self-service edit path).
/**
 * @param {number} id
 * @param {string} userId
 * @param {GrantUpdate} updates
 */
export const updateOwnGrant = (id, userId, updates) =>
  supabase.from('grant_record').update(updates).eq('id', id).eq('user_id', userId);
