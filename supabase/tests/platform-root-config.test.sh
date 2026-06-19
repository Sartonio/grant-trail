#!/usr/bin/env bash
#
# GitHub #29 — proof tests for the config-driven platform-root tenant.
#
# Proves the hard-coded 'tfac' slug has been replaced by a configurable lookup:
#   * platform_root_slug() returns the configured value,
#   * a platform-root admin is membership-exempt while a non-root admin is not,
#   * re-pointing platform_settings.platform_root_slug moves the exemption,
#   * enforce_membership_eligibility still blocks billing a platform-root admin.
#
# Prerequisites: npm run db:reset
# Run:  bash supabase/tests/platform-root-config.test.sh

set -uo pipefail

PROJECT_ID="grant-trail"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

pass=0
fail=0

psql_scalar() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0 -c "$1" 2>&1
}

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name  (expected [$expected], got [$actual])"; fail=$((fail + 1))
  fi
}

echo "=============================================================="
echo " Platform-root config (#29) — proof tests"
echo "=============================================================="

# Default config points at 'tfac'.
out=$(psql_scalar "SELECT public.platform_root_slug();")
assert_eq "platform_root_slug() defaults to configured 'tfac'" "tfac" "$out"

# tfac admin (eric.hobbs, user id resolved by email) is exempt; bright admin is not.
out=$(psql_scalar "SELECT public.is_membership_exempt((SELECT id FROM users WHERE email='eric.hobbs@example.com'));")
assert_eq "platform-root (tfac) admin is membership-exempt" "t" "$out"

out=$(psql_scalar "SELECT public.is_membership_exempt((SELECT id FROM users WHERE email='amara.okafor@example.com'));")
assert_eq "non-root (bright-horizons) admin is NOT exempt" "f" "$out"

# Re-point the platform root to bright-horizons; exemption must follow the config.
out=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 <<'SQL' 2>&1
BEGIN;
UPDATE platform_settings SET platform_root_slug = 'bright-horizons' WHERE id = 1;
SELECT public.is_membership_exempt((SELECT id FROM users WHERE email='amara.okafor@example.com'))::text
    || ',' ||
    public.is_membership_exempt((SELECT id FROM users WHERE email='eric.hobbs@example.com'))::text;
ROLLBACK;
SQL
)
assert_eq "re-pointing config moves exemption (bright now exempt, tfac not)" \
  "true,false" "$(echo "$out" | grep -E '^(true|false),(true|false)$' | head -1)"

# enforce_membership_eligibility still refuses to bill a platform-root admin.
out=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0 <<'SQL' 2>&1
BEGIN;
INSERT INTO user_memberships (user_id, membership_tier, source)
VALUES ((SELECT id FROM users WHERE email='eric.hobbs@example.com'), 'basic', 'manual');
ROLLBACK;
SQL
)
if [[ "$out" == *"Cannot assign membership to platform-root admin"* ]]; then
  echo "PASS: cannot assign membership to platform-root admin"; pass=$((pass + 1))
else
  echo "FAIL: platform-root admin membership block  (got [$out])"; fail=$((fail + 1))
fi

# No hard-coded 'tfac' remains in the two re-pointed SECURITY DEFINER functions.
out=$(psql_scalar "SELECT count(*) FROM pg_proc WHERE proname IN ('enforce_membership_eligibility','is_membership_exempt') AND pg_get_functiondef(oid) ILIKE '%''tfac''%';")
assert_eq "no literal 'tfac' left in re-pointed functions" "0" "$out"

echo "=============================================================="
echo " RESULTS: ${pass} passed, ${fail} failed"
echo "=============================================================="
[[ "$fail" -eq 0 ]]
