


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."auto_approve_budget_item"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT (SELECT require_budget_approval FROM tenant_settings WHERE tenant_id = NEW.tenant_id) THEN
      NEW.status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_approve_budget_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_approve_expense"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT (SELECT require_expense_approval FROM tenant_settings WHERE tenant_id = NEW.tenant_id) THEN
      NEW.status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_approve_expense"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_approve_grant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT (SELECT require_grant_approval FROM tenant_settings WHERE tenant_id = NEW.tenant_id) THEN
      NEW.status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."auto_approve_grant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_grant_budget_totals"("g_id" integer) RETURNS TABLE("total_budget_items" integer, "total_budget_allocated" numeric, "total_spent" numeric, "total_remaining" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INT,
    COALESCE(SUM(budget_allocated), 0),
    COALESCE(SUM(amount_spent), 0),
    COALESCE(SUM(budget_allocated - amount_spent), 0)
  FROM budget_items
  WHERE grant_id = g_id;
END;
$$;


ALTER FUNCTION "public"."calculate_grant_budget_totals"("g_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_tenant_id"() RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT tenant_id FROM users WHERE user_id = auth.uid();
$$;


ALTER FUNCTION "public"."current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_membership_eligibility"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  target_role TEXT;
  target_tenant_name TEXT;
  target_tenant_slug TEXT;
BEGIN
  SELECT u.role, t.name, t.slug
  INTO target_role, target_tenant_name, target_tenant_slug
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.id = NEW.user_id;

  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Cannot assign membership: user % does not exist', NEW.user_id;
  END IF;

  IF target_role = 'super_admin' THEN
    RAISE EXCEPTION 'Cannot assign membership to super_admin users';
  END IF;

  IF target_role = 'admin'
     AND (
       lower(COALESCE(target_tenant_slug, '')) IN ('tfac', 'the-family-advocates-canada')
       OR lower(COALESCE(target_tenant_name, '')) = 'the family advocates canada'
     ) THEN
    RAISE EXCEPTION 'Cannot assign membership to TFAC admin users';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_membership_eligibility"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_self_service_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF (SELECT tenant_type FROM tenants WHERE id = NEW.tenant_id) = 'self_service' THEN
      RAISE EXCEPTION 'Self-service tenants cannot have admin users';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_self_service_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_subscription_tier_product_match"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  basic_product_id TEXT;
  premium_product_id TEXT;
BEGIN
  SELECT basic_membership_product_id, premium_membership_product_id
  INTO basic_product_id, premium_product_id
  FROM platform_settings
  WHERE id = 1;

  IF basic_product_id IS NULL OR premium_product_id IS NULL THEN
    RAISE EXCEPTION 'Platform membership product IDs are not configured';
  END IF;

  IF NEW.membership_tier = 'basic' AND NEW.stripe_product_id <> basic_product_id THEN
    RAISE EXCEPTION 'Basic subscription must use product ID %', basic_product_id;
  END IF;

  IF NEW.membership_tier = 'premium' AND NEW.stripe_product_id <> premium_product_id THEN
    RAISE EXCEPTION 'Premium subscription must use product ID %', premium_product_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_subscription_tier_product_match"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_user_ids"() RETURNS SETOF integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT id FROM users WHERE role = 'admin' AND is_active = true;
$$;


ALTER FUNCTION "public"."get_admin_user_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_grant_name"("g_id" integer) RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT COALESCE(grant_name, 'Grant #' || id::text) FROM grant_record WHERE id = g_id;
$$;


ALTER FUNCTION "public"."get_grant_name"("g_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_grant_owner"("g_id" integer) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT user_id FROM grant_record WHERE id = g_id;
$$;


ALTER FUNCTION "public"."get_grant_owner"("g_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_critical_log_alert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."handle_critical_log_alert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_basic_membership"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT has_basic_membership(u.id)
  FROM users u
  WHERE u.user_id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."has_basic_membership"() OWNER TO "postgres";


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
          AND membership_tier IN ('basic', 'premium')
      )
    END;
$$;


ALTER FUNCTION "public"."has_basic_membership"("p_user_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_feature_access"("p_feature_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.feature_entitlements fe
    JOIN public.users u ON u.id = fe.grantee_id
    WHERE u.user_id = auth.uid()
      AND fe.feature_key = p_feature_key
      AND fe.enabled = true
  );
$$;


ALTER FUNCTION "public"."has_feature_access"("p_feature_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_premium_membership"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT has_premium_membership(u.id)
  FROM users u
  WHERE u.user_id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."has_premium_membership"() OWNER TO "postgres";


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
          AND membership_tier = 'premium'
      )
    END;
$$;


ALTER FUNCTION "public"."has_premium_membership"("p_user_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = auth.uid()
      AND role = 'admin'
      AND is_active = true
      AND tenant_id = current_tenant_id()
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_membership_exempt"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT is_membership_exempt(u.id)
  FROM users u
  WHERE u.user_id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."is_membership_exempt"() OWNER TO "postgres";


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
          AND (
            lower(COALESCE(t.slug, '')) IN ('tfac', 'the-family-advocates-canada')
            OR lower(COALESCE(t.name, '')) = 'the family advocates canada'
          )
        )
        OR ts.require_subscription = false
      )
  );
$$;


ALTER FUNCTION "public"."is_membership_exempt"("p_user_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
      AND is_active = true
  );
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_budget_items_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
BEGIN
  -- Skip no-op UPDATEs caused by the totals trigger cascade (pending expense inserts)
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NULL;
  END IF;
  IF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values, new_values)
    VALUES ('budget_items', OLD.id, 'UPDATE', auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, new_values)
    VALUES ('budget_items', NEW.id, 'INSERT', auth.uid(), to_jsonb(NEW));
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values)
    VALUES ('budget_items', OLD.id, 'DELETE', auth.uid(), to_jsonb(OLD));
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_budget_items_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_expenses_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values, new_values)
    VALUES ('expenses', OLD.id, 'UPDATE', auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, new_values)
    VALUES ('expenses', NEW.id, 'INSERT', auth.uid(), to_jsonb(NEW));
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values)
    VALUES ('expenses', OLD.id, 'DELETE', auth.uid(), to_jsonb(OLD));
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_expenses_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_grant_record_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
BEGIN
  -- Skip no-op UPDATEs caused by the totals trigger cascade (pending expense inserts)
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NULL;
  END IF;
  IF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values, new_values)
    VALUES ('grant_record', OLD.id, 'UPDATE', auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, new_values)
    VALUES ('grant_record', NEW.id, 'INSERT', auth.uid(), to_jsonb(NEW));
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values)
    VALUES ('grant_record', OLD.id, 'DELETE', auth.uid(), to_jsonb(OLD));
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_grant_record_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_grant_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO grant_status_history (grant_id, old_status, new_status, changed_by, comment)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid(), NEW.approval_notes);
  ELSIF (TG_OP = 'INSERT' AND NEW.status IS NOT NULL) THEN
    INSERT INTO grant_status_history (grant_id, old_status, new_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."log_grant_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_users_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NULL;
  END IF;
  IF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values, new_values)
    VALUES ('users', OLD.id, 'UPDATE', auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, new_values)
    VALUES ('users', NEW.id, 'INSERT', auth.uid(), to_jsonb(NEW));
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO audit_log (table_name, record_id, action, changed_by, old_values)
    VALUES ('users', OLD.id, 'DELETE', auth.uid(), to_jsonb(OLD));
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."log_users_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_budget_item_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  grant_owner INT;
  g_name TEXT;
  notif_title TEXT;
  notif_message TEXT;
  notif_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    grant_owner := get_grant_owner(NEW.grant_id);
    g_name := get_grant_name(NEW.grant_id);

    IF NEW.status = 'approved' THEN
      notif_type := 'budget_approved';
      notif_title := 'Budget Item Approved';
      notif_message := 'Budget item "' || COALESCE(NEW.item_name, 'Item #' || NEW.id::text) || '" for grant "' || g_name || '" has been approved.';
    ELSIF NEW.status = 'rejected' THEN
      notif_type := 'budget_rejected';
      notif_title := 'Budget Item Rejected';
      notif_message := 'Budget item "' || COALESCE(NEW.item_name, 'Item #' || NEW.id::text) || '" for grant "' || g_name || '" has been rejected.';
    ELSE
      RETURN NEW;
    END IF;

    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (grant_owner, notif_type, notif_title, notif_message, '/grants/' || NEW.grant_id || '/breakdown');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_budget_item_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_expense_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $_$
