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
 * @property {boolean} [accepts_sponsorships] - Charity Directory entitlement
 *   (from tenants.accepts_sponsorships; synced from the premium subscription).
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

/**
 * Generated DB-table row/insert/update aliases. These re-export the machine-
 * generated contract in `database.types.ts` under short names so the
 * `lib/data/*` modules can annotate queries against the real schema. Regenerate
 * the source with `npm run db:types` after any migration.
 * @typedef {import('./database.types').Database['public']['Tables']['grant_record']['Row']} GrantRow
 * @typedef {import('./database.types').Database['public']['Tables']['grant_record']['Update']} GrantUpdate
 * @typedef {import('./database.types').Database['public']['Tables']['expenses']['Row']} ExpenseRow
 * @typedef {import('./database.types').Database['public']['Tables']['budget_items']['Row']} BudgetItemRow
 * @typedef {import('./database.types').Database['public']['Tables']['tenants']['Row']} TenantRow
 * @typedef {import('./database.types').Database['public']['Tables']['tenants']['Insert']} TenantInsert
 * @typedef {import('./database.types').Database['public']['Tables']['tenants']['Update']} TenantUpdate
 * @typedef {import('./database.types').Database['public']['Tables']['tenant_settings']['Row']} TenantSettingsRow
 * @typedef {import('./database.types').Database['public']['Tables']['tenant_settings']['Insert']} TenantSettingsInsert
 * @typedef {import('./database.types').Database['public']['Tables']['tenant_settings']['Update']} TenantSettingsUpdate
 * @typedef {import('./database.types').Database['public']['Tables']['platform_settings']['Update']} PlatformSettingsUpdate
 * @typedef {import('./database.types').Database['public']['Tables']['users']['Row']} UserTableRow
 * @typedef {import('./database.types').Database['public']['Tables']['users']['Update']} UserTableUpdate
 * @typedef {import('./database.types').Database['public']['Tables']['user_memberships']['Row']} UserMembershipRow
 * @typedef {import('./database.types').Database['public']['Tables']['invites']['Insert']} InviteInsert
 */

// No runtime exports — this module is types only.
export {};
