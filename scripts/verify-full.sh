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
vf_fast
[ "$fail" -eq 0 ] || exit 1   # don't boot the stack if the fast tier is red

vf_have_docker || exit 0
vf_boot_stack

vf_sql
vf_edge_identity
vf_stripe_matrix
vf_e2e

exit $fail
