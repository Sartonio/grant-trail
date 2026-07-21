#!/usr/bin/env bash
#
# Shared tier functions for verify-full.sh (run everything) and
# verify-changed.sh (run only the tiers a diff touches). Source this; don't
# execute it. Each tier reuses an existing standalone runner — no new test infra.
#
# Convention: tier functions set `fail=1` on failure (never exit) so a caller can
# run several and report the aggregate. The two stack prerequisites (Docker +
# booted stack) are helpers the caller invokes once before any stack tier.
#
# Each worktree has its OWN local stack (scripts/stack-env.sh generates a
# per-worktree supabase/config.toml: unique project_id + port block), so
# worktrees run stack tiers in parallel. The per-stack lock (stack-lock.sh)
# still serializes concurrent runs of the SAME checkout — every caller must
# hold it before vf_boot_stack, which runs a destructive `db reset`.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stack-lock.sh"

# --- prerequisites ----------------------------------------------------------

# Run the Supabase CLI: prefer a PATH install (CI pins one via supabase/setup-cli;
# some devs install globally), else fall back to the frontend devDependency via
# npx. Keeps these tiers runnable both locally and in CI without duplicating the
# boot/env recipe there.
vf_supabase() {
  if command -v supabase >/dev/null 2>&1; then
    supabase "$@"
  else
    npx --prefix frontend supabase "$@"
  fi
}

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
# VF_REUSE_STACK=1 skips `supabase start` when `supabase status` reports a
# running stack (saves ~1 min when iterating on stack tiers). The `db reset`
# still runs unconditionally — a reused stack must be reset to a known state
# or every downstream tier tests leftover data. Default behavior is unchanged.
vf_boot_stack() {
  echo "==> booting local Supabase stack (${SE_PROJECT_ID})"
  # Normally already done by sl_acquire; kept here (idempotent) for callers
  # that boot without the lock helper.
  se_ensure_config || exit 1
  if [ "${VF_REUSE_STACK:-}" = "1" ] && vf_supabase status >/dev/null 2>&1; then
    echo "    VF_REUSE_STACK=1 and stack already running — skipping supabase start"
  else
    vf_supabase start || exit 1
  fi
  vf_supabase db reset || exit 1
  vf_export_stack_env
}

# CI parity (ci.yml does the same extraction): the e2e fixtures need the local
# stack's service-role key, which is deliberately NOT in frontend/.env.local —
# only browser-safe VITE_* values belong there. Source the keys from the stack
# we just booted instead; never override values the caller already exported.
vf_export_stack_env() {
  local status
  status="$(vf_supabase status -o env 2>/dev/null)" || {
    echo "WARN: could not read supabase status — e2e may lack SUPABASE_SERVICE_ROLE_KEY."
    return 0
  }
  _vf_env_from_status() {
    echo "$status" | grep "^$1=" | head -1 | cut -d= -f2- | tr -d '"'
  }
  export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(_vf_env_from_status SERVICE_ROLE_KEY)}"
  export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-$(_vf_env_from_status API_URL)}"
  export VITE_SUPABASE_KEY="${VITE_SUPABASE_KEY:-$(_vf_env_from_status ANON_KEY)}"
  # The shell test suites default API_URL from config.toml themselves; exporting
  # it here just pins the same answer for anything downstream.
  export API_URL="${API_URL:-$(_vf_env_from_status API_URL)}"
}

# Resolve the Deno binary: prefer one on PATH, fall back to the standard
# per-user install location. Echoes the path on success; returns non-zero (and
# warns) when Deno is absent, so the static tier can fail-open and SKIP — mirrors
# vf_have_docker. Deno is NOT a hard prerequisite for the fast tier.
vf_have_deno() {
  if command -v deno >/dev/null 2>&1; then
    command -v deno
    return 0
  fi
  if [ -x "$HOME/.deno/bin/deno" ]; then
    echo "$HOME/.deno/bin/deno"
    return 0
  fi
  return 1
}

# --- tiers ------------------------------------------------------------------

# Static gate for the Deno edge functions: `deno check` (type), `deno test`
# (the co-located _shared unit tests) and `deno lint`. No Docker / stack needed,
# so callers run it BEFORE the stack tiers. Fail-open when Deno is missing (warn
# + skip); when Deno IS present it GATES (sets fail=1). The first `deno check`
# downloads npm deps into the Deno cache — expected. DENO_NO_PACKAGE_JSON stops
# Deno from adopting the repo's Node package.json (frontend) and demanding a
# node_modules dir; supabase/functions/deno.json is the config root.
vf_edge_static() {
  local deno
  if ! deno="$(vf_have_deno)"; then
    echo "WARN: Deno not found (PATH or ~/.deno/bin) — SKIPPING edge-static tier"
    echo "      (deno check / test / lint over supabase/functions). Install Deno to gate."
    return 0
  fi
  echo "==> edge-static tier (deno check / test / lint over supabase/functions) [$deno]"
  export DENO_NO_PACKAGE_JSON=1

  echo "--- deno check (functions + _shared)"
  "$deno" check supabase/functions/*/index.ts supabase/functions/_shared/*.ts || fail=1

  echo "--- deno test (_shared/*.test.ts)"
  "$deno" test supabase/functions/_shared/*.test.ts || fail=1

  echo "--- deno lint (supabase/functions)"
  "$deno" lint supabase/functions || fail=1
}

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
# or execute it with tier names to run just those, e.g.
#   bash scripts/verify-lib.sh sql              -> vf_sql (boots the stack)
#   bash scripts/verify-lib.sh edge_identity stripe_matrix
#   bash scripts/verify-lib.sh edge_static      -> static, no stack boot
# Static tiers (no Docker/stack) are listed below and skip the stack boot; if
# EVERY requested tier is static we never touch Docker.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  set -uo pipefail
  cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  fail=0
  # No tiers requested — that's a usage error, not a green run.
  if [ "$#" -eq 0 ]; then
    echo "usage: bash scripts/verify-lib.sh <tier>..." >&2
    echo "  tiers: edge_static fast sql edge_identity stripe_matrix e2e" >&2
    exit 2
  fi
  # One pass over the requested tiers: reject unknown names up front (a typo'd
  # tier must not silently exit 0 — or worse, boot Docker first), and note
  # whether any requested tier needs the booted stack (edge_static is static).
  needs_stack=0
  for tier in "$@"; do
    if ! declare -f "vf_${tier}" >/dev/null; then
      echo "ERROR: unknown tier '${tier}'." >&2
      echo "  valid tiers: edge_static fast sql edge_identity stripe_matrix e2e" >&2
      exit 2
    fi
    case "$tier" in
      edge_static) ;;                 # static — no stack
      *) needs_stack=1 ;;
    esac
  done
  if [ "$needs_stack" = 1 ]; then
    vf_have_docker || exit 0
    sl_acquire "bash scripts/verify-lib.sh $*" || exit 1
    vf_boot_stack
  fi
  for tier in "$@"; do "vf_${tier}"; done
  exit "$fail"
fi