DECLARE
  grant_owner INT;
  g_name TEXT;
  notif_title TEXT;
  notif_message TEXT;
  notif_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    grant_owner := get_grant_owner(NEW.grant_id);
    g_name := get_grant_name(NEW.grant_id);

    IF NEW.status = 'approved' THEN
      notif_type := 'expense_approved';
      notif_title := 'Expense Approved';
      notif_message := 'Expense "' || COALESCE(NEW.item_name, 'Expense #' || NEW.id::text) || '" ($' || NEW.amount_spent::text || ') for grant "' || g_name || '" has been approved.';
    ELSIF NEW.status = 'rejected' THEN
      notif_type := 'expense_rejected';
      notif_title := 'Expense Rejected';
      notif_message := 'Expense "' || COALESCE(NEW.item_name, 'Expense #' || NEW.id::text) || '" ($' || NEW.amount_spent::text || ') for grant "' || g_name || '" has been rejected.';
    ELSE
      RETURN NEW;
    END IF;

    INSERT INTO notifications (user_id, type, title, message, link)
    VALUES (grant_owner, notif_type, notif_title, notif_message, '/grants/' || NEW.grant_id || '/breakdown');
  END IF;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."notify_expense_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_grant_comment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  grant_owner INT;
  g_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    grant_owner := get_grant_owner(NEW.grant_id);
    g_name := get_grant_name(NEW.grant_id);

    IF NOT EXISTS (SELECT 1 FROM users WHERE id = grant_owner AND user_id = NEW.user_id) THEN
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (grant_owner, 'comment_added', 'New Comment', 'A new comment was added to your grant "' || g_name || '".', '/grants/' || NEW.grant_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_grant_comment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_grant_status_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  grant_owner INT;
  g_name TEXT;
  notif_title TEXT;
  notif_message TEXT;
  notif_type TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    grant_owner := NEW.user_id;
    g_name := COALESCE(NEW.grant_name, 'Grant #' || NEW.id::text);

    IF NEW.status = 'approved' THEN
      notif_type := 'grant_approved';
      notif_title := 'Grant Approved';
      notif_message := 'Your grant "' || g_name || '" has been approved.';
    ELSIF NEW.status = 'rejected' THEN
      notif_type := 'grant_rejected';
      notif_title := 'Grant Rejected';
      notif_message := 'Your grant "' || g_name || '" has been rejected.';
    ELSIF NEW.status = 'needs_changes' THEN
      notif_type := 'grant_needs_changes';
      notif_title := 'Changes Requested';
      notif_message := 'Your grant "' || g_name || '" requires changes. Please review and resubmit.';
    ELSIF NEW.status = 'pending' AND OLD.status = 'needs_changes' THEN
      PERFORM NULL;  -- handled by notify_grant_submitted trigger
      RETURN NEW;
    END IF;

    IF notif_type IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (grant_owner, notif_type, notif_title, notif_message, '/grants/' || NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_grant_status_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_grant_submitted"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  g_name TEXT;
  notif_message TEXT;
  notif_type TEXT;
  admin_id INT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    g_name := COALESCE(NEW.grant_name, 'Grant #' || NEW.id::text);
    notif_type := 'grant_submitted';
    notif_message := 'A new grant "' || g_name || '" has been submitted for review.';

    FOR admin_id IN SELECT id FROM users WHERE role = 'admin' AND is_active = true AND tenant_id = NEW.tenant_id LOOP
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (admin_id, notif_type, 'New Grant Submitted', notif_message, '/admin/grants/' || NEW.id);
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'needs_changes' AND NEW.status = 'pending' THEN
    g_name := COALESCE(NEW.grant_name, 'Grant #' || NEW.id::text);
    notif_type := 'grant_resubmitted';
    notif_message := 'Grant "' || g_name || '" has been revised and resubmitted for review.';

    FOR admin_id IN SELECT id FROM users WHERE role = 'admin' AND is_active = true AND tenant_id = NEW.tenant_id LOOP
      INSERT INTO notifications (user_id, type, title, message, link)
      VALUES (admin_id, notif_type, 'Grant Resubmitted', notif_message, '/admin/grants/' || NEW.id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_grant_submitted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer DEFAULT NULL::integer) RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  new_tenant_id INT;
  new_user_record JSON;
  tenant_slug TEXT;
BEGIN
  -- Generate slug from organization name
  tenant_slug := lower(regexp_replace(p_organization, '[^a-z0-9]+', '-', 'gi'));
  tenant_slug := trim(both '-' from tenant_slug);

  -- Ensure slug uniqueness by appending a random suffix if needed
  IF EXISTS (SELECT 1 FROM tenants WHERE slug = tenant_slug) THEN
    tenant_slug := tenant_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  -- Create tenant
  INSERT INTO tenants (name, slug, tenant_type)
  VALUES (p_organization, tenant_slug, 'self_service')
  RETURNING id INTO new_tenant_id;

  -- Create tenant settings with all approvals off
  INSERT INTO tenant_settings (tenant_id, require_grant_approval, require_budget_approval, require_expense_approval)
  VALUES (new_tenant_id, false, false, false);

  -- Create user record
  INSERT INTO users (tenant_id, email, user_id, firstname, lastname, organization_name, phone_number, tax_month, role)
  VALUES (new_tenant_id, lower(p_email), p_auth_uid, p_firstname, p_lastname, p_organization, p_phone, p_tax_month, 'grantee')
  RETURNING row_to_json(users.*) INTO new_user_record;

  RETURN new_user_record;
END;
$$;


ALTER FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_audit_log_tenant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(
      (NEW.new_values ->> 'tenant_id')::int,
      (NEW.old_values ->> 'tenant_id')::int
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_audit_log_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_billing_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_billing_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_grant_tenant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM users WHERE id = NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_grant_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_notification_tenant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM users WHERE id = NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_notification_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tenant_from_grant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM grant_record WHERE id = NEW.grant_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_tenant_from_grant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_budget_item_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  affected_budget_item_id INT;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    affected_budget_item_id := OLD.budget_item_id;
  ELSE
    affected_budget_item_id := NEW.budget_item_id;
  END IF;

  IF affected_budget_item_id IS NOT NULL THEN
    UPDATE budget_items
    SET amount_spent = COALESCE((
      SELECT SUM(amount_spent) FROM expenses
      WHERE budget_item_id = affected_budget_item_id AND status = 'approved'
    ), 0)
    WHERE id = affected_budget_item_id
      AND amount_spent IS DISTINCT FROM COALESCE((
        SELECT SUM(amount_spent) FROM expenses
        WHERE budget_item_id = affected_budget_item_id AND status = 'approved'
      ), 0);
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_budget_item_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_grant_record_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  affected_grant_id INT;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    affected_grant_id := OLD.grant_id;
  ELSE
    affected_grant_id := NEW.grant_id;
  END IF;

  UPDATE grant_record
  SET total_spent = COALESCE((
    SELECT SUM(amount_spent) FROM expenses
    WHERE grant_id = affected_grant_id AND status = 'approved'
  ), 0)
  WHERE id = affected_grant_id
    AND total_spent IS DISTINCT FROM COALESCE((
      SELECT SUM(amount_spent) FROM expenses
      WHERE grant_id = affected_grant_id AND status = 'approved'
    ), 0);

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_grant_record_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_grant_remaining_balance"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.remaining_balance := NEW.grant_amount - NEW.total_spent;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_grant_remaining_balance"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" integer NOT NULL,
    "tenant_id" integer,
    "table_name" character varying(50) NOT NULL,
    "record_id" integer NOT NULL,
    "action" character varying(20) NOT NULL,
    "changed_by" "uuid",
    "old_values" "jsonb",
    "new_values" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."audit_log_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."audit_log_id_seq" OWNED BY "public"."audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."billing_customers" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "stripe_customer_id" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."billing_customers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."billing_customers_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."billing_customers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."billing_customers_id_seq" OWNED BY "public"."billing_customers"."id";



CREATE TABLE IF NOT EXISTS "public"."billing_webhook_events" (
    "id" integer NOT NULL,
    "stripe_event_id" character varying(255) NOT NULL,
    "event_type" character varying(100) NOT NULL,
    "payload" "jsonb" NOT NULL,
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."billing_webhook_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."billing_webhook_events_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."billing_webhook_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."billing_webhook_events_id_seq" OWNED BY "public"."billing_webhook_events"."id";



CREATE TABLE IF NOT EXISTS "public"."budget_items" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "grant_id" integer NOT NULL,
    "item_name" character varying(200) NOT NULL,
    "description" "text",
    "budget_allocated" numeric(12,2) DEFAULT 0,
    "amount_spent" numeric(12,2) DEFAULT 0,
    "status" character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "budget_items_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[])))
);


ALTER TABLE "public"."budget_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."budget_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."budget_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."budget_items_id_seq" OWNED BY "public"."budget_items"."id";



CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "grant_id" integer NOT NULL,
    "budget_item_id" integer,
    "item_name" character varying(50),
    "amount_spent" numeric(12,2) DEFAULT 0,
    "expense_date" "date",
    "status" character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "expenses_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."expenses_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."expenses_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."expenses_id_seq" OWNED BY "public"."expenses"."id";



CREATE TABLE IF NOT EXISTS "public"."feature_entitlements" (
    "id" integer NOT NULL,
    "grantee_id" integer NOT NULL,
    "feature_key" character varying(100) NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "source" character varying(50) DEFAULT 'subscription'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."feature_entitlements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."feature_entitlements_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."feature_entitlements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."feature_entitlements_id_seq" OWNED BY "public"."feature_entitlements"."id";



CREATE TABLE IF NOT EXISTS "public"."grant_attachments" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "grant_id" integer NOT NULL,
    "file_name" character varying(255) NOT NULL,
    "file_path" "text" NOT NULL,
    "file_type" character varying(50),
    "file_size" bigint,
    "uploaded_by" "uuid",
    "description" "text",
    "category" character varying(50) DEFAULT 'general'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "grant_attachments_category_check" CHECK ((("category")::"text" = ANY ((ARRAY['proposal'::character varying, 'budget'::character varying, 'report'::character varying, 'general'::character varying])::"text"[])))
);


ALTER TABLE "public"."grant_attachments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."grant_attachments_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."grant_attachments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."grant_attachments_id_seq" OWNED BY "public"."grant_attachments"."id";



CREATE TABLE IF NOT EXISTS "public"."grant_comments" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "grant_id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "comment" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."grant_comments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."grant_comments_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."grant_comments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."grant_comments_id_seq" OWNED BY "public"."grant_comments"."id";



CREATE TABLE IF NOT EXISTS "public"."grant_record" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "grant_name" character varying(100),
    "description" "text",
    "start_spend_period" "date",
    "end_spend_period" "date",
    "release_date" "date",
    "grant_amount" numeric(12,2) DEFAULT 0,
    "disbursed_funds" numeric(12,2) DEFAULT 0,
    "total_spent" numeric(12,2) DEFAULT 0,
    "remaining_balance" numeric(12,2) DEFAULT 0,
    "status" character varying(30) DEFAULT 'pending'::character varying,
    "submitted_at" timestamp with time zone,
    "reviewed_at" timestamp with time zone,
    "reviewer_id" "uuid",
    "approval_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "grant_record_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'needs_changes'::character varying, 'rejected'::character varying])::"text"[])))
);


