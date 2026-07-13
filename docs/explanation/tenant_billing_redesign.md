# Tenant-owned premium billing — migration plan

Status: in progress (worktree `tenant-billing-redesign`).
Scope agreed: the **premium ("Fiscal Agents Plan") tier becomes tenant-owned**;
the **basic tier stays per-user** (slated to become free in the seeker
redesign). Two security-review findings are fixed in the same series because
they sit on the exact surfaces this redesign re-keys.

## Why

Entitlement is already tenant-scoped (`is_membership_exempt` clause 4,
`tenants.accepts_sponsorships`) but every billing object —
`billing_customers`, `subscriptions`, `user_memberships` — is keyed
`UNIQUE(user_id)` with `ON DELETE CASCADE` from `users`. Consequences:

- Offboarding the admin who happened to pay cascades the org's subscription
  away; the whole tenant silently loses its exemption.
- The billing portal / payment method / invoices live under one person.
- Two admins can double-pay; nothing dedups.

## Design

### New/changed schema (migration `tenant_owned_premium_billing`)

- `billing_customers`: `user_id` becomes nullable; new nullable
  `tenant_id -> tenants(id) ON DELETE CASCADE`; CHECK exactly one owner;
  partial unique index on `tenant_id`. Premium checkout creates/reuses the
  **tenant's** Stripe customer; basic keeps per-user customers.
- `subscriptions`: `user_id` nullable, FK changed `CASCADE -> SET NULL` (payer
  offboarding no longer destroys the org's subscription row); new nullable
  `tenant_id` FK; CHECK at least one owner; backfill `tenant_id` for premium
  rows from the payer's tenant.
- New `tenant_memberships` (mirror of `user_memberships`, keyed
  `UNIQUE(tenant_id)`, tier CHECK `'premium'` only, same
  is_active/starts_at/ends_at/source shape). Tenant-scoped RLS: service_role
  manages; members SELECT their own tenant's row; super_admin SELECT all; no
  authenticated writes. Backfilled from active premium `user_memberships`.
- `is_membership_exempt(int)` clause 4 and `has_premium_membership(int)` check
  `tenant_memberships` first, keeping the legacy premium `user_memberships`
  clause **temporarily** for deploy-order safety (webhook may still write the
  old shape until edge functions deploy). A follow-up cleanup migration drops
  the legacy clause.
- `get_session_context` surfaces the tenant membership + tenant-owned active
  subscription so the SPA shows "organization plan" state.
- New SELECT RLS on `subscriptions`/`billing_customers` for tenant admins over
  their tenant-owned rows (portal/status UX).

### Security fixes folded in (migration `freeze_role_and_subscription_waiver`)

- **Vuln 1 (role escalation, 9/10):** `enforce_user_self_update_guard`
  short-circuits for admins before the role freeze. Fix: admins may only set
  `role IN ('grantee','admin')`; only super_admin/service_role may write
  `super_admin`. Adversarial proof added.
- **Vuln 2 (billing-gate bypass, 9/10):** tenant admins can flip
  `tenant_settings.require_subscription` (the tenant-wide waiver read by
  `is_membership_exempt`). Fix: BEFORE UPDATE trigger rejects changes to that
  column unless super_admin/service_role. Adversarial proof added.
- **Vuln 3 (billing-gate bypass, found during this branch's audit):** the
  `user_memberships` "Admins can manage memberships in their tenant" policy is
  FOR ALL with WITH CHECK, letting a tenant admin mint `premium` for any
  same-tenant user; the premium clause in `is_membership_exempt` then exempts
  the whole tenant with no Stripe subscription. Fix: BEFORE INSERT/UPDATE
  trigger restricts `membership_tier='premium'` writes to service_role /
  super_admin / direct-DB (seeds). Basic/manual admin management unchanged.
  Adversarial proofs added.

### Edge functions

- `stripe-client.ts`: `getOrCreateStripeCustomerForTenant` (customer keyed by
  `billing_customers.tenant_id`, metadata `tenant_id`, name = org).
- `create-checkout-session`: premium feature keys use the tenant customer and
  stamp `tenant_id` into session/subscription metadata; basic unchanged. The
  existing already-active idempotency check now also dedups a second admin.
- `stripe-subscription-sync.ts`: resolves the billing customer's owner
  (user vs tenant). Tenant-owned premium → upsert `subscriptions.tenant_id` +
  `tenant_memberships` (onConflict tenant_id) and key the listing/
  `accepts_sponsorships` sync directly off the tenant. Legacy user-owned
  premium → old path *plus* a mirror into `tenant_memberships`.
- `create-billing-portal-session`: a tenant admin opens the portal for the
  tenant customer when one exists (any current admin manages the org plan);
  falls back to the per-user customer.
- `sync-my-subscription`: syncs both the caller's customer and their tenant's.

### Frontend

- `billing.js` / `SubscriptionPage`: surface "Organization plan — managed by
  your org" state; any admin can open the portal; resume-pay unchanged for
  basic. `policy.js` semantics (isExempt / hasPremiumAccess booleans) are
  unchanged by design.

### Hardening pass (follow-up on the same branch)

- **Offboarding fix:** the `subscriptions.user_id` CASCADE→SET NULL change made
  deleting a user with a user-owned (basic) subscription violate the
  at-least-one-owner CHECK. `trg_cleanup_user_owned_billing` (BEFORE DELETE on
  users) removes user-owned rows first — restoring old CASCADE semantics for
  exactly those rows — while tenant-owned subs still survive their initiator.
- **Checkout DB-entitlement dedup:** premium checkout now short-circuits to
  `alreadyActive` when the org's `tenant_memberships` row is active — catching
  grandfathered premium subs that live on a per-user Stripe customer the
  tenant-customer idempotency check can't see. A lapsed org plan still opens
  checkout (resubscribe).
- **Per-user waivers are grantee/basic-only.** The AdminUserList waive flow
  previously minted `premium` manual memberships for admins — the UI face of
  Vuln 3. New waivers are basic-only and offered only for grantees; existing
  manual waivers (any role) keep Remove Waiver for cleanup. Org comps are the
  super admin's `require_subscription` toggle.
- **Deterministic `activeSubscription`:** `get_session_context` prefers the
  caller's own subscription over the tenant's (org state rides
  `tenantMembership`), instead of whichever webhook updated last.

### Rollout

1. Land migrations (backfill included) — old edge functions keep working
   (legacy clause).
2. Deploy edge functions — new premium checkouts become tenant-owned; existing
   premium subs keep syncing via the legacy mirror.
3. (Later, separate change) cleanup migration: drop legacy premium
   `user_memberships` clause + one-off script to migrate live Stripe premium
   subscriptions onto tenant customers (Stripe objects cannot be reparented;
   requires cancel/re-create or leaving grandfathered subs on the mirror path).

### Test matrix (rewritten alongside each part)

- SQL adversarial (`supabase/tests/rls-adversarial.test.sh`): role-escalation
  proof, require_subscription freeze proof, `tenant_memberships` RLS
  (cross-tenant read denied, member read allowed, authenticated write denied).
- Edge (`supabase/functions/tests/*.sh`): tenant-owned premium webhook
  lifecycle (active→past_due→canceled flips membership + accepts_sponsorships
  + listing), checkout customer reuse across two admins of one tenant, portal
  access for a non-payer admin.
- Unit (Vitest): `billing.test.js`, `policy.test.js` for the org-plan state.
- `npm run verify` + `npm run verify:full` gate the branch.
