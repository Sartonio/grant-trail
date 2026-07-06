#!/usr/bin/env bash
#
# edge-fn-ci-lib.sh — shared helpers for the edge-function CI jobs.
#
# Sourced by the FAST gate job in .github/workflows/ci.yml for test discovery
# and aggregation. Serving the edge functions + waiting for readiness is NOT
# done here: the tests' own ensure_functions_served
# (supabase/functions/tests/lib/stripe_test_helpers.sh) is the single
# serve/readiness path, shared byte-for-byte between local runs and CI, so the
# two can't drift.
#
# Nothing here touches production: it only drives the local Supabase stack.

# The fixed local-stack demo anon key (a valid JWT for the anon role). Same key
# the .sh tests default to; exported so served-function probes line up with them.
export ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"

API_URL="${API_URL:-http://127.0.0.1:54321}"
TESTS_DIR="${TESTS_DIR:-supabase/functions/tests}"

# Print the .sh tests in the given tier, newline-separated, sorted. A tier is
# just a space-separated list of basenames; only files that actually exist are
# emitted, so a job stays valid even before a sibling lane adds its test file.
#   $1.. — basenames to include (e.g. "system-logs-failure.test.sh")
select_tests() {
  local name
  for name in "$@"; do
    if [ -f "${TESTS_DIR}/${name}" ]; then
      echo "${TESTS_DIR}/${name}"
    fi
  done
}

# Run each given test file with bash; aggregate exit status (non-zero if ANY
# fail). A tier with no present test files is a no-op success — the job stays
# green whether or not those files exist yet on the branch we build from.
run_tests() {
  local status=0 t
  if [ "$#" -eq 0 ]; then
    echo "No matching edge-function tests present on this branch — skipping."
    return 0
  fi
  for t in "$@"; do
    echo "=== Running ${t} ==="
    if bash "$t"; then
      echo "--- PASS ${t}"
    else
      echo "::error::edge-function test failed: ${t}"
      status=1
    fi
  done
  return $status
}
