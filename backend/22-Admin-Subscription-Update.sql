-- Applies the admin subscription rule to existing databases.
-- Non-TFAC admins now require the second subscription tier.

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