ALTER TABLE "public"."grant_record" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."grant_record_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."grant_record_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."grant_record_id_seq" OWNED BY "public"."grant_record"."id";



CREATE TABLE IF NOT EXISTS "public"."grant_status_history" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "grant_id" integer NOT NULL,
    "old_status" character varying(30),
    "new_status" character varying(30) NOT NULL,
    "changed_by" "uuid",
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."grant_status_history" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."grant_status_history_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."grant_status_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."grant_status_history_id_seq" OWNED BY "public"."grant_status_history"."id";



CREATE TABLE IF NOT EXISTS "public"."invites" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role" character varying(20) DEFAULT 'grantee'::character varying NOT NULL,
    "email" character varying(75),
    "created_by" "uuid",
    "used_by" "uuid",
    "used_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "invites_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['admin'::character varying, 'grantee'::character varying])::"text"[])))
);


ALTER TABLE "public"."invites" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."invites_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."invites_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."invites_id_seq" OWNED BY "public"."invites"."id";



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "type" character varying(50) NOT NULL,
    "title" character varying(255) NOT NULL,
    "message" "text" NOT NULL,
    "link" "text",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."notifications_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."notifications_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."notifications_id_seq" OWNED BY "public"."notifications"."id";



CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "id" integer DEFAULT 1 NOT NULL,
    "default_support_email" character varying(75) DEFAULT 'support@granttrail.org'::character varying NOT NULL,
    "default_support_phone" character varying(20) DEFAULT '(555) 123-4567'::character varying NOT NULL,
    "basic_membership_product_id" character varying(255),
    "premium_membership_product_id" character varying(255),
    "alert_webhook_url" "text",
    CONSTRAINT "platform_settings_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."platform_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."receipts" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "grant_id" integer NOT NULL,
    "expense_id" integer,
    "receipt_files" json,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."receipts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."receipts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."receipts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."receipts_id_seq" OWNED BY "public"."receipts"."id";



CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "stripe_customer_id" character varying(255) NOT NULL,
    "stripe_subscription_id" character varying(255) NOT NULL,
    "stripe_product_id" character varying(255) NOT NULL,
    "stripe_price_id" character varying(255) NOT NULL,
    "membership_tier" character varying(20) NOT NULL,
    "status" character varying(40) NOT NULL,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "canceled_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_membership_tier_check" CHECK ((("membership_tier")::"text" = ANY ((ARRAY['basic'::character varying, 'premium'::character varying])::"text"[])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."subscriptions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subscriptions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subscriptions_id_seq" OWNED BY "public"."subscriptions"."id";



CREATE TABLE IF NOT EXISTS "public"."system_logs" (
    "id" integer NOT NULL,
    "event_name" character varying(100) NOT NULL,
    "error_message" "text" NOT NULL,
    "error_stack" "text",
    "severity" character varying(20) DEFAULT 'error'::character varying NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "system_logs_severity_check" CHECK ((("severity")::"text" = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'error'::character varying, 'critical'::character varying])::"text"[])))
);


ALTER TABLE "public"."system_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."system_logs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."system_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."system_logs_id_seq" OWNED BY "public"."system_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."tenant_settings" (
    "tenant_id" integer NOT NULL,
    "require_grant_approval" boolean DEFAULT true NOT NULL,
    "require_budget_approval" boolean DEFAULT true NOT NULL,
    "require_expense_approval" boolean DEFAULT true NOT NULL,
    "require_subscription" boolean DEFAULT true NOT NULL,
    "support_email" character varying(75),
    "support_phone" character varying(20)
);


