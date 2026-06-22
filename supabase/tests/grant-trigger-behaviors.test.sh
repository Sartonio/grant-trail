#!/usr/bin/env bash
#
# Grant lifecycle trigger-behavior proof tests.
#
# Proves the DB-level product rules that the LS1 e2e walkthrough specs used to
# assert through the browser. These are pure trigger / function behaviors, so we
# test them directly against Postgres — far faster and less brittle than driving
# the UI:
#   * auto_approve_grant / _budget_item / _expense  — a row inserted into a tenant
#     whose tenant_settings.require_*_approval is false is forced to 'approved';
#     a tenant that requires approval leaves it 'pending'.
#   * update_budget_item_totals / update_grant_record_totals — only *approved*
#     expenses roll up into budget_items.amount_spent and grant_record.total_spent.
#   * is_membership_exempt(user) — super_admin, TFAC admins, and members of a
#     tenant with require_subscription = false are exempt; an ordinary grantee in
#     a subscription-gated tenant is not.
#   * notify_grant_submitted — INSERT of a 'pending' grant notifies tenant admins
#     ('grant_submitted'); a needs_changes -> pending UPDATE notifies them again
#     ('grant_resubmitted').
#
# NOT covered here (intentionally — these are app-side, not DB triggers, and are
# verified elsewhere):
#   * needs_changes -> pending transition itself        (frontend AdminGrantReview / CreateGrant)
#   * budget-item reject -> expense reset cascade        (frontend AdminGrantReview.js; cross-role e2e)
#
# Style mirrors supabase/tests/rls-adversarial.test.sh: drives the local Supabase
# Postgres via `docker exec ... psql`. Every test runs inside a BEGIN/ROLLBACK
# transaction so the committed seed is never mutated.
#
# Fixture (committed supabase/seed.sql, verified live):
#   tenant 1 tfac            managed      require_*_approval = t, require_subscription = t
#   tenant 2 bright-horizons managed      require_*_approval = t
#   tenant 3 lopez-consulting self_service require_*_approval = f, require_subscription = t
#   users: 1 grantee@tfac, 4 admin@tfac, 5 super_admin@tfac, 9 grantee@lopez (self_service)
#
# Prerequisites (local only — never touches production):
#   npm --prefix frontend run db:reset    # apply all migrations + seed fresh
#
# Run:  bash supabase/tests/grant-trigger-behaviors.test.sh

set -uo pipefail

PROJECT_ID="grant-trail"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

# Fixture ids (public.users.id / public.tenants.id — integers, not auth uids).
T_MANAGED=1       # tfac, require_*_approval = true
T_SELFSERVE=3     # lopez-consulting, require_*_approval = false
U_GRANTEE_TFAC=1  # ordinary grantee in a subscription-gated managed tenant
U_ADMIN_TFAC=4    # TFAC admin (exempt by tenant slug)
U_SUPER=5         # super_admin (always exempt)
U_GRANTEE_SELF=9  # grantee in a self_service tenant

pass=0
fail=0

# psql_tx <sql> — run <sql> as the table owner inside a rolled-back transaction
# (triggers are SECURITY DEFINER and fire regardless of role). The caller's SQL
# should `SELECT` exactly one scalar last; it is printed on stdout. `-q`
# suppresses the BEGIN/INSERT/ROLLBACK command tags so only query rows remain,
# and we take the final row as the asserted scalar.
psql_tx() {
  local sql="$1"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 <<SQL 2>&1 | tail -n1
BEGIN;
${sql}
ROLLBACK;
SQL
}

