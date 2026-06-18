-- ==========================================
-- Allow Edge Functions to write to system_logs
-- ==========================================
-- Closes issue #4: the Edge Functions log operational failures by inserting a
-- row into public.system_logs (severity = 'critical' also fires the alert
-- webhook via trg_critical_log_alert). Those functions use the service_role
-- key, but system_logs only ever granted REFERENCES/TRIGGER/TRUNCATE/MAINTAIN
-- to service_role -- never INSERT. Every other table grants ALL to service_role.
--
-- As a result the existing stripe-webhook log write (and any new ones) failed
-- silently with "permission denied for table system_logs", so failures were
-- never persisted and critical alerts never fired. Granting INSERT to
-- service_role makes the failure-logging path actually work.
--
-- SELECT stays restricted to super admins via the existing RLS policy; this
-- only adds the write privilege the backend needs. The id sequence already
-- grants UPDATE to service_role, so nextval() during INSERT is covered.

GRANT INSERT ON TABLE "public"."system_logs" TO "service_role";
