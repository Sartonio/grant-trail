-- Membership entitlement helpers must not grant access past the paid period.
--
-- WHY: has_basic_membership(int) / has_premium_membership(int) and the
-- "tenant has an active premium member" clause of is_membership_exempt(int)
-- gated only on user_memberships.is_active. is_active is a webhook-synced
-- projection (stripe-subscription-sync.ts sets it from the Stripe status and
-- sets ends_at = current_period_end). If the lapse/deletion webhook is missed
-- or delayed, is_active stays true forever and every entitlement check keeps
-- returning a stale TRUE past the period end — observed as 5 stale-true
-- has_basic/has_premium/waiver assertions in verify:full.
--
-- FIX: also require the membership to be unexpired:
--   (ends_at IS NULL OR ends_at > now()).
-- ends_at IS NULL (seed/manual/legacy memberships) still counts as unexpired.
-- The past_due read-only grace window is unaffected: when a renewal fails,
-- Stripe has already rolled current_period_end to the end of the new (unpaid)
-- period, so ends_at is in the future for the whole grace window.
--
-- Signatures, STABLE + SECURITY DEFINER, and the zero-arg wrappers are
-- unchanged; only the expiry predicate is added.

CREATE OR REPLACE FUNCTION "public"."has_basic_membership"("p_user_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    CASE
      WHEN is_membership_exempt(p_user_id) THEN true
      ELSE EXISTS (
        SELECT 1
        FROM user_memberships
        WHERE user_id = p_user_id
          AND is_active = true
          AND (ends_at IS NULL OR ends_at > now())
          AND membership_tier IN ('basic', 'premium')
      )
    END;
$$;

CREATE OR REPLACE FUNCTION "public"."has_premium_membership"("p_user_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT
    CASE
      WHEN is_membership_exempt(p_user_id) THEN true
      ELSE EXISTS (
        SELECT 1
        FROM user_memberships
        WHERE user_id = p_user_id
          AND is_active = true
          AND (ends_at IS NULL OR ends_at > now())
          AND membership_tier = 'premium'
      )
    END;
$$;

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
        OR (
          u.role = 'admin'
          AND public.is_platform_root_tenant(t.slug, t.name)
        )
        OR ts.require_subscription = false
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
