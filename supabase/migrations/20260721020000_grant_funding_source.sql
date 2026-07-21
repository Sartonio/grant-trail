-- ==========================================
-- Grant funding source column
-- ==========================================
-- WHAT: Adds a nullable funding_source varchar(200) column to
-- public.grant_record — the funder / grant program a grant application was
-- submitted to or received from (e.g. the foundation, agency, or program name).
--
-- WHY: Organizations need to track which funding source each grant came from so
-- they can see, per funder, what they've applied for and been awarded. This
-- column feeds the grant-activity dashboard, which groups grant activity by
-- funding source.
--
-- SECURITY: Nullable data column only — no RLS, policy, trigger, or constraint
-- change. grant_record already has tenant-scoped row-level security; those
-- existing policies govern read/write access to this new column exactly as they
-- do every other grant_record column. Nothing here widens access.
-- ==========================================

ALTER TABLE public.grant_record ADD COLUMN funding_source varchar(200);
