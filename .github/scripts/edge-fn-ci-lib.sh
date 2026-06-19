#!/usr/bin/env bash
#
# edge-fn-ci-lib.sh — shared helpers for the edge-function CI jobs.
#
# Sourced by both the FAST gate job and the STRIPE-ENABLED job in
# .github/workflows/ci.yml. Keeps the "serve functions + wait until ready"
# dance and the test discovery glob in one place so the two jobs can't drift.
#
# Nothing here touches production: it only drives the local Supabase stack.

# The fixed local-stack demo anon key (a valid JWT for the anon role). Same key
# the .sh tests default to; exported so served-function probes line up with them.
export ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"

API_URL="${API_URL:-http://127.0.0.1:54321}"
TESTS_DIR="${TESTS_DIR:-supabase/functions/tests}"

# Serve the edge functions in the background and block until the runtime
# answers. Writes the background PID to the global SERVE_PID so the caller can
# tear it down. Returns non-zero (and kills the runtime) if it never comes up.
#   $1 — path to the --env-file passed to `supabase functions serve`
serve_functions_and_wait() {
  local env_file="$1"
  supabase functions serve --env-file "$env_file" &
  SERVE_PID=$!
  local code
  for _ in $(seq 1 30); do
    # A booted runtime returns 400 ("missing fields") for an empty body; any
    # 4xx/5xx means the HTTP server is up. Connection-refused yields 000.
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
      "${API_URL}/functions/v1/create-checkout-session" \
      -H "Authorization: Bearer ${ANON_KEY}" -H "apikey: ${ANON_KEY}" \
      -H "Content-Type: application/json" -d '{}' || true)
    if [ "$code" = "400" ]; then
      return 0
    fi
    sleep 2
  done
  echo "::error::Edge runtime did not become ready in time"
  stop_functions
  return 1
}

# Kill the background `functions serve` process if we started one.
stop_functions() {
  if [ -n "${SERVE_PID:-}" ]; then
    kill "$SERVE_PID" 2>/dev/null || true
    SERVE_PID=""
  fi
}

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
