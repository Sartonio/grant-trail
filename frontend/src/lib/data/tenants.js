// Data-access for the tenants / tenant_settings / platform_settings tables
// (modularity.md, Phase 2 remainder). Thin wrappers around the exact queries
// previously inlined in TenantManagement.js — each returns Supabase's native
// { data, error } so call sites keep their own error handling unchanged.
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').TenantInsert} TenantInsert */
/** @typedef {import('../types').TenantUpdate} TenantUpdate */
/** @typedef {import('../types').TenantSettingsInsert} TenantSettingsInsert */
/** @typedef {import('../types').TenantSettingsUpdate} TenantSettingsUpdate */
/** @typedef {import('../types').PlatformSettingsUpdate} PlatformSettingsUpdate */
/** @typedef {import('../types').InviteInsert} InviteInsert */

export const listTenants = () =>
  supabase.from('tenants').select('*').order('created_at', { ascending: false });

// Tenant IDs of every user, used to compute per-tenant user counts.
export const listAllUserTenantIds = () => supabase.from('users').select('tenant_id');

export const listAllTenantSettings = () => supabase.from('tenant_settings').select('*');

/** @param {TenantInsert} tenant */
export const createTenant = (tenant) =>
  supabase.from('tenants').insert(tenant).select().single();

/** @param {TenantSettingsInsert} settings */
export const createTenantSettings = (settings) =>
  supabase.from('tenant_settings').insert(settings);

/** @param {InviteInsert} invite */
export const createTenantAdminInvite = (invite) =>
  supabase.from('invites').insert(invite).select().single();

export const getPlatformSettings = () => supabase.from('platform_settings').select('*').single();

/** @param {PlatformSettingsUpdate} updates */
export const updatePlatformSettings = (updates) =>
  supabase.from('platform_settings').update(updates).eq('id', 1);

/**
 * @param {number} id
 * @param {boolean} isActive
 */
export const setTenantActive = (id, isActive) =>
  supabase.from('tenants').update({ is_active: isActive }).eq('id', id);

/** @param {number} tenantId @param {TenantSettingsUpdate} updates */
export const updateTenantSettings = (tenantId, updates) =>
  supabase.from('tenant_settings').update(updates).eq('tenant_id', tenantId);

/**
 * @param {number} tenantId
 * @param {boolean} requireSubscription
 */
export const setTenantRequireSubscription = (tenantId, requireSubscription) =>
  supabase.from('tenant_settings').update({ require_subscription: requireSubscription }).eq('tenant_id', tenantId);

/** @param {number} tenantId */
export const listTenantUserIds = (tenantId) =>
  supabase.from('users').select('id').eq('tenant_id', tenantId);

// Clean up manual subscription waivers for a set of users, e.g. when a
// self-service tenant switches back to "Required".
/** @param {number[]} userIds */
export const deleteManualMembershipsForUsers = (userIds) =>
  supabase.from('user_memberships').delete().eq('source', 'manual').in('user_id', userIds);
