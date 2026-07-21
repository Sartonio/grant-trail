#!/usr/bin/env bash
#
# npm run e2e — Playwright against the ALREADY-RUNNING local stack, with the
# stack's env exported and args passed through (npm run e2e -- <spec> -g <pat>).
#
# Why this exists: the e2e fixtures need SUPABASE_SERVICE_ROLE_KEY /
# VITE_SUPABASE_URL / VITE_SUPABASE_KEY, which are deliberately NOT in
# frontend/.env.local (browser-safe values only). Running Playwright without
# them fails every spec in beforeAll with "supabaseKey is required". This
# wrapper sources them from the running stack (verify-lib's
# vf_export_stack_env), same as verify:full — values already exported by the
# caller are never overridden.
#
# Semantics vs verify:e2e (bash scripts/verify-lib.sh e2e): that tier takes the
# lock, boots the stack, and runs a destructive `db reset` before the suite —
# the pre-merge gate. THIS script is the fast iteration path: it holds the same
# cross-worktree lock while tests run but does NOT boot or reset; it requires
# the stack to already be up (npm run db:start) and errors out otherwise.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

source scripts/verify-lib.sh

sl_acquire "npm run e2e" || exit 1

if ! npx --prefix frontend supabase status >/dev/null 2>&1; then
  echo "ERROR: local Supabase stack is not running — start it with 'npm run db:start'" >&2
  echo "       (or run the full gate, which boots + resets it: npm run verify:e2e)" >&2
  exit 1
fi

vf_export_stack_env

npm run e2e --prefix frontend -- "$@"
