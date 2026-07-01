-- Replace the phantom "fiscal_agent" billing tier with ONE tenant-level
-- entitlement flag: tenants.accepts_sponsorships.
--
-- Before: charity listing ownership was gated on the premium ("Fiscal Agents
-- Plan") user membership plus a client-side pseudo-tier string 'fiscal_agent'
-- that the DB never modeled. Now the entitlement is a boolean on the tenant,
-- kept accurate by the Stripe subscription sync (set on active/trialing,
-- cleared on past_due/canceled/unpaid).
--
-- RLS: no new policies needed for the column.
--   - Reads: covered by the existing tenants SELECT policies (own tenant /
--     super_admin) and get_session_context (SECURITY DEFINER).
--   - Writes: the only write policy on tenants is super_admin-only; the billing
--     sync writes as service_role. Tenant admins cannot self-grant the flag.

ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "accepts_sponsorships" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."tenants"."accepts_sponsorships" IS
  'Charity Directory entitlement: tenant may own/publish a fiscal-agent listing. Set by the Stripe subscription sync when a premium ("Fiscal Agents Plan") subscription is active; cleared on lapse.';

-- Backfill: tenants currently on the fiscal-agent tier — i.e. tenants with a
-- live premium user membership — get the flag set.
UPDATE "public"."tenants" t
SET "accepts_sponsorships" = true
WHERE EXISTS (
  SELECT 1
  FROM "public"."users" u
  JOIN "public"."user_memberships" m ON m.user_id = u.id
  WHERE u.tenant_id = t.id
    AND m.membership_tier = 'premium'
    AND m.is_active
);
