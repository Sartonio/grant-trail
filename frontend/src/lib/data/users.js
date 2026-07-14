// Data-access for the users / user_memberships tables (modularity.md, Phase 2
// remainder). Thin wrappers around the exact queries previously inlined in
// AdminUserList.js — each returns Supabase's native { data, error } so call
// sites keep their own error handling unchanged.
import { createEntityData } from './_factory';
/** @typedef {import('../types').UserTableUpdate} UserTableUpdate */
/** @typedef {import('../types').InviteInsert} InviteInsert */

const users = createEntityData('users');
const userMemberships = createEntityData('user_memberships');
const invites = createEntityData('invites');

// The signed-in user's profile row, looked up by their auth user id at login.
/** @param {string} authUserId */
export const getUserByAuthId = (authUserId) => users.getBy('user_id', authUserId);

// Names/roles keyed by auth user id, for the audit-log "changed by" filter.
export const listAuditUsers = () =>
  users.listAll({ select: 'user_id, firstname, lastname, role' });

export const listTenantUsers = () =>
  users.listAll({
    select:
      'id, firstname, lastname, email, organization_name, phone_number, role, user_id, is_active, created_at',
    order: ['created_at', { ascending: false }],
  });

export const listActiveMemberships = () => userMemberships.listBy('is_active', true);

/**
 * @param {number} id
 * @param {UserTableUpdate} updates
 */
export const updateUser = (id, updates) => users.updateBy('id', id, updates);

/** @param {number} userId @param {string} membershipTier */
export const waiveUserSubscription = (userId, membershipTier) =>
  userMemberships
    .from()
    .upsert(
      {
        user_id: userId,
        membership_tier: membershipTier,
        is_active: true,
        source: 'manual',
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

/** @param {number} userId */
export const removeUserMembership = (userId) => userMemberships.deleteBy('user_id', userId);

/** @param {InviteInsert} invite */
export const createUserInvite = (invite) => invites.insert(invite).select().single();
