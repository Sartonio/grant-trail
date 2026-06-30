#!/usr/bin/env bash
#
# Shared tier functions for verify-full.sh (run everything) and
# verify-changed.sh (run only the tiers a diff touches). Source this; don't
# execute it. Each tier reuses an existing standalone runner — no new test infra.
#
# Convention: tier functions set `fail=1` on failure (never exit) so a caller can
# run several and report the aggregate. The two stack prerequisites (Docker +
# booted stack) are helpers the caller invokes once before any stack tier.

# --- prerequisites ----------------------------------------------------------

# Returns non-zero (and warns) when Docker isn't available, so callers can
# fail-open and SKIP the stack tier — mirrors the pre-push hook.
vf_have_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "WARN: Docker unavailable — SKIPPING stack tier (RLS, edge-fn, webhook, e2e)."
    echo "      Run on a machine with Docker + Stripe TEST keys for full coverage."
    return 1
  fi
}

# Boot + reset the local Supabase stack once. Exits the script on failure (a
# half-booted stack makes every downstream tier a false negative).
vf_boot_stack() {
  echo "==> booting local Supabase stack"
  npx --prefix frontend supabase start || exit 1
  npx --prefix frontend supabase db reset || exit 1
}

# --- tiers ------------------------------------------------------------------

vf_fast() {
  echo "==> fast tier (npm run verify)"
  npm run verify --prefix frontend || fail=1
}

vf_sql() {
  echo "==> RLS / trigger / config SQL tier (no Stripe needed)"
  for t in supabase/tests/*.test.sh; do
    echo "--- $t"
    bash "$t" || fail=1
  done
}

vf_edge_identity() {
  echo "==> edge-function identity"
  bash supabase/functions/tests/authz-identity.test.sh || fail=1
}

# Stripe-dependent — only if TEST secrets are present (fail-open otherwise).
vf_stripe_matrix() {
  if [ -f supabase/functions/.env ] && grep -q STRIPE_SECRET_KEY supabase/functions/.env; then
    echo "==> Stripe payment-flow matrix (run-all.sh)"
    bash supabase/functions/tests/run-all.sh || fail=1
  else
    echo "WARN: supabase/functions/.env with STRIPE_SECRET_KEY not found — SKIPPING Stripe matrix."
  fi
}

vf_e2e() {
  echo "==> Playwright e2e"
  npm run e2e --prefix frontend || fail=1
}

# Usable two ways: `source` it for the functions (verify-full / verify-changed),
# or execute it with tier names to boot the stack and run just those, e.g.
#   bash scripts/verify-lib.sh sql              -> vf_sql
#   bash scripts/verify-lib.sh edge_identity stripe_matrix
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -uo pipefail
  cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fail=0
  vf_have_docker || exit 0
  vf_boot_stack
  for tier in "$@"; do "vf_${tier}"; done
  exit "$fail"
fi
