#!/usr/bin/env bash
#
# WS7.1 — RLS adversarial audit proof tests.
#
# Proves the multi-tenant RLS model holds against an authenticated attacker:
#   * a user in tenant A cannot READ tenant B's rows,
#   * a user in tenant A cannot WRITE tenant B's rows,
#   * a 'grantee' cannot escalate to 'admin' / 'super_admin' (or hop tenants).
#
# Style mirrors supabase/functions/tests/*.test.sh: drives the local Supabase
# Postgres via `docker exec ... psql`. RLS is simulated exactly as PostgREST does
# it — `SET LOCAL ROLE authenticated` plus a request.jwt.claims GUC carrying the
# attacker's auth uid (auth.uid() reads that claim).
#
# Fixture: the committed seed (supabase/seed.sql) already provides a multi-tenant
# layout we reuse:
#   tenant 1 tfac            (managed)       : grantees + admin + super_admin
#   tenant 2 bright-horizons (managed)       : grantees + admin
#   tenant 3 lopez-consulting(self_service)  : grantee
# Known auth uids (…0001 grantee@tfac, …0006 grantee@bright, …0008 admin@bright,
# …0002 grantee@tfac, …0009 grantee@self_service, …0005 super_admin@tfac).
#
# Prerequisites (local only — never touches production):
#   npm run db:reset      # apply all migrations + seed fresh
#
# Run:  bash supabase/tests/rls-adversarial.test.sh

set -uo pipefail

PROJECT_ID="grant-trail"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

GRANTEE_TFAC='00000000-0000-0000-0000-000000000001'   # tenant 1, grantee
GRANTEE_TFAC2='00000000-0000-0000-0000-000000000002'  # tenant 1, grantee
SUPER_TFAC='00000000-0000-0000-0000-000000000005'     # tenant 1, super_admin
GRANTEE_BRIGHT='00000000-0000-0000-0000-000000000006' # tenant 2, grantee
ADMIN_BRIGHT='00000000-0000-0000-0000-000000000008'   # tenant 2, admin
GRANTEE_SELF='00000000-0000-0000-0000-000000000009'   # tenant 3 (self_service), grantee

pass=0
fail=0

# psql_as <auth_uid> <sql>  — run <sql> as the given authenticated user (RLS on),
# inside a rolled-back transaction. Prints the scalar result on stdout.
psql_as() {
  local uid="$1" sql="$2"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0 <<SQL 2>&1
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','${uid}','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
${sql}
ROLLBACK;
SQL
}

# psql_setup_anon <setup_sql> <assert_sql> — plant <setup_sql> as postgres, then
# run <assert_sql> as the unauthenticated `anon` role (RLS on), all in ONE
# rolled-back transaction. No auth.uid() claim is set. Prints the assert result.
psql_setup_anon() {
  local setup="$1" assert="$2"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0 <<SQL 2>&1
BEGIN;
${setup}
SELECT set_config('request.jwt.claims',
  json_build_object('role','anon')::text, true);
SET LOCAL ROLE anon;
${assert}
ROLLBACK;
SQL
}

