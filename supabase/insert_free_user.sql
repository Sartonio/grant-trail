INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'free.user@example.com', crypt('password123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '{"sub":"00000000-0000-0000-0000-000000000011","email":"free.user@example.com"}', 'email', now(), now(), now());

INSERT INTO users (user_id, tenant_id, firstname, lastname, organization_name, email, phone_number, role)
VALUES ('00000000-0000-0000-0000-000000000011', (SELECT id FROM tenants WHERE slug = 'tfac'), 'Free', 'User', 'No Org', 'free.user@example.com', '000-000-0000', 'grantee');
