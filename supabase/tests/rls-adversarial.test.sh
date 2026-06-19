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

# assert_eq <name> <expected> <actual>
assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $name"
    pass=$((pass + 1))
  else
    echo "FAIL: $name  (expected [$expected], got [$actual])"
    fail=$((fail + 1))
  fi
}

# assert_contains <name> <needle> <haystack>
assert_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "PASS: $name"
    pass=$((pass + 1))
  else
    echo "FAIL: $name  (expected to contain [$needle], got [$haystack])"
    fail=$((fail + 1))
  fi
}

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

echo "=============================================================="
echo " RESULTS: ${pass} passed, ${fail} failed"
echo "=============================================================="
[[ "$fail" -eq 0 ]]