# psql_setup_as <auth_uid> <setup_sql> <assert_sql> — run privileged <setup_sql>
# as postgres (to plant fixtures storage/RLS can't insert), then run <assert_sql>
# as the given authenticated user, all in ONE rolled-back transaction so nothing
# persists. Prints the assert query's result.
psql_setup_as() {
  local uid="$1" setup="$2" assert="$3"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0 <<SQL 2>&1
BEGIN;
${setup}
SELECT set_config('request.jwt.claims',
  json_build_object('sub','${uid}','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
${assert}
ROLLBACK;
SQL
}

# assert_eq / assert_contains are shared (see lib/common.sh).
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

echo "=============================================================="
echo " RLS adversarial audit — proof tests"
echo "=============================================================="

# --- TENANT READ ISOLATION --------------------------------------------------
out=$(psql_as "$GRANTEE_BRIGHT" "SELECT count(*) FROM grant_record WHERE tenant_id = 1;")
assert_eq "tenant-B grantee cannot READ tenant-A grants" "0" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"

out=$(psql_as "$GRANTEE_BRIGHT" "SELECT count(*) FROM users WHERE tenant_id = 1;")
assert_eq "tenant-B grantee cannot READ tenant-A users" "0" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"

out=$(psql_as "$GRANTEE_BRIGHT" "SELECT count(*) FROM budget_items WHERE tenant_id = 1;")
assert_eq "tenant-B grantee cannot READ tenant-A budget_items" "0" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"

out=$(psql_as "$GRANTEE_BRIGHT" "SELECT count(*) FROM expenses WHERE tenant_id = 1;")
assert_eq "tenant-B grantee cannot READ tenant-A expenses" "0" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"

out=$(psql_as "$ADMIN_BRIGHT" "SELECT count(*) FROM users WHERE tenant_id = 1;")
assert_eq "tenant-B ADMIN cannot READ tenant-A users" "0" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"

out=$(psql_as "$ADMIN_BRIGHT" "SELECT count(*) FROM grant_record WHERE tenant_id = 1;")
assert_eq "tenant-B ADMIN cannot READ tenant-A grants" "0" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"

# --- TENANT WRITE ISOLATION -------------------------------------------------
# Admin updating another tenant's users (rowcount must be 0; UPDATE prints UPDATE n)
out=$(psql_as "$ADMIN_BRIGHT" "UPDATE users SET role='grantee' WHERE tenant_id=1; GET DIAGNOSTICS;")
assert_contains "tenant-B ADMIN cannot WRITE tenant-A users (0 rows)" "UPDATE 0" "$out"

# Grantee inserting a grant with a FORGED tenant_id of another tenant must NOT
# land in that tenant: trigger force-derives tenant_id from the owner (tenant 2).
out=$(psql_as "$GRANTEE_BRIGHT" "
  INSERT INTO grant_record (tenant_id, user_id, grant_name, grant_amount)
  VALUES (1, (SELECT id FROM users WHERE user_id='${GRANTEE_BRIGHT}'), 'POISON', 100);
  SELECT count(*) FROM grant_record WHERE grant_name='POISON' AND tenant_id=1;")
assert_eq "grantee cannot plant a grant into another tenant (forged tenant_id)" "0" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

# --- VERTICAL PRIVILEGE ESCALATION (role) -----------------------------------
out=$(psql_as "$GRANTEE_BRIGHT" "
  UPDATE users SET role='super_admin' WHERE user_id='${GRANTEE_BRIGHT}';
  SELECT role FROM users WHERE user_id='${GRANTEE_BRIGHT}';")
assert_contains "grantee cannot self-escalate to super_admin" "Not allowed to change your own role" "$out"

out=$(psql_as "$GRANTEE_TFAC2" "
  UPDATE users SET role='admin' WHERE user_id='${GRANTEE_TFAC2}';
  SELECT role FROM users WHERE user_id='${GRANTEE_TFAC2}';")
assert_contains "managed-tenant grantee cannot self-escalate to admin" "Not allowed to change your own role" "$out"

out=$(psql_as "$GRANTEE_SELF" "
  UPDATE users SET role='admin' WHERE user_id='${GRANTEE_SELF}';
  SELECT role FROM users WHERE user_id='${GRANTEE_SELF}';")
assert_contains "self_service grantee cannot self-escalate to admin" "Not allowed to change your own role" "$out"

# --- HORIZONTAL ESCALATION (tenant hop) -------------------------------------
out=$(psql_as "$GRANTEE_BRIGHT" "
  UPDATE users SET tenant_id=1 WHERE user_id='${GRANTEE_BRIGHT}';
  SELECT tenant_id FROM users WHERE user_id='${GRANTEE_BRIGHT}';")
assert_contains "grantee cannot hop to another tenant (change own tenant_id)" "Not allowed to change your own tenant" "$out"

# --- SANITY: legitimate self-update of a non-privileged column still works ---
out=$(psql_as "$GRANTEE_BRIGHT" "
  UPDATE users SET phone_number='555-9999' WHERE user_id='${GRANTEE_BRIGHT}';
  SELECT phone_number FROM users WHERE user_id='${GRANTEE_BRIGHT}';")
assert_contains "grantee CAN still edit their own non-privileged fields" "555-9999" "$out"

# --- SANITY: admin can still legitimately manage their OWN tenant's users ----
out=$(psql_as "$ADMIN_BRIGHT" "
  UPDATE users SET phone_number='555-1234'
  WHERE tenant_id=2 AND role='grantee';
  GET DIAGNOSTICS;")
assert_contains "tenant admin can still manage own-tenant users" "UPDATE" "$out"

# ============================================================================
# D7 — `invites` token-scoped read (no anon enumeration)
# ============================================================================
# Plant two invites in two different tenants, then prove:
#   * anon CANNOT SELECT the invites table at all (no enumeration),
#   * anon CAN fetch exactly one invite by a valid token via the RPC,
#   * a bogus token returns zero rows,
#   * a valid token returns exactly the one matching row (not the other).
INV_SETUP="
INSERT INTO invites (tenant_id, token, role, email)
VALUES (1, '11111111-1111-1111-1111-111111111111', 'grantee', 'a@tfac.test'),
       (2, '22222222-2222-2222-2222-222222222222', 'grantee', 'b@bright.test');
"

# anon cannot enumerate the table (either denied by privilege => error, or 0 rows).
out=$(psql_setup_anon "$INV_SETUP" "SELECT count(*) FROM invites;")
# Accept either a permission-denied error or a hard 0 — both mean "no enumeration".
if [[ "$out" == *"permission denied"* ]]; then
  assert_contains "anon CANNOT enumerate invites (privilege revoked)" "permission denied" "$out"
else
  assert_eq "anon CANNOT enumerate invites (0 rows)" "0" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"
fi

# anon CAN fetch exactly one invite by a valid token via the RPC.
out=$(psql_setup_anon "$INV_SETUP" "SELECT count(*) FROM get_invite_by_token('11111111-1111-1111-1111-111111111111');")
assert_eq "anon CAN fetch exactly one invite by valid token via RPC" "1" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"

# The RPC returns the RIGHT invite (tenant 1's email, not tenant 2's).
out=$(psql_setup_anon "$INV_SETUP" "SELECT email FROM get_invite_by_token('11111111-1111-1111-1111-111111111111');")
assert_contains "RPC returns the matching invite's fields (tenant 1)" "a@tfac.test" "$out"

# A bogus token yields zero rows (no leak).
out=$(psql_setup_anon "$INV_SETUP" "SELECT count(*) FROM get_invite_by_token('99999999-9999-9999-9999-999999999999');")
assert_eq "anon gets zero rows for an unknown token" "0" "$(echo "$out" | grep -E '^[0-9]+$' | head -1)"

# --- consume_invite RPC: token-scoped, idempotent, on-behalf-of guard ----------
# A user holding a VALID token CAN consume that invite, stamping used_by=auth.uid.
out=$(psql_setup_as "$GRANTEE_TFAC" "$INV_SETUP" "
SELECT consume_invite('11111111-1111-1111-1111-111111111111', '${GRANTEE_TFAC}'::uuid);
RESET ROLE;
SELECT (used_by = '${GRANTEE_TFAC}'::uuid AND used_at IS NOT NULL)
  FROM invites WHERE token='11111111-1111-1111-1111-111111111111';")
assert_contains "user CAN consume their own invite via consume_invite RPC" "t" "$out"

# A caller CANNOT consume an invite on behalf of a DIFFERENT user (p_user_id != auth.uid()).
out=$(psql_setup_as "$GRANTEE_BRIGHT" "$INV_SETUP" "
SELECT consume_invite('22222222-2222-2222-2222-222222222222', '${GRANTEE_TFAC}'::uuid);
RESET ROLE;
SELECT used_at IS NULL FROM invites WHERE token='22222222-2222-2222-2222-222222222222';")
assert_contains "user CANNOT consume an invite on behalf of another user" "Not allowed to consume an invite on behalf of another user" "$out"
# …and the invite remains unconsumed.
assert_contains "invite stays unconsumed after on-behalf-of attempt" "t" "$out"

# consume_invite is idempotent: a second call on an already-used invite consumes nothing.
out=$(psql_setup_as "$GRANTEE_TFAC" "$INV_SETUP" "
SELECT consume_invite('11111111-1111-1111-1111-111111111111', '${GRANTEE_TFAC}'::uuid);
SELECT consume_invite('11111111-1111-1111-1111-111111111111', '${GRANTEE_TFAC}'::uuid);")
# First call -> t, second call (already used) -> f.
assert_contains "consume_invite is idempotent (re-consume returns false)" "f" "$out"

# ============================================================================
# D5 — storage objects are tenant-scoped
# ============================================================================
# Plant objects under both buckets using the real path convention:
#   grant-documents : attachments/<tenant_id>/<grant_id>/<file>
#   receipts        : receipts/<tenant_id>/<grant_id>/<expense_id>/<file>
# Tenant 1's object and tenant 2's object, then check cross-tenant isolation.
STORAGE_SETUP="
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES ('grant-documents', 'attachments/1/10/secret-t1.pdf', NULL),
       ('grant-documents', 'attachments/2/20/secret-t2.pdf', NULL),
       ('receipts',        'receipts/1/10/100/r-t1.png',     NULL),
       ('receipts',        'receipts/2/20/200/r-t2.png',     NULL);
"

# Tenant-A (tfac, tenant 1) grantee can READ tenant 1's object…
out=$(psql_setup_as "$GRANTEE_TFAC" "$STORAGE_SETUP" \
  "SELECT count(*) FROM storage.objects WHERE name='attachments/1/10/secret-t1.pdf';")
assert_eq "tenant-A grantee CAN read own-tenant grant document" "1" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

# …but CANNOT read tenant 2's object.
out=$(psql_setup_as "$GRANTEE_TFAC" "$STORAGE_SETUP" \
  "SELECT count(*) FROM storage.objects WHERE name='attachments/2/20/secret-t2.pdf';")
assert_eq "tenant-A grantee CANNOT read tenant-B grant document" "0" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

# Tenant-A grantee CANNOT delete tenant 2's object, CAN delete own-tenant object.
# storage.objects has a BEFORE-DELETE protect trigger that hard-aborts ANY direct
# SQL DELETE (even 0-row) — the real client deletes via the Storage API — so we
# cannot observe rowcounts. Instead we evaluate, as the authenticated grantee,
# the EXACT predicate the DELETE policy USES (tenant segment of the path ==
# caller's tenant). True => the policy authorizes the delete; false => denied.
out=$(psql_as "$GRANTEE_TFAC" "
  SELECT public.storage_object_tenant_id('attachments/2/20/secret-t2.pdf') = public.current_tenant_id();")
assert_eq "tenant-A grantee CANNOT delete tenant-B grant document (policy denies)" "f" "$(echo "$out" | grep -E '^[tf]$' | head -1)"

out=$(psql_as "$GRANTEE_TFAC" "
  SELECT public.storage_object_tenant_id('attachments/1/10/secret-t1.pdf') = public.current_tenant_id();")
assert_eq "tenant-A grantee CAN delete own-tenant grant document (policy allows)" "t" "$(echo "$out" | grep -E '^[tf]$' | head -1)"

# Same isolation for receipts: tenant-A cannot read tenant-B's receipt.
out=$(psql_setup_as "$GRANTEE_TFAC" "$STORAGE_SETUP" \
  "SELECT count(*) FROM storage.objects WHERE name='receipts/2/20/200/r-t2.png';")
assert_eq "tenant-A grantee CANNOT read tenant-B receipt" "0" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

out=$(psql_setup_as "$GRANTEE_TFAC" "$STORAGE_SETUP" \
  "SELECT count(*) FROM storage.objects WHERE name='receipts/1/10/100/r-t1.png';")
assert_eq "tenant-A grantee CAN read own-tenant receipt" "1" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

# Tenant-A grantee CANNOT plant a file into tenant 2's path: the INSERT violates
# the WITH CHECK on the upload policy and raises an RLS error.
out=$(psql_setup_as "$GRANTEE_TFAC" "" "
  INSERT INTO storage.objects (bucket_id, name) VALUES ('grant-documents','attachments/2/20/poison.pdf');")
assert_contains "tenant-A grantee CANNOT upload into tenant-B path" "violates row-level security policy" "$out"

# …but CAN upload into their own tenant's path.
out=$(psql_setup_as "$GRANTEE_TFAC" "" "
  INSERT INTO storage.objects (bucket_id, name) VALUES ('grant-documents','attachments/1/10/ok.pdf');
  SELECT count(*) FROM storage.objects WHERE name='attachments/1/10/ok.pdf';")
assert_eq "tenant-A grantee CAN upload into own-tenant path" "1" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

# super_admin (tenant-agnostic) CAN read across tenants.
out=$(psql_setup_as "$SUPER_TFAC" "$STORAGE_SETUP" \
  "SELECT count(*) FROM storage.objects WHERE name='attachments/2/20/secret-t2.pdf';")
assert_eq "super_admin CAN read another tenant's grant document" "1" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

# ============================================================================
# D4 — super_admin READ-ONLY ops access (billing/membership/notifications/etc.)
# ============================================================================
# The seed already provides billing_customers / subscriptions / user_memberships
# rows for tenant-1 grantees. Prove super_admin (tenant 1) can now SELECT them,
# and notifications + grant_comments too.

NOTIF_COMMENT_SETUP="
INSERT INTO notifications (user_id, tenant_id, type, title, message)
VALUES ((SELECT id FROM users WHERE user_id='${GRANTEE_TFAC}'), 1, 'info', 'T', 'M');
INSERT INTO grant_comments (grant_id, tenant_id, user_id, comment)
SELECT gr.id, 1, '${GRANTEE_TFAC}'::uuid, 'hello'
FROM grant_record gr WHERE gr.tenant_id=1 LIMIT 1;
"

out=$(psql_as "$SUPER_TFAC" "SELECT count(*) > 0 FROM subscriptions;")
assert_eq "super_admin CAN read subscriptions" "t" "$(echo "$out" | grep -E '^[tf]$' | head -1)"

out=$(psql_as "$SUPER_TFAC" "SELECT count(*) > 0 FROM user_memberships;")
assert_eq "super_admin CAN read user_memberships" "t" "$(echo "$out" | grep -E '^[tf]$' | head -1)"

out=$(psql_as "$SUPER_TFAC" "SELECT count(*) > 0 FROM billing_customers;")
assert_eq "super_admin CAN read billing_customers" "t" "$(echo "$out" | grep -E '^[tf]$' | head -1)"

out=$(psql_setup_as "$SUPER_TFAC" "$NOTIF_COMMENT_SETUP" \
  "SELECT count(*) FROM notifications WHERE title='T';")
assert_eq "super_admin CAN read notifications" "1" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

out=$(psql_setup_as "$SUPER_TFAC" "$NOTIF_COMMENT_SETUP" \
  "SELECT count(*) FROM grant_comments WHERE comment='hello';")
assert_eq "super_admin CAN read grant_comments" "1" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

# Negative: super_admin write to subscriptions must still be blocked (read-only).
out=$(psql_as "$SUPER_TFAC" "
  UPDATE subscriptions SET status='canceled' WHERE true; GET DIAGNOSTICS;")
assert_contains "super_admin CANNOT write subscriptions (read-only)" "UPDATE 0" "$out"

# ============================================================================
# Security audit F1 — self-INSERT privilege escalation on public.users
# ============================================================================
# A fresh authenticated identity with NO existing users row (the attacker just
# signed up via Supabase Auth). The BEFORE INSERT guard must reject ANY direct
# self-insert — it cannot be used to mint a super_admin, an admin, or to drop
# into another tenant. Legitimate signups go through the trusted SECURITY
# DEFINER RPCs (asserted as positive controls below).
ATTACKER='00000000-0000-0000-0000-0000000000ff'

out=$(psql_as "$ATTACKER" "
  INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, user_id, role)
  VALUES (1, 'E', 'V', 'evilorg', 'attacker-sa@x.test', '555', '${ATTACKER}', 'super_admin');
  SELECT 1;")
assert_contains "authed user CANNOT self-insert a super_admin row (F1)" \
  "Direct self-insert into users is not permitted" "$out"

out=$(psql_as "$ATTACKER" "
  INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, user_id, role)
  VALUES (1, 'E', 'V', 'evilorg', 'attacker-adm@x.test', '555', '${ATTACKER}', 'admin');
  SELECT 1;")
assert_contains "authed user CANNOT self-insert an admin row on a managed tenant (F1)" \
  "Direct self-insert into users is not permitted" "$out"

out=$(psql_as "$ATTACKER" "
  INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, user_id, role, is_active)
  VALUES (1, 'E', 'V', 'evilorg', 'attacker-x@x.test', '555', '${ATTACKER}', 'grantee', true);
  SELECT 1;")
assert_contains "authed user CANNOT self-insert into an arbitrary tenant (F1 horizontal)" \
  "Direct self-insert into users is not permitted" "$out"

# Positive control: legitimate self-service signup (trusted RPC) STILL works and
# yields a grantee. (Fresh auth identity, no users row yet.)
AUTH_SETUP="INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000','${ATTACKER}','authenticated','authenticated','newbie@example.com', crypt('x', gen_salt('bf')), now(), now());"

out=$(psql_setup_as "$ATTACKER" "$AUTH_SETUP" "
  SELECT provision_self_service_tenant('${ATTACKER}','newbie@example.com','New','Bie','Newbie Org','555', NULL)->>'role';")
assert_eq "legit self-service signup STILL creates a grantee (F1 positive control)" \
  "grantee" "$(echo "$out" | grep -E 'grantee|admin|super_admin' | tail -1)"

# Positive control: legitimate invite signup (trusted RPC) STILL works and the
# role/tenant are taken authoritatively from the invite (here an admin invite for
# the managed bright-horizons tenant 2), NOT from any client input.
INV_POS_SETUP="${AUTH_SETUP}
INSERT INTO invites (tenant_id, token, role, email)
VALUES (2, '44444444-4444-4444-4444-444444444444', 'admin', 'newbie@example.com');"

out=$(psql_setup_as "$ATTACKER" "$INV_POS_SETUP" "
  SELECT register_invited_user('44444444-4444-4444-4444-444444444444','New','Bie','Newbie Org','555', NULL)->>'role';")
assert_eq "legit invite signup STILL honors the invite's server-side role (F1 positive)" \
  "admin" "$(echo "$out" | grep -E 'grantee|admin|super_admin' | tail -1)"

out=$(psql_setup_as "$ATTACKER" "$INV_POS_SETUP" "
  SELECT register_invited_user('44444444-4444-4444-4444-444444444444','New','Bie','Newbie Org','555', NULL)->>'tenant_id';")
assert_eq "legit invite signup lands in the invite's tenant (F1 positive)" \
  "2" "$(echo "$out" | grep -E '^[0-9]+$' | tail -1)"

# ============================================================================
# Security audit F2 — invite tampering ("System can update invites" dropped)
# ============================================================================
# An authed user (tenant-2 grantee) must not be able to rewrite ANY invite.
INV_F2_SETUP="INSERT INTO invites (tenant_id, token, role, email)
VALUES (1, '33333333-3333-3333-3333-333333333333', 'grantee', 'victim@tfac.test');"

out=$(psql_setup_as "$GRANTEE_BRIGHT" "$INV_F2_SETUP" "
  UPDATE invites SET role='admin' WHERE token='33333333-3333-3333-3333-333333333333';
  GET DIAGNOSTICS;")
assert_contains "authed user CANNOT rewrite an arbitrary invite (F2)" "UPDATE 0" "$out"

# Positive control: a tenant admin can still CREATE invites for their own tenant.
out=$(psql_as "$ADMIN_BRIGHT" "
  INSERT INTO invites (tenant_id, role, email) VALUES (2, 'grantee', 'fresh@bright.test');
  GET DIAGNOSTICS;")
assert_contains "tenant admin can STILL create invites for own tenant (F2 positive)" "INSERT 0 1" "$out"

# ============================================================================
# Security audit F3 — notification forgery ("System can insert notifications" dropped)
# ============================================================================
# An authed user cannot forge a notification (not even one targeting themselves);
# the only writers are SECURITY DEFINER triggers, which bypass RLS. (The trigger
# path itself is proven still-working by grant-trigger-behaviors.test.sh.)
out=$(psql_as "$GRANTEE_BRIGHT" "
  INSERT INTO notifications (tenant_id, user_id, type, title, message, link)
  VALUES (2, (SELECT id FROM users WHERE user_id='${GRANTEE_BRIGHT}'),
          'phish', 'Grant Approved', 'Click to claim', 'http://evil.test');
  SELECT 1;")
assert_contains "authed user CANNOT forge a notification (F3)" \
  "violates row-level security policy" "$out"

echo "=============================================================="
echo " RESULTS: ${pass} passed, ${fail} failed"
echo "=============================================================="
[[ "$fail" -eq 0 ]]
