#!/usr/bin/env bash
#
# verify:changed — run only the security tiers a diff actually touches.
#
# The fast tier (lint + typecheck + unit) always runs; it's cheap. Each stack
# tier runs only if the changed files match its path heuristic below. Usage:
#
#   npm run verify:changed            # vs origin/main (merge-base)
#   npm run verify:changed -- HEAD~3  # vs an explicit base ref
#
# This is a PRE-PUSH convenience, not a replacement for verify:full. The
# path->tier mapping is a heuristic: a lib/policy.js change *could* need e2e even
# if a matcher misses a rename, so CI must still run the full verify:full gate.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source scripts/verify-lib.sh

BASE="${1:-origin/main}"
# Diff against the merge-base so we only see THIS branch's edits, plus anything
# uncommitted/staged. Fall back to a plain diff if the base ref is unknown.
if git rev-parse --verify --quiet "$BASE" >/dev/null; then
  changed=$( { git diff --name-only "$BASE"...HEAD; git diff --name-only HEAD; git diff --name-only --staged; } | sort -u )
else
  echo "WARN: base ref '$BASE' not found — diffing working tree only."
  changed=$( { git diff --name-only HEAD; git diff --name-only --staged; } | sort -u )
fi

if [ -z "$changed" ]; then
  echo "No changed files vs $BASE — running fast tier only."
fi

# Which stack tiers does the diff imply? (grep -q, so order/dupes don't matter.)
want_sql=0 want_edge=0 want_stripe=0 want_e2e=0 want_edge_static=0
grep -qE '^supabase/(migrations|tests)/'                 <<<"$changed" && want_sql=1
grep -qE '^supabase/functions/'                          <<<"$changed" && { want_edge=1; want_stripe=1; want_edge_static=1; }
grep -qE 'lib/billing\.js'                               <<<"$changed" && want_stripe=1
grep -qE 'lib/(policy|guards|useWriteGuard)\.js'         <<<"$changed" && want_e2e=1
# Data-mutating components are the e2e-worthy UI: create/edit/modal/expense/grant flows.
grep -qE 'components/.*(Create|Edit|Modal|Expense|Grant|Subscription|Complete|SignUp).*\.js$' <<<"$changed" && want_e2e=1

echo "==> changed files vs $BASE:"
printf '%s\n' "$changed" | sed 's/^/    /'
echo "==> tiers: fast$([ $want_edge_static = 1 ] && echo ' + edge-static')$([ $want_sql = 1 ] && echo ' + sql')$([ $want_edge = 1 ] && echo ' + edge')$([ $want_stripe = 1 ] && echo ' + stripe')$([ $want_e2e = 1 ] && echo ' + e2e')"

fail=0
vf_fast
# edge-static is a static gate (no Docker/stack) — run it here alongside fast.
[ "$want_edge_static" = 1 ] && vf_edge_static
[ "$fail" -eq 0 ] || exit 1

# No stack tier requested -> done (and no need to boot Docker).
if [ "$want_sql$want_edge$want_stripe$want_e2e" = "0000" ]; then
  exit 0
fi

vf_have_docker || exit 0
sl_acquire "npm run verify:changed" || exit 1
vf_boot_stack

[ "$want_sql"    = 1 ] && vf_sql
[ "$want_edge"   = 1 ] && vf_edge_identity
[ "$want_stripe" = 1 ] && vf_stripe_matrix
[ "$want_e2e"    = 1 ] && vf_e2e

exit $fail