ALTER TABLE "public"."tenant_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" integer NOT NULL,
    "name" character varying(200) NOT NULL,
    "slug" character varying(100) NOT NULL,
    "tenant_type" character varying(20) DEFAULT 'self_service'::character varying NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "tenants_tenant_type_check" CHECK ((("tenant_type")::"text" = ANY ((ARRAY['managed'::character varying, 'self_service'::character varying])::"text"[])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tenants_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tenants_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."tenants_id_seq" OWNED BY "public"."tenants"."id";



CREATE TABLE IF NOT EXISTS "public"."user_memberships" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "subscription_id" integer,
    "membership_tier" character varying(20) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone,
    "source" character varying(20) DEFAULT 'stripe'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_user_memberships_dates" CHECK ((("ends_at" IS NULL) OR ("ends_at" >= "starts_at"))),
    CONSTRAINT "user_memberships_membership_tier_check" CHECK ((("membership_tier")::"text" = ANY ((ARRAY['basic'::character varying, 'premium'::character varying])::"text"[]))),
    CONSTRAINT "user_memberships_source_check" CHECK ((("source")::"text" = ANY ((ARRAY['stripe'::character varying, 'manual'::character varying, 'legacy'::character varying])::"text"[])))
);


ALTER TABLE "public"."user_memberships" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."user_memberships_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_memberships_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_memberships_id_seq" OWNED BY "public"."user_memberships"."id";



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "firstname" character varying(50) NOT NULL,
    "lastname" character varying(50) NOT NULL,
    "organization_name" character varying(50) NOT NULL,
    "email" character varying(75) NOT NULL,
    "phone_number" character varying(20) NOT NULL,
    "user_id" "uuid",
    "role" character varying(20) DEFAULT 'grantee'::character varying,
    "is_active" boolean DEFAULT true NOT NULL,
    "tax_month" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "users_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['admin'::character varying, 'grantee'::character varying, 'super_admin'::character varying])::"text"[]))),
    CONSTRAINT "users_tax_month_check" CHECK ((("tax_month" >= 1) AND ("tax_month" <= 12)))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."users_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."users_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."users_id_seq" OWNED BY "public"."users"."id";



ALTER TABLE ONLY "public"."audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."billing_customers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."billing_customers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."billing_webhook_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."billing_webhook_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."budget_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."budget_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."expenses" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."expenses_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."feature_entitlements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."feature_entitlements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."grant_attachments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."grant_attachments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."grant_comments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."grant_comments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."grant_record" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."grant_record_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."grant_status_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."grant_status_history_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."invites" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."invites_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."notifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notifications_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."receipts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."receipts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscriptions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."system_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."system_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."tenants" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tenants_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_memberships" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_memberships_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."users" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."users_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_webhook_events"
    ADD CONSTRAINT "billing_webhook_events_stripe_event_id_key" UNIQUE ("stripe_event_id");



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feature_entitlements"
    ADD CONSTRAINT "feature_entitlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feature_entitlements"
    ADD CONSTRAINT "feature_entitlements_unique" UNIQUE ("grantee_id", "feature_key");



ALTER TABLE ONLY "public"."grant_attachments"
    ADD CONSTRAINT "grant_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."grant_comments"
    ADD CONSTRAINT "grant_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."grant_record"
    ADD CONSTRAINT "grant_record_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."grant_status_history"
    ADD CONSTRAINT "grant_status_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."system_logs"
    ADD CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_settings"
    ADD CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."user_memberships"
    ADD CONSTRAINT "user_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_memberships"
    ADD CONSTRAINT "user_memberships_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_audit_log_changed_by" ON "public"."audit_log" USING "btree" ("changed_by");



CREATE INDEX "idx_audit_log_created_at" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_log_table_record" ON "public"."audit_log" USING "btree" ("table_name", "record_id");



CREATE INDEX "idx_audit_log_table_record_date" ON "public"."audit_log" USING "btree" ("table_name", "record_id", "created_at" DESC);



CREATE INDEX "idx_audit_log_tenant_id" ON "public"."audit_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_billing_customers_user_id" ON "public"."billing_customers" USING "btree" ("user_id");



CREATE INDEX "idx_budget_items_grant_id" ON "public"."budget_items" USING "btree" ("grant_id");



CREATE INDEX "idx_budget_items_tenant_id" ON "public"."budget_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_expenses_budget_item_id" ON "public"."expenses" USING "btree" ("budget_item_id");



CREATE INDEX "idx_expenses_grant_id" ON "public"."expenses" USING "btree" ("grant_id");



CREATE INDEX "idx_expenses_tenant_created" ON "public"."expenses" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_expenses_tenant_id" ON "public"."expenses" USING "btree" ("tenant_id");



CREATE INDEX "idx_feature_entitlements_feature_key" ON "public"."feature_entitlements" USING "btree" ("feature_key");



CREATE INDEX "idx_feature_entitlements_grantee_id" ON "public"."feature_entitlements" USING "btree" ("grantee_id");



CREATE INDEX "idx_grant_attachments_category" ON "public"."grant_attachments" USING "btree" ("category");



CREATE INDEX "idx_grant_attachments_grant_id" ON "public"."grant_attachments" USING "btree" ("grant_id");



CREATE INDEX "idx_grant_attachments_tenant_id" ON "public"."grant_attachments" USING "btree" ("tenant_id");



CREATE INDEX "idx_grant_attachments_uploaded_by" ON "public"."grant_attachments" USING "btree" ("uploaded_by");



CREATE INDEX "idx_grant_comments_grant_id" ON "public"."grant_comments" USING "btree" ("grant_id");



CREATE INDEX "idx_grant_comments_tenant_id" ON "public"."grant_comments" USING "btree" ("tenant_id");



CREATE INDEX "idx_grant_record_status" ON "public"."grant_record" USING "btree" ("status");



CREATE INDEX "idx_grant_record_tenant_created" ON "public"."grant_record" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_grant_record_tenant_id" ON "public"."grant_record" USING "btree" ("tenant_id");



CREATE INDEX "idx_grant_record_user_id" ON "public"."grant_record" USING "btree" ("user_id");



CREATE INDEX "idx_grant_record_user_status" ON "public"."grant_record" USING "btree" ("user_id", "status");



CREATE INDEX "idx_grant_status_history_created_at" ON "public"."grant_status_history" USING "btree" ("created_at");



CREATE INDEX "idx_grant_status_history_grant_id" ON "public"."grant_status_history" USING "btree" ("grant_id");



CREATE INDEX "idx_grant_status_history_tenant_id" ON "public"."grant_status_history" USING "btree" ("tenant_id");



CREATE INDEX "idx_invites_tenant_id" ON "public"."invites" USING "btree" ("tenant_id");



CREATE INDEX "idx_invites_token" ON "public"."invites" USING "btree" ("token");



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_tenant_id" ON "public"."notifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "is_read") WHERE (NOT "is_read");



CREATE INDEX "idx_receipts_expense_id" ON "public"."receipts" USING "btree" ("expense_id");



CREATE INDEX "idx_receipts_grant_id" ON "public"."receipts" USING "btree" ("grant_id");



CREATE INDEX "idx_receipts_tenant_id" ON "public"."receipts" USING "btree" ("tenant_id");



CREATE INDEX "idx_receipts_user_id" ON "public"."receipts" USING "btree" ("user_id");



CREATE INDEX "idx_subscriptions_customer_id" ON "public"."subscriptions" USING "btree" ("stripe_customer_id");



CREATE INDEX "idx_subscriptions_membership_tier" ON "public"."subscriptions" USING "btree" ("membership_tier");



CREATE INDEX "idx_subscriptions_product_id" ON "public"."subscriptions" USING "btree" ("stripe_product_id");



CREATE INDEX "idx_subscriptions_status" ON "public"."subscriptions" USING "btree" ("status");



CREATE INDEX "idx_subscriptions_user_id" ON "public"."subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_user_memberships_active" ON "public"."user_memberships" USING "btree" ("is_active");



CREATE INDEX "idx_user_memberships_tier" ON "public"."user_memberships" USING "btree" ("membership_tier");



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_role" ON "public"."users" USING "btree" ("role");



CREATE INDEX "idx_users_tenant_id" ON "public"."users" USING "btree" ("tenant_id");



CREATE INDEX "idx_users_user_id" ON "public"."users" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "trg_audit_budget_items" AFTER INSERT OR DELETE OR UPDATE ON "public"."budget_items" FOR EACH ROW EXECUTE FUNCTION "public"."log_budget_items_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_expenses" AFTER INSERT OR DELETE OR UPDATE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."log_expenses_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_grant_record" AFTER INSERT OR DELETE OR UPDATE ON "public"."grant_record" FOR EACH ROW EXECUTE FUNCTION "public"."log_grant_record_changes"();



CREATE OR REPLACE TRIGGER "trg_audit_users" AFTER INSERT OR DELETE OR UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."log_users_changes"();



CREATE OR REPLACE TRIGGER "trg_budget_items_updated_at" BEFORE UPDATE ON "public"."budget_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_critical_log_alert" AFTER INSERT ON "public"."system_logs" FOR EACH ROW EXECUTE FUNCTION "public"."handle_critical_log_alert"();



CREATE OR REPLACE TRIGGER "trg_enforce_membership_eligibility" BEFORE INSERT OR UPDATE ON "public"."user_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_membership_eligibility"();



CREATE OR REPLACE TRIGGER "trg_enforce_self_service_role" BEFORE INSERT OR UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_self_service_role"();



