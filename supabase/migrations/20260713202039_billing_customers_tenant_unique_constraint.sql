-- ============================================================================
-- billing_customers: replace partial unique index on tenant_id with a real
-- UNIQUE constraint so ON CONFLICT (tenant_id) works.
--
-- INTENT / WHY:
-- 20260713020000_tenant_owned_premium_billing.sql created
--   CREATE UNIQUE INDEX idx_billing_customers_tenant_id
--     ON public.billing_customers (tenant_id) WHERE tenant_id IS NOT NULL;
-- Postgres cannot use a PARTIAL unique index as the arbiter for
-- ON CONFLICT (tenant_id), so getOrCreateStripeCustomerForTenant
-- (supabase/functions/_shared/stripe-client.ts, PostgREST upsert with
-- onConflict: 'tenant_id') and the billing test helpers fail at plan time
-- with "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification".
--
-- FIX: drop the partial index and add a plain UNIQUE (tenant_id) constraint.
-- Plain UNIQUE constraints treat NULLs as distinct, so the many existing
-- user-owned rows (tenant_id IS NULL) are unaffected; uniqueness is still
-- enforced for every non-NULL tenant_id, exactly as before. The constraint's
-- backing index also continues to serve tenant_id lookups.
--
-- SECURITY: no RLS changes -- table, policies, and grants are untouched.
-- ============================================================================

-- Add the real constraint first (its backing index takes over lookups), then
-- drop the partial index it replaces.
ALTER TABLE "public"."billing_customers"
  ADD CONSTRAINT "billing_customers_tenant_id_key" UNIQUE ("tenant_id");

DROP INDEX IF EXISTS "public"."idx_billing_customers_tenant_id";
