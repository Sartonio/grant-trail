# shellcheck shell=bash
#
# Shared assertion helpers + stack preflight for supabase/tests/*.test.sh.
#
# These were copy-pasted (byte-identical modulo whitespace) across
# rls-adversarial, charity-directory-rls, and platform-root-config. They mutate
# the caller's `pass` / `fail` counters, which each sourcing script declares.
#
# Only the genuinely-identical helpers live here. The psql_* runners differ
# per file (e.g. psql_as is 2-arg in rls-adversarial vs 3-arg in
# charity-directory), so those stay local — do NOT lift them.

# DB_CONTAINER — derived from supabase/config.toml's `project_id = "…"` line so
# the container name lives in exactly one place. Falls back to "grant-trail" if
# parsing fails (e.g. the line moves or the file is absent).
PROJECT_ID="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$(dirname "${BASH_SOURCE[0]}")/../../config.toml" 2>/dev/null | head -n1)"
PROJECT_ID="${PROJECT_ID:-grant-trail}"
export DB_CONTAINER="supabase_db_${PROJECT_ID}"

# require_stack [container] — preflight: verify the local Supabase Postgres
# container is up and answering before running any tests. Without this, every
# psql_* runner's `docker exec … 2>&1` turns "No such container" into dozens of
# confusing FAIL lines instead of one clear infra error.
require_stack() {
  local container="${1:-$DB_CONTAINER}"
  if ! docker exec "$container" psql -U postgres -d postgres -tA -c 'select 1' >/dev/null 2>&1; then
    echo "ERROR: local Supabase stack not running — run: npm run db:start (then npm run db:reset)" >&2
    exit 1
  fi
}

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
