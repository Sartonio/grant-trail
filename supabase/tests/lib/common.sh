# shellcheck shell=bash
#
# Shared assertion helpers for supabase/tests/*.test.sh.
#
# These were copy-pasted (byte-identical modulo whitespace) across
# rls-adversarial, charity-directory-rls, and platform-root-config. They mutate
# the caller's `pass` / `fail` counters, which each sourcing script declares.
#
# Only the genuinely-identical helpers live here. The psql_* runners differ
# per file (e.g. psql_as is 2-arg in rls-adversarial vs 3-arg in
# charity-directory), so those stay local — do NOT lift them.

# assert_eq <name> <expected> <actual>
assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name  (expected [$expected], got [$actual])"; fail=$((fail + 1))
  fi
}

# assert_contains <name> <needle> <haystack>
assert_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "PASS: $name"; pass=$((pass + 1))
  else
    echo "FAIL: $name  (expected to contain [$needle], got [$haystack])"; fail=$((fail + 1))
  fi
}