CREATE OR REPLACE TRIGGER "trg_enforce_subscription_tier_product_match" BEFORE INSERT OR UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_subscription_tier_product_match"();



CREATE OR REPLACE TRIGGER "trg_expenses_updated_at" BEFORE UPDATE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_grant_record_updated_at" BEFORE UPDATE ON "public"."grant_record" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_grant_remaining_balance" BEFORE UPDATE ON "public"."grant_record" FOR EACH ROW EXECUTE FUNCTION "public"."update_grant_remaining_balance"();



CREATE OR REPLACE TRIGGER "trg_grant_status_tracking" AFTER INSERT OR UPDATE ON "public"."grant_record" FOR EACH ROW EXECUTE FUNCTION "public"."log_grant_status_change"();



CREATE OR REPLACE TRIGGER "trg_notify_budget_item_status" AFTER UPDATE ON "public"."budget_items" FOR EACH ROW EXECUTE FUNCTION "public"."notify_budget_item_status"();



CREATE OR REPLACE TRIGGER "trg_notify_expense_status" AFTER UPDATE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."notify_expense_status"();



CREATE OR REPLACE TRIGGER "trg_notify_grant_comment" AFTER INSERT ON "public"."grant_comments" FOR EACH ROW EXECUTE FUNCTION "public"."notify_grant_comment"();



CREATE OR REPLACE TRIGGER "trg_notify_grant_status" AFTER UPDATE ON "public"."grant_record" FOR EACH ROW EXECUTE FUNCTION "public"."notify_grant_status_change"();



CREATE OR REPLACE TRIGGER "trg_notify_grant_submitted" AFTER INSERT OR UPDATE ON "public"."grant_record" FOR EACH ROW EXECUTE FUNCTION "public"."notify_grant_submitted"();



CREATE OR REPLACE TRIGGER "trg_set_audit_log_tenant_id" BEFORE INSERT ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."set_audit_log_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_budget_items_tenant_id" BEFORE INSERT ON "public"."budget_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_from_grant"();



CREATE OR REPLACE TRIGGER "trg_set_expenses_tenant_id" BEFORE INSERT ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_from_grant"();



CREATE OR REPLACE TRIGGER "trg_set_grant_attachments_tenant_id" BEFORE INSERT ON "public"."grant_attachments" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_from_grant"();



CREATE OR REPLACE TRIGGER "trg_set_grant_comments_tenant_id" BEFORE INSERT ON "public"."grant_comments" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_from_grant"();



CREATE OR REPLACE TRIGGER "trg_set_grant_status_history_tenant_id" BEFORE INSERT ON "public"."grant_status_history" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_from_grant"();



CREATE OR REPLACE TRIGGER "trg_set_grant_tenant_id" BEFORE INSERT ON "public"."grant_record" FOR EACH ROW EXECUTE FUNCTION "public"."set_grant_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_notifications_tenant_id" BEFORE INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."set_notification_tenant_id"();



CREATE OR REPLACE TRIGGER "trg_set_receipts_tenant_id" BEFORE INSERT ON "public"."receipts" FOR EACH ROW EXECUTE FUNCTION "public"."set_tenant_from_grant"();



CREATE OR REPLACE TRIGGER "trg_subscriptions_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_billing_updated_at"();



CREATE OR REPLACE TRIGGER "trg_user_memberships_updated_at" BEFORE UPDATE ON "public"."user_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."set_billing_updated_at"();



CREATE OR REPLACE TRIGGER "trg_zz_auto_approve_budget_item" BEFORE INSERT ON "public"."budget_items" FOR EACH ROW EXECUTE FUNCTION "public"."auto_approve_budget_item"();



CREATE OR REPLACE TRIGGER "trg_zz_auto_approve_expense" BEFORE INSERT ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."auto_approve_expense"();



CREATE OR REPLACE TRIGGER "trg_zz_auto_approve_grant" BEFORE INSERT ON "public"."grant_record" FOR EACH ROW EXECUTE FUNCTION "public"."auto_approve_grant"();



CREATE OR REPLACE TRIGGER "update_budget_item_records" AFTER INSERT OR DELETE OR UPDATE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."update_budget_item_totals"();



CREATE OR REPLACE TRIGGER "update_records" AFTER INSERT OR DELETE OR UPDATE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."update_grant_record_totals"();



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_customers"
    ADD CONSTRAINT "billing_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "public"."grant_record"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budget_items"
    ADD CONSTRAINT "budget_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_budget_item_id_fkey" FOREIGN KEY ("budget_item_id") REFERENCES "public"."budget_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "public"."grant_record"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feature_entitlements"
    ADD CONSTRAINT "feature_entitlements_grantee_id_fkey" FOREIGN KEY ("grantee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grant_attachments"
    ADD CONSTRAINT "grant_attachments_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "public"."grant_record"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grant_attachments"
    ADD CONSTRAINT "grant_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grant_attachments"
    ADD CONSTRAINT "grant_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."grant_comments"
    ADD CONSTRAINT "grant_comments_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "public"."grant_record"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grant_comments"
    ADD CONSTRAINT "grant_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grant_comments"
    ADD CONSTRAINT "grant_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."grant_record"
    ADD CONSTRAINT "grant_record_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."grant_record"
    ADD CONSTRAINT "grant_record_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grant_record"
    ADD CONSTRAINT "grant_record_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grant_status_history"
    ADD CONSTRAINT "grant_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."grant_status_history"
    ADD CONSTRAINT "grant_status_history_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "public"."grant_record"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."grant_status_history"
    ADD CONSTRAINT "grant_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "public"."grant_record"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."receipts"
    ADD CONSTRAINT "receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_settings"
    ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_memberships"
    ADD CONSTRAINT "user_memberships_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_memberships"
    ADD CONSTRAINT "user_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



CREATE POLICY "Admins can create invites for their tenant" ON "public"."invites" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can delete all budget items in their tenant" ON "public"."budget_items" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can delete all expenses in their tenant" ON "public"."expenses" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can insert comments in their tenant" ON "public"."grant_comments" FOR INSERT WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can manage memberships in their tenant" ON "public"."user_memberships" USING (("public"."is_admin"() AND ("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."tenant_id" = "public"."current_tenant_id"()))))) WITH CHECK (("public"."is_admin"() AND ("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."tenant_id" = "public"."current_tenant_id"())))));



