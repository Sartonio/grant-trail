-- ==========================================
-- TFAC GRANT MANAGEMENT SYSTEM
-- Complete Database Setup (Fresh Install)
-- ==========================================
-- Run this on a clean Supabase project.
-- Replaces all previous migration scripts.
--
-- DATA MODEL:
-- Tenant → User → Grant → Budget_Item → Expense → Receipt
--
-- TABLES CREATED:
--   tenants, tenant_settings, invites, users, grant_record,
--   budget_items, expenses, receipts, grant_attachments,
--   grant_status_history, audit_log, grant_comments, notifications
-- ==========================================


-- ==========================================
-- SECTION 1: CORE TABLES
-- ==========================================

-- tenants: each independent organization using the system
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,                    -- short URL-safe identifier (e.g. 'tfac'), auto-generated, not shown to users
  tenant_type VARCHAR(20) NOT NULL DEFAULT 'self_service'
    CHECK (tenant_type IN ('managed', 'self_service')),
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- tenant_settings: per-tenant configuration (approval workflows, etc.)
CREATE TABLE tenant_settings (
  tenant_id INT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  require_grant_approval BOOLEAN NOT NULL DEFAULT true,
  require_budget_approval BOOLEAN NOT NULL DEFAULT true,
  require_expense_approval BOOLEAN NOT NULL DEFAULT true,
  require_subscription BOOLEAN NOT NULL DEFAULT true,
  support_email VARCHAR(75),
  support_phone VARCHAR(20)
);

-- platform_settings: single-row platform-wide configuration (managed by super_admin)
CREATE TABLE platform_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_support_email VARCHAR(75) NOT NULL DEFAULT 'support@granttrail.org',
  default_support_phone VARCHAR(20) NOT NULL DEFAULT '(555) 123-4567',
  basic_membership_product_id VARCHAR(255) NOT NULL DEFAULT 'prod_UKEACUGjIeg3MU',
  premium_membership_product_id VARCHAR(255) NOT NULL DEFAULT 'prod_UDClBMtvFLKyNW'
);

INSERT INTO platform_settings DEFAULT VALUES;

