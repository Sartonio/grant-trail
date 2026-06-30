// src/lib/types.js
//
// Documentation-only JSDoc type contracts for GrantTrail's core data shapes.
// There is NO runtime code here — these `@typedef`s exist so editors and AI
// agents stop reverse-engineering the session/membership/tenant objects.
//
// Reference them from any module with:
//   /** @typedef {import('./types').Session} Session */
//
// Field names below are taken from the code that assembles/reads these objects
// (App.js, lib/billing.js, lib/policy.js, lib/guards.js). Keep them in sync
// when those shapes change.

/**
 * Role string stored on `userRecord.role`. Mirrors `ROLES` in lib/policy.js.
 * @typedef {'super_admin' | 'admin' | 'grantee'} Role
 */

/**
 * Tenant kind stored on the tenants row (`tenant_type`) and surfaced as
 * `tenantConfig.type`.
 * @typedef {'managed' | 'self_service'} TenantType
 */

/**
 * A row from the `users` table (the authenticated user's app profile).
 * Assembled in lib/billing.js `fetchSessionContext` as `data.user`.
 * @typedef {Object} UserRecord
 * @property {string} id - User UUID (also the auth user id).
 * @property {Role} role - Authorization role.
 * @property {boolean} is_active - False disables the account (forced sign-out).
 * @property {string} [tenant_id] - FK to the owning tenant.
 * @property {string} [firstname]
 * @property {string} [lastname]
 * @property {string} [organization_name]
 */

/**
 * Tenant settings flattened for the UI. Built in lib/billing.js
 * `fetchSessionContext` by spreading `tenantSettings` then overlaying the
 * tenant's `type`/`name`. Additional fields come from the tenant_settings row.
 * @typedef {Object} TenantConfig
 * @property {TenantType} [type] - From tenant.tenant_type.
 * @property {string} [name] - From tenant.name.
 * @property {string} [support_email]
 * @property {string} [support_phone]
 * @property {boolean} [require_grant_approval]
 * @property {boolean} [require_expense_approval]
 * @property {boolean} [require_budget_approval]
 */

/**
 * Membership / billing entitlement snapshot. Produced by lib/billing.js
 * `fetchMembershipStatus` (and the role-shortcut defaults in App.js
 * `loadMembershipStatus`). Read by lib/policy.js to gate routes/mutations.
 * @typedef {Object} MembershipStatus
 * @property {boolean} isExempt - Tenant/role is waived from billing.
 * @property {boolean} hasBasicAccess - Active basic membership (grantee gate).
 * @property {boolean} hasPremiumAccess - Active premium "Fiscal Agents Plan".
 * @property {Object|null} membership - Latest active `user_memberships` row, or null.
 * @property {Object|null} activeSubscription - Latest active/trialing/past_due `subscriptions` row, or null.
 */

/**
 * The app-wide session object held in App.js state and passed to guards,
 * policy functions, and route components.
 * @typedef {Object} Session
 * @property {Object} user - The Supabase auth user (from supabase.auth.getUser()).
 * @property {UserRecord} userRecord - The user's `users` table profile.
 * @property {TenantConfig} tenantConfig - Flattened tenant config.
 * @property {MembershipStatus} membership - Billing entitlement snapshot.
 */

// No runtime exports — this module is types only.
export {};