CREATE POLICY "Admins can update all budget items in their tenant" ON "public"."budget_items" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can update all expenses in their tenant" ON "public"."expenses" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can update all grants in their tenant" ON "public"."grant_record" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can update their tenant settings" ON "public"."tenant_settings" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"())) WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can update users in their tenant" ON "public"."users" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"())) WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view all audit logs in their tenant" ON "public"."audit_log" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view all budget items in their tenant" ON "public"."budget_items" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view all expenses in their tenant" ON "public"."expenses" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view all grant attachments in their tenant" ON "public"."grant_attachments" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view all grant status history in their tenant" ON "public"."grant_status_history" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view all grants in their tenant" ON "public"."grant_record" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view all receipts in their tenant" ON "public"."receipts" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view all users in their tenant" ON "public"."users" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Admins can view invites for their tenant" ON "public"."invites" FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin"()) OR "public"."is_super_admin"()));



CREATE POLICY "Anyone can read invites by token" ON "public"."invites" FOR SELECT USING (true);



CREATE POLICY "Anyone can read platform settings" ON "public"."platform_settings" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can read tenant names" ON "public"."tenants" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read their tenant settings" ON "public"."tenant_settings" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "Grantees can view their own entitlements" ON "public"."feature_entitlements" FOR SELECT USING (("grantee_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"()))));



CREATE POLICY "Service role can manage billing customers" ON "public"."billing_customers" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage memberships" ON "public"."user_memberships" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage subscriptions" ON "public"."subscriptions" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage webhook events" ON "public"."billing_webhook_events" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Super admins can insert tenant settings" ON "public"."tenant_settings" FOR INSERT WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "Super admins can manage tenants" ON "public"."tenants" USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "Super admins can update platform settings" ON "public"."platform_settings" FOR UPDATE USING ("public"."is_super_admin"()) WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "Super admins can view system logs" ON "public"."system_logs" FOR SELECT USING ("public"."is_super_admin"());



CREATE POLICY "System can insert notifications" ON "public"."notifications" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can insert status history" ON "public"."grant_status_history" FOR INSERT WITH CHECK (true);



CREATE POLICY "System can update invites" ON "public"."invites" FOR UPDATE USING (true) WITH CHECK (true);



