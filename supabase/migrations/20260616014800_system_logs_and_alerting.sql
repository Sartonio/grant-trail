-- ==========================================
-- Observability (Logging & Monitoring)
-- Migration: Create system_logs & webhook alerting
-- ==========================================

-- Create system_logs table
CREATE TABLE public.system_logs (
  id SERIAL PRIMARY KEY,
  event_name VARCHAR(100) NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  severity VARCHAR(20) NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS) on system_logs
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

-- Allow super_admins to SELECT logs (service_role automatically bypasses RLS to write/read logs)
CREATE POLICY "Super admins can view system logs"
ON public.system_logs FOR SELECT USING (is_super_admin());

-- Add alert_webhook_url column to platform_settings
ALTER TABLE public.platform_settings ADD COLUMN alert_webhook_url TEXT;

-- Create alerting function that invokes Supabase pg_net http_post
CREATE OR REPLACE FUNCTION public.handle_critical_log_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_webhook_url TEXT;
  v_payload JSONB;
BEGIN
  -- Retrieve alerting webhook URL from platform_settings
  SELECT alert_webhook_url INTO v_webhook_url FROM public.platform_settings WHERE id = 1;
  
  -- If webhook URL is set and severity is critical, send http request
  IF NEW.severity = 'critical' AND v_webhook_url IS NOT NULL AND v_webhook_url <> '' THEN
    v_payload := json_build_object(
      'text', format('🚨 *Critical System Error Alert* 🚨' || chr(10) ||
                     '*Event:* %s' || chr(10) ||
                     '*Error:* %s' || chr(10) ||
                     '*Stack:* %s' || chr(10) ||
                     '*Time:* %s', 
                     NEW.event_name, NEW.error_message, COALESCE(NEW.error_stack, 'N/A'), NEW.created_at)
    );
    
    -- Using pg_net extension to fire webhook
    BEGIN
      PERFORM net.http_post(
        url := v_webhook_url,
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := v_payload
      );
    EXCEPTION WHEN OTHERS THEN
      -- Prevent trigger loop or transaction failure if pg_net fails/not installed
      RAISE WARNING 'Failed to send alert webhook: %', SQLERRM;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- Create trigger to invoke webhook after log insertion
CREATE TRIGGER trg_critical_log_alert
AFTER INSERT ON public.system_logs
FOR EACH ROW
EXECUTE FUNCTION public.handle_critical_log_alert();