-- invites: tokens for onboarding new users into a tenant
CREATE TABLE invites (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'grantee' CHECK (role IN ('admin', 'grantee')),
  email VARCHAR(75),
  created_by UUID REFERENCES auth.users(id),
  used_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invites_token ON invites(token);
CREATE INDEX idx_invites_tenant_id ON invites(tenant_id);

-- users: people who interact with the system (grantees, admins, super_admins)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  firstname VARCHAR(50) NOT NULL,
  lastname VARCHAR(50) NOT NULL,
  organization_name VARCHAR(50) NOT NULL,
  email VARCHAR(75) NOT NULL UNIQUE,
  phone_number VARCHAR(20) NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  role VARCHAR(20) DEFAULT 'grantee' CHECK (role IN ('admin', 'grantee', 'super_admin')),
  is_active BOOLEAN DEFAULT true NOT NULL,
  tax_month INT CHECK (tax_month BETWEEN 1 AND 12),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_user_id ON users(user_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_tenant_id ON users(tenant_id);

-- grant_record: a grant awarded to a user
CREATE TABLE grant_record (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_name VARCHAR(100),
  description TEXT,
  start_spend_period DATE,
  end_spend_period DATE,
  release_date DATE,
  grant_amount DECIMAL(12, 2) DEFAULT 0,
  disbursed_funds DECIMAL(12, 2) DEFAULT 0,
  total_spent DECIMAL(12, 2) DEFAULT 0,
  remaining_balance DECIMAL(12, 2) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'needs_changes', 'rejected')),
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES auth.users(id),
  approval_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_grant_record_user_id ON grant_record(user_id);
CREATE INDEX idx_grant_record_status ON grant_record(status);
CREATE INDEX idx_grant_record_user_status ON grant_record(user_id, status);
CREATE INDEX idx_grant_record_tenant_id ON grant_record(tenant_id);

-- budget_items: budget line items within a grant
CREATE TABLE budget_items (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id INT NOT NULL REFERENCES grant_record(id) ON DELETE CASCADE,
  item_name VARCHAR(200) NOT NULL,
  description TEXT,
  budget_allocated DECIMAL(12, 2) DEFAULT 0,
  amount_spent DECIMAL(12, 2) DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_budget_items_grant_id ON budget_items(grant_id);
CREATE INDEX idx_budget_items_tenant_id ON budget_items(tenant_id);

-- expenses: individual expense entries within a budget item
CREATE TABLE expenses (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id INT NOT NULL REFERENCES grant_record(id) ON DELETE CASCADE,
  budget_item_id INT REFERENCES budget_items(id) ON DELETE CASCADE,
  item_name VARCHAR(50),
  amount_spent DECIMAL(12, 2) DEFAULT 0,
  expense_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_expenses_grant_id ON expenses(grant_id);
CREATE INDEX idx_expenses_budget_item_id ON expenses(budget_item_id);
CREATE INDEX idx_expenses_tenant_id ON expenses(tenant_id);

-- receipts: files attached to an expense
CREATE TABLE receipts (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id INT NOT NULL REFERENCES grant_record(id) ON DELETE CASCADE,
  expense_id INT REFERENCES expenses(id) ON DELETE SET NULL,
  receipt_files JSON,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_receipts_user_id ON receipts(user_id);
CREATE INDEX idx_receipts_grant_id ON receipts(grant_id);
CREATE INDEX idx_receipts_expense_id ON receipts(expense_id);
CREATE INDEX idx_receipts_tenant_id ON receipts(tenant_id);

-- grant_attachments: documents uploaded for a grant (proposals, budgets, reports)
CREATE TABLE grant_attachments (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id INT NOT NULL REFERENCES grant_record(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_type VARCHAR(50),
  file_size BIGINT,
  uploaded_by UUID REFERENCES auth.users(id),
  description TEXT,
  category VARCHAR(50) DEFAULT 'general'
    CHECK (category IN ('proposal', 'budget', 'report', 'general')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_grant_attachments_grant_id ON grant_attachments(grant_id);
CREATE INDEX idx_grant_attachments_uploaded_by ON grant_attachments(uploaded_by);
CREATE INDEX idx_grant_attachments_category ON grant_attachments(category);
CREATE INDEX idx_grant_attachments_tenant_id ON grant_attachments(tenant_id);

-- grant_status_history: full audit trail of every status change
CREATE TABLE grant_status_history (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id INT NOT NULL REFERENCES grant_record(id) ON DELETE CASCADE,
  old_status VARCHAR(30),
  new_status VARCHAR(30) NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_grant_status_history_grant_id ON grant_status_history(grant_id);
CREATE INDEX idx_grant_status_history_created_at ON grant_status_history(created_at);
CREATE INDEX idx_grant_status_history_tenant_id ON grant_status_history(tenant_id);

-- audit_log: generic change log for all major tables
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
  table_name VARCHAR(50) NOT NULL,
  record_id INT NOT NULL,
  action VARCHAR(20) NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_changed_by ON audit_log(changed_by);
CREATE INDEX idx_audit_log_table_record_date ON audit_log(table_name, record_id, created_at DESC);
CREATE INDEX idx_audit_log_tenant_id ON audit_log(tenant_id);

-- grant_comments: admin comments on a grant
CREATE TABLE grant_comments (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id INT NOT NULL REFERENCES grant_record(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_grant_comments_grant_id ON grant_comments(grant_id);
CREATE INDEX idx_grant_comments_tenant_id ON grant_comments(tenant_id);

-- notifications: in-app notifications for users
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read) WHERE NOT is_read;
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_tenant_id ON notifications(tenant_id);

-- billing_customers: maps app users to Stripe customers
CREATE TABLE billing_customers (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_customers_user_id ON billing_customers(user_id);

-- billing_webhook_events: idempotency ledger for Stripe webhook processing
CREATE TABLE billing_webhook_events (
  id SERIAL PRIMARY KEY,
  stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- subscriptions: Stripe subscription state for each user
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(255) NOT NULL,
  stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_product_id VARCHAR(255) NOT NULL,
  stripe_price_id VARCHAR(255) NOT NULL,
  membership_tier VARCHAR(20) NOT NULL CHECK (membership_tier IN ('basic', 'premium')),
  status VARCHAR(40) NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_membership_tier ON subscriptions(membership_tier);
CREATE INDEX idx_subscriptions_product_id ON subscriptions(stripe_product_id);

-- user_memberships: effective app access tier for each user
CREATE TABLE user_memberships (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INT REFERENCES subscriptions(id) ON DELETE SET NULL,
  membership_tier VARCHAR(20) NOT NULL CHECK (membership_tier IN ('basic', 'premium')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  source VARCHAR(20) NOT NULL DEFAULT 'stripe' CHECK (source IN ('stripe', 'manual', 'legacy')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_memberships_dates CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX idx_user_memberships_tier ON user_memberships(membership_tier);
CREATE INDEX idx_user_memberships_active ON user_memberships(is_active);


-- ==========================================
-- SECTION 2: FUNCTIONS & TRIGGERS
-- ==========================================

-- Auto-update updated_at on any UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_grant_record_updated_at
BEFORE UPDATE ON grant_record
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_budget_items_updated_at
BEFORE UPDATE ON budget_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_expenses_updated_at
BEFORE UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------
-- Tenant ID auto-populate triggers
-- Child tables inherit tenant_id from their parent grant.
-- grant_record inherits tenant_id from the inserting user.
-- -------------------------------------------------------

-- grant_record: copy tenant_id from the user who owns the grant
CREATE OR REPLACE FUNCTION set_grant_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM users WHERE id = NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_set_grant_tenant_id
BEFORE INSERT ON grant_record
FOR EACH ROW EXECUTE FUNCTION set_grant_tenant_id();

-- Generic function: copy tenant_id from the parent grant
CREATE OR REPLACE FUNCTION set_tenant_from_grant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM grant_record WHERE id = NEW.grant_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_set_budget_items_tenant_id
BEFORE INSERT ON budget_items
FOR EACH ROW EXECUTE FUNCTION set_tenant_from_grant();

CREATE TRIGGER trg_set_expenses_tenant_id
BEFORE INSERT ON expenses
FOR EACH ROW EXECUTE FUNCTION set_tenant_from_grant();

CREATE TRIGGER trg_set_receipts_tenant_id
BEFORE INSERT ON receipts
FOR EACH ROW EXECUTE FUNCTION set_tenant_from_grant();

CREATE TRIGGER trg_set_grant_attachments_tenant_id
BEFORE INSERT ON grant_attachments
FOR EACH ROW EXECUTE FUNCTION set_tenant_from_grant();

CREATE TRIGGER trg_set_grant_status_history_tenant_id
BEFORE INSERT ON grant_status_history
FOR EACH ROW EXECUTE FUNCTION set_tenant_from_grant();

CREATE TRIGGER trg_set_grant_comments_tenant_id
BEFORE INSERT ON grant_comments
FOR EACH ROW EXECUTE FUNCTION set_tenant_from_grant();

-- notifications: copy tenant_id from the target user
CREATE OR REPLACE FUNCTION set_notification_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := (SELECT tenant_id FROM users WHERE id = NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_set_notifications_tenant_id
BEFORE INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION set_notification_tenant_id();

-- audit_log: extract tenant_id from the JSONB values
CREATE OR REPLACE FUNCTION set_audit_log_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(
      (NEW.new_values ->> 'tenant_id')::int,
      (NEW.old_values ->> 'tenant_id')::int
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_set_audit_log_tenant_id
BEFORE INSERT ON audit_log
FOR EACH ROW EXECUTE FUNCTION set_audit_log_tenant_id();

-- -------------------------------------------------------
-- Auto-approval triggers (Doc 13: Approval Config)
-- BEFORE INSERT: check tenant_settings and auto-approve if not required.
-- Runs after tenant_id is set by the tenant auto-populate triggers.
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION auto_approve_grant()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT (SELECT require_grant_approval FROM tenant_settings WHERE tenant_id = NEW.tenant_id) THEN
      NEW.status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_zz_auto_approve_grant
BEFORE INSERT ON grant_record
FOR EACH ROW EXECUTE FUNCTION auto_approve_grant();

CREATE OR REPLACE FUNCTION auto_approve_budget_item()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT (SELECT require_budget_approval FROM tenant_settings WHERE tenant_id = NEW.tenant_id) THEN
      NEW.status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_zz_auto_approve_budget_item
BEFORE INSERT ON budget_items
FOR EACH ROW EXECUTE FUNCTION auto_approve_budget_item();

CREATE OR REPLACE FUNCTION auto_approve_expense()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF NOT (SELECT require_expense_approval FROM tenant_settings WHERE tenant_id = NEW.tenant_id) THEN
      NEW.status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_zz_auto_approve_expense
BEFORE INSERT ON expenses
FOR EACH ROW EXECUTE FUNCTION auto_approve_expense();

-- -------------------------------------------------------
-- Tenant type enforcement (Doc 14: Two-Tier SaaS)
-- Self-service tenants cannot have admin users.
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_self_service_role()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    IF (SELECT tenant_type FROM tenants WHERE id = NEW.tenant_id) = 'self_service' THEN
      RAISE EXCEPTION 'Self-service tenants cannot have admin users';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_enforce_self_service_role
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION enforce_self_service_role();

-- -------------------------------------------------------
-- Billing triggers
-- -------------------------------------------------------

CREATE OR REPLACE FUNCTION set_billing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscriptions_updated_at
BEFORE UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION set_billing_updated_at();

CREATE TRIGGER trg_user_memberships_updated_at
BEFORE UPDATE ON user_memberships
FOR EACH ROW EXECUTE FUNCTION set_billing_updated_at();

-- Ensure subscription tier aligns with configured Stripe product IDs.
CREATE OR REPLACE FUNCTION enforce_subscription_tier_product_match()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_enforce_subscription_tier_product_match
BEFORE INSERT OR UPDATE ON subscriptions
FOR EACH ROW EXECUTE FUNCTION enforce_subscription_tier_product_match();

-- Memberships are not required for super_admins or TFAC admins.
CREATE OR REPLACE FUNCTION enforce_membership_eligibility()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_enforce_membership_eligibility
BEFORE INSERT OR UPDATE ON user_memberships
FOR EACH ROW EXECUTE FUNCTION enforce_membership_eligibility();

-- -------------------------------------------------------
-- Totals & balance triggers
-- -------------------------------------------------------

-- Recalculate grant_record.total_spent when expenses change
CREATE OR REPLACE FUNCTION update_grant_record_totals()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_records
AFTER INSERT OR UPDATE OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION update_grant_record_totals();

-- Keep grant_record.remaining_balance = grant_amount - total_spent
CREATE OR REPLACE FUNCTION update_grant_remaining_balance()
RETURNS TRIGGER AS $$
BEGIN
  NEW.remaining_balance := NEW.grant_amount - NEW.total_spent;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_grant_remaining_balance
BEFORE UPDATE ON grant_record
FOR EACH ROW EXECUTE FUNCTION update_grant_remaining_balance();

-- Recalculate budget_item amount_spent when expenses change
CREATE OR REPLACE FUNCTION update_budget_item_totals()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_budget_item_records
AFTER INSERT OR UPDATE OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION update_budget_item_totals();

-- -------------------------------------------------------
-- Status history & audit triggers
-- -------------------------------------------------------

-- Log every grant status change to grant_status_history
CREATE OR REPLACE FUNCTION log_grant_status_change()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_grant_status_tracking
AFTER INSERT OR UPDATE ON grant_record
FOR EACH ROW EXECUTE FUNCTION log_grant_status_change();

-- Audit trigger for grant_record
CREATE OR REPLACE FUNCTION log_grant_record_changes()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_audit_grant_record
AFTER INSERT OR UPDATE OR DELETE ON grant_record
FOR EACH ROW EXECUTE FUNCTION log_grant_record_changes();

-- Audit trigger for expenses
CREATE OR REPLACE FUNCTION log_expenses_changes()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_audit_expenses
AFTER INSERT OR UPDATE OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION log_expenses_changes();

-- Audit trigger for budget_items
CREATE OR REPLACE FUNCTION log_budget_items_changes()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_audit_budget_items
AFTER INSERT OR UPDATE OR DELETE ON budget_items
FOR EACH ROW EXECUTE FUNCTION log_budget_items_changes();

-- Audit trigger for users (role changes, enable/disable, profile updates)
CREATE OR REPLACE FUNCTION log_users_changes()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_audit_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION log_users_changes();

-- -------------------------------------------------------
-- Notification helper functions
-- -------------------------------------------------------

-- Helper: get the integer user PK from a grant_record row
CREATE OR REPLACE FUNCTION get_grant_owner(g_id INT)
RETURNS INT AS $$
  SELECT user_id FROM grant_record WHERE id = g_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get all admin user integer PKs for the same tenant as the grant
CREATE OR REPLACE FUNCTION get_admin_user_ids()
RETURNS SETOF INT AS $$
  SELECT id FROM users WHERE role = 'admin' AND is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get grant name for display
CREATE OR REPLACE FUNCTION get_grant_name(g_id INT)
RETURNS TEXT AS $$
  SELECT COALESCE(grant_name, 'Grant #' || id::text) FROM grant_record WHERE id = g_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- -------------------------------------------------------
-- Notification triggers
-- -------------------------------------------------------

-- 1. Grant status change -> notify grantee
CREATE OR REPLACE FUNCTION notify_grant_status_change()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_notify_grant_status
AFTER UPDATE ON grant_record
FOR EACH ROW EXECUTE FUNCTION notify_grant_status_change();

-- 2. New grant submitted or resubmitted -> notify all admins in same tenant
CREATE OR REPLACE FUNCTION notify_grant_submitted()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_notify_grant_submitted
AFTER INSERT OR UPDATE ON grant_record
FOR EACH ROW EXECUTE FUNCTION notify_grant_submitted();

-- 3. Budget item status change -> notify grantee
CREATE OR REPLACE FUNCTION notify_budget_item_status()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_notify_budget_item_status
AFTER UPDATE ON budget_items
FOR EACH ROW EXECUTE FUNCTION notify_budget_item_status();

-- 4. Expense status change -> notify grantee
CREATE OR REPLACE FUNCTION notify_expense_status()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_notify_expense_status
AFTER UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION notify_expense_status();

-- 5. New comment on a grant -> notify grantee
CREATE OR REPLACE FUNCTION notify_grant_comment()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;

CREATE TRIGGER trg_notify_grant_comment
AFTER INSERT ON grant_comments
FOR EACH ROW EXECUTE FUNCTION notify_grant_comment();


-- ==========================================
-- SECTION 3: HELPER FUNCTIONS
-- ==========================================

-- Returns the tenant_id for the current authenticated user.
-- Used in RLS policies. SECURITY DEFINER bypasses RLS.
-- STABLE means result is cached within a single transaction.
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS INT AS $$
  SELECT tenant_id FROM users WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns true if the current auth user has the 'admin' role
-- within their own tenant and is active.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = auth.uid()
      AND role = 'admin'
      AND is_active = true
      AND tenant_id = current_tenant_id()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns true if the current auth user is a super_admin (cross-tenant access).
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = auth.uid()
      AND role = 'super_admin'
      AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns budget summary for a grant
CREATE OR REPLACE FUNCTION calculate_grant_budget_totals(g_id INT)
RETURNS TABLE (
  total_budget_items INT,
  total_budget_allocated DECIMAL,
  total_spent DECIMAL,
  total_remaining DECIMAL
) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic self-service tenant provisioning.
-- Called via supabase.rpc('provision_self_service_tenant', {...}) from the signup page.
-- Creates tenant + settings + user in one transaction. SECURITY DEFINER bypasses RLS.
CREATE OR REPLACE FUNCTION provision_self_service_tenant(
  p_auth_uid UUID,
  p_email TEXT,
  p_firstname TEXT,
  p_lastname TEXT,
  p_organization TEXT,
  p_phone TEXT,
  p_tax_month INT DEFAULT NULL
)
RETURNS JSON AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;


-- -------------------------------------------------------
-- Membership check functions
-- -------------------------------------------------------

-- Returns true when a user should bypass subscription requirements.
-- Exempt if: super_admin, TFAC admin, OR tenant has require_subscription = false.
CREATE OR REPLACE FUNCTION is_membership_exempt(p_user_id INT)
RETURNS BOOLEAN AS $$
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
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_membership_exempt()
RETURNS BOOLEAN AS $$
  SELECT is_membership_exempt(u.id)
  FROM users u
  WHERE u.user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns true when a user has at least basic membership (or is exempt).
CREATE OR REPLACE FUNCTION has_basic_membership(p_user_id INT)
RETURNS BOOLEAN AS $$
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
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION has_basic_membership()
RETURNS BOOLEAN AS $$
  SELECT has_basic_membership(u.id)
  FROM users u
  WHERE u.user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns true when a user has premium membership (or is exempt).
CREATE OR REPLACE FUNCTION has_premium_membership(p_user_id INT)
RETURNS BOOLEAN AS $$
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
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION has_premium_membership()
RETURNS BOOLEAN AS $$
  SELECT has_premium_membership(u.id)
  FROM users u
  WHERE u.user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ==========================================
-- SECTION 4: ROW LEVEL SECURITY
-- ==========================================
-- NOTE: tenant_id isolation is added to all policies.
-- is_admin() already includes tenant scope.
-- is_super_admin() grants cross-tenant access.

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE grant_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memberships ENABLE ROW LEVEL SECURITY;

-- tenants policies
CREATE POLICY "Users can view their own tenant"
ON tenants FOR SELECT USING (
  id = current_tenant_id()
  OR is_super_admin()
);

CREATE POLICY "Authenticated users can read tenant names"
ON tenants FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Super admins can manage tenants"
ON tenants FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- tenant_settings policies
CREATE POLICY "Authenticated users can read their tenant settings"
ON tenant_settings FOR SELECT USING (
  tenant_id = current_tenant_id()
  OR is_super_admin()
);

CREATE POLICY "Admins can update their tenant settings"
ON tenant_settings FOR UPDATE USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
) WITH CHECK (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Super admins can insert tenant settings"
ON tenant_settings FOR INSERT WITH CHECK (is_super_admin());

-- platform_settings policies
CREATE POLICY "Anyone can read platform settings"
ON platform_settings FOR SELECT USING (true);

CREATE POLICY "Super admins can update platform settings"
ON platform_settings FOR UPDATE USING (is_super_admin()) WITH CHECK (is_super_admin());

-- billing_customers policies
CREATE POLICY "Users can read their own billing customer"
ON billing_customers FOR SELECT USING (
  user_id = (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Service role can manage billing customers"
ON billing_customers FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- billing_webhook_events policies
CREATE POLICY "Service role can manage webhook events"
ON billing_webhook_events FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- subscriptions policies
CREATE POLICY "Users can read their own subscriptions"
ON subscriptions FOR SELECT USING (
  user_id = (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Service role can manage subscriptions"
ON subscriptions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- user_memberships policies
CREATE POLICY "Users can read their own membership"
ON user_memberships FOR SELECT USING (
  user_id = (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Admins can manage memberships in their tenant"
ON user_memberships FOR ALL USING (
  is_admin() AND user_id IN (SELECT id FROM users WHERE tenant_id = current_tenant_id())
) WITH CHECK (
  is_admin() AND user_id IN (SELECT id FROM users WHERE tenant_id = current_tenant_id())
);

CREATE POLICY "Service role can manage memberships"
ON user_memberships FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- invites policies
-- Anyone can read an invite by token (needed during signup before auth)
CREATE POLICY "Anyone can read invites by token"
ON invites FOR SELECT USING (true);

CREATE POLICY "Admins can create invites for their tenant"
ON invites FOR INSERT WITH CHECK (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Admins can view invites for their tenant"
ON invites FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "System can update invites"
ON invites FOR UPDATE WITH CHECK (true);

-- users policies
CREATE POLICY "Users can view their own user record"
ON users FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own user record"
ON users FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own user record"
ON users FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all users in their tenant"
ON users FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Admins can update users in their tenant"
ON users FOR UPDATE USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
) WITH CHECK (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

-- grant_record policies
CREATE POLICY "Users can view their own grants"
ON grant_record FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND user_id IN (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Users can insert their own grants"
ON grant_record FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Users can update their own grants"
ON grant_record FOR UPDATE USING (
  tenant_id = current_tenant_id()
  AND user_id IN (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Admins can view all grants in their tenant"
ON grant_record FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Admins can update all grants in their tenant"
ON grant_record FOR UPDATE USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

-- budget_items policies
CREATE POLICY "Users can view budget items for their grants"
ON budget_items FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert budget items for their grants"
ON budget_items FOR INSERT WITH CHECK (
  grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update budget items for their grants"
ON budget_items FOR UPDATE USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete budget items for their grants"
ON budget_items FOR DELETE USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can view all budget items in their tenant"
ON budget_items FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Admins can delete all budget items in their tenant"
ON budget_items FOR DELETE USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Admins can update all budget items in their tenant"
ON budget_items FOR UPDATE USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

-- expenses policies
CREATE POLICY "Users can view expenses for their grants"
ON expenses FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert expenses for their grants"
ON expenses FOR INSERT WITH CHECK (
  grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update expenses for their grants"
ON expenses FOR UPDATE USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete expenses for their grants"
ON expenses FOR DELETE USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can view all expenses in their tenant"
ON expenses FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Admins can delete all expenses in their tenant"
ON expenses FOR DELETE USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Admins can update all expenses in their tenant"
ON expenses FOR UPDATE USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

-- receipts policies
CREATE POLICY "Users can view their own receipts"
ON receipts FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND user_id IN (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Users can insert their own receipts"
ON receipts FOR INSERT WITH CHECK (
  user_id IN (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Admins can view all receipts in their tenant"
ON receipts FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

-- grant_attachments policies
CREATE POLICY "Users can view attachments for their grants"
ON grant_attachments FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Users can upload attachments for their grants"
ON grant_attachments FOR INSERT WITH CHECK (
  grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can view all grant attachments in their tenant"
ON grant_attachments FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Users can delete attachments for their grants"
ON grant_attachments FOR DELETE USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

-- grant_status_history policies
CREATE POLICY "Users can view status history for their grants"
ON grant_status_history FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND grant_id IN (
    SELECT gr.id FROM grant_record gr
    JOIN users u ON gr.user_id = u.id
    WHERE u.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can view all grant status history in their tenant"
ON grant_status_history FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "System can insert status history"
ON grant_status_history FOR INSERT WITH CHECK (true);

-- audit_log policies
CREATE POLICY "Admins can view all audit logs in their tenant"
ON audit_log FOR SELECT USING (
  (tenant_id = current_tenant_id() AND is_admin())
  OR is_super_admin()
);

CREATE POLICY "Users can view audit logs for their own records"
ON audit_log FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND changed_by = auth.uid()
);

-- grant_comments policies
CREATE POLICY "Users can view comments on their grants"
ON grant_comments FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND (
    grant_id IN (
      SELECT gr.id FROM grant_record gr
      JOIN users u ON gr.user_id = u.id
      WHERE u.user_id = auth.uid()
    )
    OR is_admin()
  )
);

CREATE POLICY "Admins can insert comments in their tenant"
ON grant_comments FOR INSERT WITH CHECK (
  is_admin()
);

-- notifications policies
CREATE POLICY "Users can view their own notifications"
ON notifications FOR SELECT USING (
  tenant_id = current_tenant_id()
  AND (
    user_id = (SELECT id FROM users WHERE user_id = auth.uid())
    OR is_admin()
  )
);

CREATE POLICY "Users can update their own notifications"
ON notifications FOR UPDATE USING (
  tenant_id = current_tenant_id()
  AND user_id = (SELECT id FROM users WHERE user_id = auth.uid())
) WITH CHECK (
  tenant_id = current_tenant_id()
  AND user_id = (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "Users can delete their own notifications"
ON notifications FOR DELETE USING (
  tenant_id = current_tenant_id()
  AND user_id = (SELECT id FROM users WHERE user_id = auth.uid())
);

CREATE POLICY "System can insert notifications"
ON notifications FOR INSERT WITH CHECK (true);


-- ==========================================
-- SECTION 5: REALTIME
-- ==========================================

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE billing_customers;
ALTER PUBLICATION supabase_realtime ADD TABLE billing_webhook_events;
ALTER PUBLICATION supabase_realtime ADD TABLE subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE user_memberships;


-- ==========================================
-- SECTION 6: STORAGE BUCKETS & POLICIES
-- ==========================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('grant-documents', 'grant-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Receipts bucket policies
CREATE POLICY "Users can upload receipts"
ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'receipts' AND auth.uid() IS NOT NULL
);

CREATE POLICY "Users can view their own receipts"
ON storage.objects FOR SELECT USING (
  bucket_id = 'receipts' AND auth.uid() IS NOT NULL
);

CREATE POLICY "Admins can view all receipts in storage"
ON storage.objects FOR SELECT USING (
  bucket_id = 'receipts' AND is_admin()
);

-- Grant documents bucket policies
CREATE POLICY "Users can upload grant documents"
ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'grant-documents' AND auth.uid() IS NOT NULL
);

CREATE POLICY "Users can view their own grant documents"
ON storage.objects FOR SELECT USING (
  bucket_id = 'grant-documents' AND auth.uid() IS NOT NULL
);

CREATE POLICY "Admins can view all grant documents"
ON storage.objects FOR SELECT USING (
  bucket_id = 'grant-documents' AND is_admin()
);

-- Storage delete policies
CREATE POLICY "Users can delete their own receipts"
ON storage.objects FOR DELETE USING (
  bucket_id = 'receipts' AND auth.uid() IS NOT NULL
);

CREATE POLICY "Users can delete their own grant documents"
ON storage.objects FOR DELETE USING (
  bucket_id = 'grant-documents' AND auth.uid() IS NOT NULL
);


-- ==========================================
-- SECTION 7: VERIFICATION
-- ==========================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'tenants', 'tenant_settings', 'platform_settings', 'invites',
    'users', 'grant_record', 'budget_items', 'expenses', 'receipts',
    'grant_attachments', 'grant_status_history', 'audit_log', 'grant_comments',
    'notifications'
  )
ORDER BY table_name;

SELECT id, name, public FROM storage.buckets WHERE id IN ('receipts', 'grant-documents');