# check <description> <actual> <expected>
check() {
  local desc="$1" actual="$2" expected="$3"
  actual="$(echo "$actual" | tr -d '[:space:]')"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  \033[32mPASS\033[0m %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  \033[31mFAIL\033[0m %s\n        expected=[%s] got=[%s]\n' "$desc" "$expected" "$actual"
  fi
}

echo "== auto_approve_grant =="
check "managed tenant (require_grant_approval=t) keeps a new grant pending" \
  "$(psql_tx "INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
              VALUES (${T_MANAGED}, ${U_GRANTEE_TFAC}, 'trg-test', 'pending')
              RETURNING status;")" "pending"

check "self_service tenant (require_grant_approval=f) auto-approves a new grant" \
  "$(psql_tx "INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
              VALUES (${T_SELFSERVE}, ${U_GRANTEE_SELF}, 'trg-test', 'pending')
              RETURNING status;")" "approved"

echo "== auto_approve_budget_item / auto_approve_expense =="
check "self_service budget item auto-approves" \
  "$(psql_tx "WITH g AS (
                INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
                VALUES (${T_SELFSERVE}, ${U_GRANTEE_SELF}, 'trg-test', 'pending') RETURNING id)
              INSERT INTO budget_items (tenant_id, grant_id, item_name, status)
              SELECT ${T_SELFSERVE}, g.id, 'bi', 'pending' FROM g
              RETURNING status;")" "approved"

check "managed budget item stays pending" \
  "$(psql_tx "WITH g AS (
                INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
                VALUES (${T_MANAGED}, ${U_GRANTEE_TFAC}, 'trg-test', 'pending') RETURNING id)
              INSERT INTO budget_items (tenant_id, grant_id, item_name, status)
              SELECT ${T_MANAGED}, g.id, 'bi', 'pending' FROM g
              RETURNING status;")" "pending"

check "self_service expense auto-approves" \
  "$(psql_tx "WITH g AS (
                INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
                VALUES (${T_SELFSERVE}, ${U_GRANTEE_SELF}, 'trg-test', 'pending') RETURNING id)
              INSERT INTO expenses (tenant_id, grant_id, item_name, amount_spent, status)
              SELECT ${T_SELFSERVE}, g.id, 'e', 10, 'pending' FROM g
              RETURNING status;")" "approved"

echo "== totals roll up only approved expenses =="
# In the managed tenant nothing auto-approves. NOTE: the totals triggers fire
# AFTER the expense write, so each step must be its own statement — a single
# data-modifying CTE that then reads the same table sees only the pre-statement
# snapshot. We key rows by a sentinel grant_name within the rolled-back tx.
check "pending expense does not affect grant_record.total_spent" \
  "$(psql_tx "INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
                VALUES (${T_MANAGED}, ${U_GRANTEE_TFAC}, 'probe-a', 'pending');
              INSERT INTO budget_items (tenant_id, grant_id, item_name, status)
                SELECT ${T_MANAGED}, id, 'bi', 'pending' FROM grant_record WHERE grant_name = 'probe-a';
              INSERT INTO expenses (tenant_id, grant_id, budget_item_id, item_name, amount_spent, status)
                SELECT ${T_MANAGED}, gr.id, bi.id, 'e', 75, 'pending'
                FROM grant_record gr JOIN budget_items bi ON bi.grant_id = gr.id
                WHERE gr.grant_name = 'probe-a';
              SELECT total_spent FROM grant_record WHERE grant_name = 'probe-a';")" "0.00"

check "approving the expense rolls 75 into budget_items.amount_spent and grant_record.total_spent" \
  "$(psql_tx "INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
                VALUES (${T_MANAGED}, ${U_GRANTEE_TFAC}, 'probe-b', 'pending');
              INSERT INTO budget_items (tenant_id, grant_id, item_name, status)
                SELECT ${T_MANAGED}, id, 'bi', 'pending' FROM grant_record WHERE grant_name = 'probe-b';
              INSERT INTO expenses (tenant_id, grant_id, budget_item_id, item_name, amount_spent, status)
                SELECT ${T_MANAGED}, gr.id, bi.id, 'e', 75, 'pending'
                FROM grant_record gr JOIN budget_items bi ON bi.grant_id = gr.id
                WHERE gr.grant_name = 'probe-b';
              UPDATE expenses SET status = 'approved'
                WHERE grant_id = (SELECT id FROM grant_record WHERE grant_name = 'probe-b');
              SELECT bi.amount_spent || '/' || gr.total_spent
                FROM grant_record gr JOIN budget_items bi ON bi.grant_id = gr.id
                WHERE gr.grant_name = 'probe-b';")" "75.00/75.00"

echo "== is_membership_exempt precedence =="
check "super_admin is exempt" \
  "$(psql_tx "SELECT is_membership_exempt(${U_SUPER});")" "t"
check "TFAC admin is exempt (by tenant slug)" \
  "$(psql_tx "SELECT is_membership_exempt(${U_ADMIN_TFAC});")" "t"
check "ordinary grantee in a subscription-gated tenant is NOT exempt" \
  "$(psql_tx "SELECT is_membership_exempt(${U_GRANTEE_TFAC});")" "f"
check "grantee becomes exempt once tenant require_subscription flips to false" \
  "$(psql_tx "UPDATE tenant_settings SET require_subscription = false WHERE tenant_id = ${T_MANAGED};
              SELECT is_membership_exempt(${U_GRANTEE_TFAC});")" "t"

echo "== notify_grant_submitted =="
# Same AFTER-trigger visibility rule: insert the grant in one statement, then
# read the notifications it produced in the next.
check "inserting a pending grant notifies tenant admins (grant_submitted)" \
  "$(psql_tx "INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
                VALUES (${T_MANAGED}, ${U_GRANTEE_TFAC}, 'probe-n', 'pending');
              SELECT count(*) > 0 FROM notifications n
              JOIN users u ON u.id = n.user_id
              WHERE n.type = 'grant_submitted' AND u.role = 'admin' AND u.tenant_id = ${T_MANAGED}
                AND n.link = '/admin/grants/' || (SELECT id FROM grant_record WHERE grant_name = 'probe-n');")" "t"

check "needs_changes -> pending UPDATE notifies admins (grant_resubmitted)" \
  "$(psql_tx "INSERT INTO grant_record (tenant_id, user_id, grant_name, status)
                VALUES (${T_MANAGED}, ${U_GRANTEE_TFAC}, 'probe-r', 'needs_changes');
              UPDATE grant_record SET status = 'pending' WHERE grant_name = 'probe-r';
              SELECT count(*) FROM notifications
              WHERE type = 'grant_resubmitted'
                AND link = '/admin/grants/' || (SELECT id FROM grant_record WHERE grant_name = 'probe-r');")" "1"

echo ""
echo "== summary: ${pass} passed, ${fail} failed =="
[ "$fail" -eq 0 ]
