// Data-access for the tenants / tenant_settings / platform_settings tables
// (modularity.md, Phase 2 remainder). Thin wrappers around the exact queries
// previously inlined in TenantManagement.js — each returns Supabase's native
// { data, error } so call sites keep their own error handling unchanged.
import { createEntityData } from './_factory';
/** @typedef {import('../types').TenantInsert} TenantInsert */
/** @typedef {import('../types').TenantUpdate} TenantUpdate */
/** @typedef {import('../types').TenantSettingsInsert} TenantSettingsInsert */
/** @typedef {import('../types').TenantSettingsUpdate} TenantSettingsUpdate */
/** @typedef {import('../types').PlatformSettingsUpdate} PlatformSettingsUpdate */
/** @typedef {import('../types').InviteInsert} InviteInsert */

const tenants = createEntityData('tenants');
const tenantSettings = createEntityData('tenant_settings');
const platformSettings = createEntityData('platform_settings');
const invites = createEntityData('invites');
const users = createEntityData('users');
const userMemberships = createEntityData('user_memberships');

export const listTenants = () =>
  tenants.listAll({ order: ['created_at', { ascending: false }] });

// Tenant IDs of every user, used to compute per-tenant user counts.
export const listAllUserTenantIds = () => users.listAll({ select: 'tenant_id' });

export const listAllTenantSettings = () => tenantSettings.listAll();

/** @param {TenantInsert} tenant */
export const createTenant = (tenant) => tenants.insert(tenant).select().single();

/** @param {TenantSettingsInsert} settings */
export const createTenantSettings = (settings) => tenantSettings.insert(settings);

/** @param {InviteInsert} invite */
export const createTenantAdminInvite = (invite) => invites.insert(invite).select().single();

export const getPlatformSettings = () => platformSettings.listAll().single();

/** @param {PlatformSettingsUpdate} updates */
export const updatePlatformSettings = (updates) => platformSettings.updateBy('id', 1, updates);

/**
 * @param {number} id
 * @param {boolean} isActive
 */
export const setTenantActive = (id, isActive) =>
  tenants.updateBy('id', id, { is_active: isActive });

/** @param {number} tenantId @param {TenantSettingsUpdate} updates */
export const updateTenantSettings = (tenantId, updates) =>
  tenantSettings.updateBy('tenant_id', tenantId, updates);

/**
 * @param {number} tenantId
 * @param {boolean} requireSubscription
 */
export const setTenantRequireSubscription = (tenantId, requireSubscription) =>
  tenantSettings.updateBy('tenant_id', tenantId, { require_subscription: requireSubscription });

/** @param {number} tenantId */
export const listTenantUserIds = (tenantId) =>
  users.listBy('tenant_id', tenantId, { select: 'id' });

// Clean up manual subscription waivers for a set of users, e.g. when a
// self-service tenant switches back to "Required".
/** @param {number[]} userIds */
export const deleteManualMembershipsForUsers = (userIds) =>
  userMemberships.deleteBy('source', 'manual').in('user_id', userIds);
