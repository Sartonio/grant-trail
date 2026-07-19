#!/usr/bin/env bash
#
# verify:full — the security-critical tier on top of the fast `npm run verify`.
#
# Fast tier (lint + typecheck + format:check + unit) always runs. The stack tier
# (RLS adversarial, grant triggers, charity-directory RLS, platform-root config,
# edge-fn identity, Stripe webhook/checkout/portal matrix, Playwright e2e) needs
# a local Supabase stack and — for the billing tests — Stripe TEST keys.
#
# Fail-open by design: if Docker is unavailable the stack tier is SKIPPED with a
# warning (mirrors the pre-push hook), so this stays runnable on machines that
# can't boot the stack. CI should run it where Docker + Stripe secrets exist.
#
# Tier bodies live in scripts/verify-lib.sh (shared with verify-changed.sh).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
source scripts/verify-lib.sh

fail=0

# Overlap the ~1.5 min stack boot with the fast tier: kick vf_boot_stack off in
# the background (output to a temp log so boot noise doesn't interleave with the
# fast-tier output) and `wait` on it before the first stack tier. Inside a
# background subshell vf_boot_stack's `exit 1` only exits the subshell, so its
# failure surfaces as the subshell's exit code via `wait` below.
#
# Spawn under `set -m` (job control) so the subshell becomes its own
# process-group leader: killing the GROUP (`kill -- -$boot_pid`) reaps the
# `npx … supabase start` children too, not just the subshell — a plain
# `kill $boot_pid` would leave them running after we exit. Job control is
# switched back off immediately so the rest of the script is unaffected.
boot_pid="" boot_log=""
if vf_have_docker; then
  # Take the cross-worktree stack lock in the PARENT shell, before forking the
  # boot — a lock acquired inside the background subshell would release when
  # the subshell exits, long before the stack tiers run.
  sl_acquire "npm run verify:full" || exit 1
  boot_log="$(mktemp -t vf-boot.XXXXXX)"
  set -m
  ( vf_boot_stack ) >"$boot_log" 2>&1 &
  boot_pid=$!
  set +m
fi

vf_fast
vf_edge_static                # static Deno gate — no stack needed, run it early
if [ "$fail" -ne 0 ]; then    # don't run the stack if a static tier is red
  if [ -n "$boot_pid" ]; then # reap the background boot before exiting red
    # Kill the whole process group (subshell + supabase children); fall back
    # to the single pid if the group is already gone.
    kill -- "-$boot_pid" 2>/dev/null || kill "$boot_pid" 2>/dev/null
    wait "$boot_pid" 2>/dev/null
    rm -f "$boot_log"
  fi
  exit 1
fi

[ -n "$boot_pid" ] || exit 0  # fail-open: no Docker (warned above) — skip stack tier

if wait "$boot_pid"; then
  rm -f "$boot_log"
  vf_export_stack_env         # subshell exports don't reach us — re-derive here
else
  echo "ERROR: stack boot failed — tail of $boot_log:"
  tail -n 40 "$boot_log"
  exit 1
fi

vf_sql
vf_edge_identity
vf_stripe_matrix
vf_e2e

exit $fail