CREATE POLICY "Users can delete attachments for their grants" ON "public"."grant_attachments" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete budget items for their grants" ON "public"."budget_items" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete expenses for their grants" ON "public"."expenses" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can delete their own notifications" ON "public"."notifications" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("user_id" = ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can insert budget items for their grants" ON "public"."budget_items" FOR INSERT WITH CHECK (("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert expenses for their grants" ON "public"."expenses" FOR INSERT WITH CHECK (("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their own grants" ON "public"."grant_record" FOR INSERT WITH CHECK (("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their own receipts" ON "public"."receipts" FOR INSERT WITH CHECK (("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can insert their own user record" ON "public"."users" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read their own billing customer" ON "public"."billing_customers" FOR SELECT USING (("user_id" = ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can read their own membership" ON "public"."user_memberships" FOR SELECT USING (("user_id" = ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can read their own subscriptions" ON "public"."subscriptions" FOR SELECT USING (("user_id" = ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can update budget items for their grants" ON "public"."budget_items" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update expenses for their grants" ON "public"."expenses" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own grants" ON "public"."grant_record" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own notifications" ON "public"."notifications" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("user_id" = ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"()))))) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) AND ("user_id" = ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own user record" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can upload attachments for their grants" ON "public"."grant_attachments" FOR INSERT WITH CHECK (("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"()))));



CREATE POLICY "Users can view attachments for their grants" ON "public"."grant_attachments" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view audit logs for their own records" ON "public"."audit_log" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("changed_by" = "auth"."uid"())));



CREATE POLICY "Users can view budget items for their grants" ON "public"."budget_items" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view comments on their grants" ON "public"."grant_comments" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND (("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"()))) OR "public"."is_admin"())));



CREATE POLICY "Users can view expenses for their grants" ON "public"."expenses" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view status history for their grants" ON "public"."grant_status_history" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("grant_id" IN ( SELECT "gr"."id"
   FROM ("public"."grant_record" "gr"
     JOIN "public"."users" "u" ON (("gr"."user_id" = "u"."id")))
  WHERE ("u"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own grants" ON "public"."grant_record" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own notifications" ON "public"."notifications" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND (("user_id" = ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"()))) OR "public"."is_admin"())));



CREATE POLICY "Users can view their own receipts" ON "public"."receipts" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) AND ("user_id" IN ( SELECT "users"."id"
   FROM "public"."users"
  WHERE ("users"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own tenant" ON "public"."tenants" FOR SELECT USING ((("id" = "public"."current_tenant_id"()) OR "public"."is_super_admin"()));



CREATE POLICY "Users can view their own user record" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budget_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feature_entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."grant_attachments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."grant_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."grant_record" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."grant_status_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."billing_customers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."billing_webhook_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."subscriptions";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."user_memberships";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";




























































































































































GRANT ALL ON FUNCTION "public"."auto_approve_budget_item"() TO "service_role";
GRANT ALL ON FUNCTION "public"."auto_approve_budget_item"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_approve_budget_item"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."auto_approve_expense"() TO "service_role";
GRANT ALL ON FUNCTION "public"."auto_approve_expense"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_approve_expense"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."auto_approve_grant"() TO "service_role";
GRANT ALL ON FUNCTION "public"."auto_approve_grant"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_approve_grant"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."calculate_grant_budget_totals"("g_id" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."calculate_grant_budget_totals"("g_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_grant_budget_totals"("g_id" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "service_role";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_tenant_id"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."enforce_membership_eligibility"() TO "service_role";
GRANT ALL ON FUNCTION "public"."enforce_membership_eligibility"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_membership_eligibility"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."enforce_self_service_role"() TO "service_role";
GRANT ALL ON FUNCTION "public"."enforce_self_service_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_self_service_role"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."enforce_subscription_tier_product_match"() TO "service_role";
GRANT ALL ON FUNCTION "public"."enforce_subscription_tier_product_match"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_subscription_tier_product_match"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_admin_user_ids"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_admin_user_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_admin_user_ids"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_grant_name"("g_id" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_grant_name"("g_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_grant_name"("g_id" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."get_grant_owner"("g_id" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."get_grant_owner"("g_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_grant_owner"("g_id" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."has_basic_membership"() TO "service_role";
GRANT ALL ON FUNCTION "public"."has_basic_membership"() TO "anon";
GRANT ALL ON FUNCTION "public"."has_basic_membership"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."has_basic_membership"("p_user_id" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."has_basic_membership"("p_user_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."has_basic_membership"("p_user_id" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."has_feature_access"("p_feature_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."has_feature_access"("p_feature_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_feature_access"("p_feature_key" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."has_premium_membership"() TO "service_role";
GRANT ALL ON FUNCTION "public"."has_premium_membership"() TO "anon";
GRANT ALL ON FUNCTION "public"."has_premium_membership"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."has_premium_membership"("p_user_id" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."has_premium_membership"("p_user_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."has_premium_membership"("p_user_id" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_membership_exempt"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_membership_exempt"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_membership_exempt"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_membership_exempt"("p_user_id" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."is_membership_exempt"("p_user_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_membership_exempt"("p_user_id" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."log_budget_items_changes"() TO "service_role";
GRANT ALL ON FUNCTION "public"."log_budget_items_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_budget_items_changes"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."log_expenses_changes"() TO "service_role";
GRANT ALL ON FUNCTION "public"."log_expenses_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_expenses_changes"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."log_grant_record_changes"() TO "service_role";
GRANT ALL ON FUNCTION "public"."log_grant_record_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_grant_record_changes"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."log_grant_status_change"() TO "service_role";
GRANT ALL ON FUNCTION "public"."log_grant_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_grant_status_change"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."log_users_changes"() TO "service_role";
GRANT ALL ON FUNCTION "public"."log_users_changes"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_users_changes"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."notify_budget_item_status"() TO "service_role";
GRANT ALL ON FUNCTION "public"."notify_budget_item_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_budget_item_status"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."notify_expense_status"() TO "service_role";
GRANT ALL ON FUNCTION "public"."notify_expense_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_expense_status"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."notify_grant_comment"() TO "service_role";
GRANT ALL ON FUNCTION "public"."notify_grant_comment"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_grant_comment"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."notify_grant_status_change"() TO "service_role";
GRANT ALL ON FUNCTION "public"."notify_grant_status_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_grant_status_change"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."notify_grant_submitted"() TO "service_role";
GRANT ALL ON FUNCTION "public"."notify_grant_submitted"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_grant_submitted"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."provision_self_service_tenant"("p_auth_uid" "uuid", "p_email" "text", "p_firstname" "text", "p_lastname" "text", "p_organization" "text", "p_phone" "text", "p_tax_month" integer) TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_audit_log_tenant_id"() TO "service_role";
GRANT ALL ON FUNCTION "public"."set_audit_log_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_audit_log_tenant_id"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_billing_updated_at"() TO "service_role";
GRANT ALL ON FUNCTION "public"."set_billing_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_billing_updated_at"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_grant_tenant_id"() TO "service_role";
GRANT ALL ON FUNCTION "public"."set_grant_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_grant_tenant_id"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_notification_tenant_id"() TO "service_role";
GRANT ALL ON FUNCTION "public"."set_notification_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_notification_tenant_id"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_tenant_from_grant"() TO "service_role";
GRANT ALL ON FUNCTION "public"."set_tenant_from_grant"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_tenant_from_grant"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."update_budget_item_totals"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_budget_item_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_budget_item_totals"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."update_grant_record_totals"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_grant_record_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_grant_record_totals"() TO "authenticated";



GRANT ALL ON FUNCTION "public"."update_grant_remaining_balance"() TO "service_role";
GRANT ALL ON FUNCTION "public"."update_grant_remaining_balance"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_grant_remaining_balance"() TO "authenticated";


















GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."billing_customers" TO "anon";
GRANT ALL ON TABLE "public"."billing_customers" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_customers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."billing_customers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."billing_customers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."billing_customers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."billing_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."billing_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_webhook_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."billing_webhook_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."billing_webhook_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."billing_webhook_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."budget_items" TO "anon";
GRANT ALL ON TABLE "public"."budget_items" TO "authenticated";
GRANT ALL ON TABLE "public"."budget_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."budget_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."budget_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."budget_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."expenses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."feature_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."feature_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_entitlements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."feature_entitlements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."feature_entitlements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."feature_entitlements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."grant_attachments" TO "anon";
GRANT ALL ON TABLE "public"."grant_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."grant_attachments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."grant_attachments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."grant_attachments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."grant_attachments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."grant_comments" TO "anon";
GRANT ALL ON TABLE "public"."grant_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."grant_comments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."grant_comments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."grant_comments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."grant_comments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."grant_record" TO "anon";
GRANT ALL ON TABLE "public"."grant_record" TO "authenticated";
GRANT ALL ON TABLE "public"."grant_record" TO "service_role";



GRANT ALL ON SEQUENCE "public"."grant_record_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."grant_record_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."grant_record_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."grant_status_history" TO "anon";
GRANT ALL ON TABLE "public"."grant_status_history" TO "authenticated";
GRANT ALL ON TABLE "public"."grant_status_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."grant_status_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."grant_status_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."grant_status_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invites" TO "anon";
GRANT ALL ON TABLE "public"."invites" TO "authenticated";
GRANT ALL ON TABLE "public"."invites" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invites_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invites_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invites_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."platform_settings" TO "anon";
GRANT ALL ON TABLE "public"."platform_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_settings" TO "service_role";



GRANT ALL ON TABLE "public"."receipts" TO "anon";
GRANT ALL ON TABLE "public"."receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."receipts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."receipts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."receipts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."receipts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subscriptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscriptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscriptions_id_seq" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."system_logs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."system_logs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."system_logs" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."system_logs_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."system_logs_id_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."system_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_settings" TO "anon";
GRANT ALL ON TABLE "public"."tenant_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_settings" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tenants_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenants_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenants_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_memberships" TO "anon";
GRANT ALL ON TABLE "public"."user_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."user_memberships" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_memberships_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_memberships_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_memberships_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE POLICY "Admins can view all grant documents" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'grant-documents'::"text") AND "public"."is_admin"()));



CREATE POLICY "Admins can view all receipts in storage" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'receipts'::"text") AND "public"."is_admin"()));



CREATE POLICY "Users can delete their own grant documents" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'grant-documents'::"text") AND ("auth"."uid"() IS NOT NULL)));



CREATE POLICY "Users can delete their own receipts" ON "storage"."objects" FOR DELETE USING ((("bucket_id" = 'receipts'::"text") AND ("auth"."uid"() IS NOT NULL)));



CREATE POLICY "Users can upload grant documents" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'grant-documents'::"text") AND ("auth"."uid"() IS NOT NULL)));



CREATE POLICY "Users can upload receipts" ON "storage"."objects" FOR INSERT WITH CHECK ((("bucket_id" = 'receipts'::"text") AND ("auth"."uid"() IS NOT NULL)));



CREATE POLICY "Users can view their own grant documents" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'grant-documents'::"text") AND ("auth"."uid"() IS NOT NULL)));



CREATE POLICY "Users can view their own receipts" ON "storage"."objects" FOR SELECT USING ((("bucket_id" = 'receipts'::"text") AND ("auth"."uid"() IS NOT NULL)));



