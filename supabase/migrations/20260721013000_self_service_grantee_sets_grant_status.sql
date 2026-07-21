-- ==========================================
-- Self-service grantees set their own grant status
-- ==========================================
-- WHAT: Redefines public.auto_approve_grant() (the BEFORE INSERT trigger fn on
-- grant_record, fired by trg_zz_auto_approve_grant) so that self-service tenants
-- no longer force-approve every new grant.
--
-- WHY: Self-service tenants are provisioned with tenant_settings.require_grant_
-- approval = false. The old body treated "approval not required" as "auto-
-- approve", so every self-service grant landed 'approved' regardless of the
-- status the grantee submitted. Product intent for self-service is that the
-- grantee owns their grant's lifecycle (pending/approved/declined) — approval is
-- a self-managed workflow, not a force-approve. Managed tenants are unchanged:
-- require_grant_approval still governs whether staff review is required.
--
-- SECURITY: No schema/RLS/constraint change. This only relaxes an auto-approve
-- default for one tenant_type on INSERT; the status check constraint
-- (pending|approved|needs_changes|declined) and all tenant-isolation RLS remain
-- the sole authority over who may write which grant. tenant_type is read from
-- the trusted, denormalized NEW.tenant_id (set by set_grant_tenant_id), not from
-- any client-supplied value. CREATE OR REPLACE preserves the function's owner
-- (postgres), SECURITY DEFINER, search_path, and existing GRANTs.
--
-- SCOPE: Only auto_approve_grant. auto_approve_budget_item / auto_approve_expense
-- are intentionally left untouched — self-service budget/expense auto-approval is
-- unchanged and correct.
-- ==========================================

CREATE OR REPLACE FUNCTION "public"."auto_approve_grant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    -- Self-service tenants: the grantee controls the grant lifecycle. Honor the
    -- submitted NEW.status (defaults to 'pending' via the column default when the
    -- client leaves it unset). Do NOT force-approve.
    IF (SELECT tenant_type FROM tenants WHERE id = NEW.tenant_id) = 'self_service' THEN
      RETURN NEW;
    END IF;

    -- Managed tenants (unchanged): if the tenant does not require staff approval,
    -- auto-approve the new grant.
    IF NOT (SELECT require_grant_approval FROM tenant_settings WHERE tenant_id = NEW.tenant_id) THEN
      NEW.status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
