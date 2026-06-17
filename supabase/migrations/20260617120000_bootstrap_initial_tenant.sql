-- ==========================================
-- Bootstrap data (platform + initial tenant)
-- ==========================================
-- Seeds the minimum data the app needs on a fresh database. initial_schema is a
-- pure schema baseline (generated from a dump, no data rows), so all bootstrap
-- DATA lives here. Runs via the Supabase GitHub integration on merge to
-- production, because seed files are NOT merged to production by the integration.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-running is a no-op. No user/admin
-- accounts are created here — admins are still promoted via the signup UI +
-- `npm run admin:promote <email>` flow.

-- Single platform_settings row. Product IDs are intentionally NULL here and set
-- per-environment (super_admin / Stripe env vars); the seed sets them locally.
INSERT INTO platform_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Storage buckets for receipt and grant-document uploads.
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('grant-documents', 'grant-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Create initial tenant
INSERT INTO tenants (name, slug, tenant_type)
VALUES ('The Family Advocates Canada', 'tfac', 'managed')
ON CONFLICT (slug) DO NOTHING;

-- Create its settings row
INSERT INTO tenant_settings (tenant_id)
VALUES ((SELECT id FROM tenants WHERE slug = 'tfac'))
ON CONFLICT (tenant_id) DO NOTHING;
