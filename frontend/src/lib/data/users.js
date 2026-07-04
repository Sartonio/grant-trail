// Data-access for the users / user_memberships tables (modularity.md, Phase 2
// remainder). Thin wrappers around the exact queries previously inlined in
// AdminUserList.js — each returns Supabase's native { data, error } so call
// sites keep their own error handling unchanged.
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').UserTableUpdate} UserTableUpdate */
/** @typedef {import('../types').InviteInsert} InviteInsert */

// The signed-in user's profile row, looked up by their auth user id at login.
/** @param {string} authUserId */
export const getUserByAuthId = (authUserId) =>
  supabase.from('users').select('*').eq('user_id', authUserId).single();

// Names/roles keyed by auth user id, for the audit-log "changed by" filter.
export const listAuditUsers = () =>
  supabase.from('users').select('user_id, firstname, lastname, role');

export const listTenantUsers = () =>
  supabase
    .from('users')
    .select('id, firstname, lastname, email, organization_name, phone_number, role, user_id, is_active, created_at')
    .order('created_at', { ascending: false });

export const listActiveMemberships = () =>
  supabase.from('user_memberships').select('*').eq('is_active', true);

/**
 * @param {number} id
 * @param {UserTableUpdate} updates
 */
export const updateUser = (id, updates) => supabase.from('users').update(updates).eq('id', id);

/** @param {number} userId */
export const waiveUserSubscription = (userId, membershipTier) =>
  supabase
    .from('user_memberships')
    .upsert({
      user_id: userId,
      membership_tier: membershipTier,
      is_active: true,
      source: 'manual',
    }, { onConflict: 'user_id' })
    .select()
    .single();

/** @param {number} userId */
export const removeUserMembership = (userId) =>
  supabase.from('user_memberships').delete().eq('user_id', userId);

/** @param {InviteInsert} invite */
export const createUserInvite = (invite) =>
  supabase.from('invites').insert(invite).select().single();
