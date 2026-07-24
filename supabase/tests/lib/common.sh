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

# DB_CONTAINER / API_URL — derived from supabase/config.toml (per-worktree
# generated since Phase 2, see scripts/stack-env.sh) so the container name and
# API port live in exactly one place. Falls back to the canonical values if
# parsing fails (e.g. the line moves or the file is absent).
_CONFIG_TOML="$(dirname "${BASH_SOURCE[0]}")/../../config.toml"
PROJECT_ID="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$_CONFIG_TOML" 2>/dev/null | head -n1 || true)"
PROJECT_ID="${PROJECT_ID:-grant-trail}"
# The Supabase CLI truncates the project id at 40 chars when it names
# containers, so a long worktree name yields supabase_db_<first-40> on disk
# while the config still holds the full id. Reconstructing from the untruncated
# id targets a container that does not exist and every test aborts on the
# preflight. Apply the same cap here (kept in sync with SE_PROJECT_ID_MAX in
# scripts/stack-env.sh, which now also budgets ids to fit).
export DB_CONTAINER="supabase_db_$(printf %s "$PROJECT_ID" | cut -c1-40)"
_API_PORT="$(sed -n '/^\[api\]/,/^\[/s/^port[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' \
  "$_CONFIG_TOML" 2>/dev/null | head -n1 || true)"
export API_URL="${API_URL:-http://127.0.0.1:${_API_PORT:-54321}}"

# require_stack [container] — preflight: verify the local Supabase Postgres
# container is up and answering before running any tests. Without this, every
# psql_* runner's `docker exec … 2>&1` turns "No such container" into dozens of
# confusing FAIL lines instead of one clear infra error.
require_stack() {
  local container="${1:-$DB_CONTAINER}"
  if ! docker exec "$container" psql -U postgres -d postgres -tA -c 'select 1' >/dev/null 2>&1; then
    echo "ERROR: local Supabase stack not running (no container '${container}') — run: npm run db:start (then npm run db:reset)" >&2
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
