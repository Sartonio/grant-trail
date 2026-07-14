-- ============================================================================
-- Platform-root membership exemption applies to the WHOLE tenant, not just admins
--
-- Bug: invited grantees of the platform-root tenant were wrongly paywalled.
--   Product intent (see the header of frontend/src/components/auth/Join.js):
--   invite links skip payment — an invited user is covered by the inviting
--   org, not billed personally. But register_invited_user provisions no
--   membership row, so coverage rests entirely on is_membership_exempt().
--
--   The latest definition (20260713020000_tenant_owned_premium_billing.sql)
--   exempts platform-root users only when u.role = 'admin' (clause 2). A
--   grantee invited into the platform-root tenant therefore fell through:
--     * clause 2 is admin-only,
--     * and because platform-root ADMINS are role-exempt, the platform-root
--       tenant never buys a premium plan, so the tenant_memberships clause
--       (clause 4) never fires for it either.
--   Result: the invited grantee is redirected to /subscription by frontend
--   policy AND blocked by RLS (every grantee write policy gates on
--   has_basic_membership() -> is_membership_exempt()).
--
-- Fix: drop the `u.role = 'admin'` condition from clause 2 so ANY user of the
--   platform-root tenant is exempt. Nothing else changes.
--
-- Safety: self-serve grantees each provision their OWN fresh tenant
--   (provision_self_service_tenant creates a new tenant per signup), so every
--   user who ends up in the platform-root tenant got there via invite — i.e.
--   they are exactly the users the product intends to cover for free.
--   Widening the platform-root exemption tenant-wide therefore cannot exempt
--   anyone who is supposed to pay: paying users live in their own tenants,
--   which are gated by require_subscription / tenant_memberships as before.
--
-- Body is copied byte-for-byte from the 20260713020000 definition (the truly
--   latest one — 20260713040000 references but does not redefine this fn),
--   with only the clause-2 role condition removed. LANGUAGE sql / STABLE /
--   SECURITY DEFINER and OWNER are preserved; grants from the squashed baseline
--   survive CREATE OR REPLACE unchanged. No new tables, so no new RLS.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."is_membership_exempt"("p_user_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    JOIN tenant_settings ts ON ts.tenant_id = u.tenant_id
    WHERE u.id = p_user_id
      AND (
        u.role = 'super_admin'
        -- Platform-root tenant is billing-exempt for ALL its users. Every user
        -- of the platform-root tenant arrived via invite (self-serve signups
        -- provision their own tenant), so this covers invited grantees the org
        -- is paying for and cannot exempt any user who should pay themselves.
        OR public.is_platform_root_tenant(t.slug, t.name)
        OR ts.require_subscription = false
        -- Tenant-owned premium entitlement (new canonical source).
        OR EXISTS (
          SELECT 1
          FROM tenant_memberships tm
          WHERE tm.tenant_id = u.tenant_id
            AND tm.is_active = true
            AND (tm.ends_at IS NULL OR tm.ends_at > now())
            AND tm.membership_tier = 'premium'
        )
        -- Legacy clause: any tenant user holding an active premium
        -- user_memberships row. Kept verbatim for deploy-order safety (the
        -- Stripe webhook may still write the old per-user shape until the edge
        -- functions deploy). Dropped in a follow-up cleanup migration.
        OR EXISTS (
          SELECT 1
          FROM users tenant_users
          JOIN user_memberships um ON um.user_id = tenant_users.id
          WHERE tenant_users.tenant_id = u.tenant_id
            AND um.is_active = true
            AND (um.ends_at IS NULL OR um.ends_at > now())
            AND um.membership_tier = 'premium'
        )
      )
  );
$$;

ALTER FUNCTION "public"."is_membership_exempt"("p_user_id" integer) OWNER TO "postgres";
