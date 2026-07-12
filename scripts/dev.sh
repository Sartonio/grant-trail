#!/usr/bin/env bash
# Full local dev stack: edge functions + Vite, in one terminal.
#
# The Supabase stack that `npm run db:start` boots does NOT load
# supabase/functions/.env — the edge runtime container comes up without the
# Stripe keys, so billing functions crash at first call. The functions have to
# be served separately with --env-file, which used to mean a second shell that
# was easy to forget. This owns both processes and tears the serve down on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/supabase/functions/.env"
WEBHOOK_URL="http://127.0.0.1:54321/functions/v1/stripe-webhook"
SERVE_PID=""
LISTEN_PID=""

cleanup() {
  # Only kill what WE started; a serve/forwarder already running in the dev's
  # other shell is left alone (mirrors ensure_functions_served in the tests).
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true
  [ -n "$LISTEN_PID" ] && kill "$LISTEN_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q supabase_db_; then
  echo "!! Local Supabase stack is not running. Start it first:  npm run db:start" >&2
  exit 1
fi

# APP_URL in the functions env is pinned to :3000 — it builds Stripe's
# success_url/cancel_url and gates the allowed origins. If Vite drifts to
# another port (its default on a collision), checkout gets origin-rejected or
# redirects back to a dead port. Fail loudly instead.
if ss -ltn 2>/dev/null | grep -q ':3000 '; then
  echo "!! Port 3000 is already in use — Vite would fall back to another port," >&2
  echo "   which breaks Stripe checkout (APP_URL is pinned to :3000). Holder:" >&2
  ss -ltnp 2>/dev/null | grep ':3000 ' >&2 || true
  echo "   Free it, then re-run:  npm run dev" >&2
  exit 1
fi

# Billing is an OPTIONAL integration — the app runs fully without it (seeded
# memberships bypass the paywall). `npm run setup` does not create this file, so
# a fresh clone legitimately has no Stripe keys: warn and run frontend-only
# rather than blocking someone who just wants the app up.
if [ ! -f "$ENV_FILE" ]; then
  echo "!! No $ENV_FILE — skipping edge functions and the Stripe forwarder." >&2
  echo "   The app still runs; billing (checkout/portal/webhooks) will not." >&2
  echo "   To enable it, see docs/how_to/local_stripe_testing.md" >&2
  echo "==> Starting Vite on http://localhost:3000 (frontend only)"
  exec npm run dev --prefix "$ROOT/frontend" -- --strictPort
fi

# A 4xx from the verify_jwt=false stripe-webhook means a real function answered.
# A refused connection (000) or a 5xx gateway/WORKER_ERROR means nothing is up.
functions_up() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    http://127.0.0.1:54321/functions/v1/stripe-webhook 2>/dev/null || echo 000)"
  [ "$code" -ge 400 ] && [ "$code" -lt 500 ]
}

if functions_up; then
  echo "==> Edge functions already served elsewhere — reusing."
else
  echo "==> Serving edge functions (env: supabase/functions/.env)"
  npx --prefix "$ROOT/frontend" supabase functions serve --env-file "$ENV_FILE" &
  SERVE_PID=$!
  for _ in $(seq 30); do
    functions_up && break
    # If the serve died on startup (bad config, port in use), stop waiting.
    kill -0 "$SERVE_PID" 2>/dev/null || { echo "!! functions serve exited early" >&2; exit 1; }
    sleep 1
  done
  functions_up || { echo "!! Edge functions did not come up in 30s" >&2; exit 1; }
  echo "==> Edge functions ready on http://127.0.0.1:54321/functions/v1"
fi

# ---- Stripe webhook forwarder --------------------------------------------
#
# `stripe listen` is the only way Stripe events reach the local webhook — it's a
# CLI-only forwarding subscription, so nothing appears under Dashboard →
# Webhooks. Without it, checkout completes in Stripe but no subscription is ever
# written to the DB, which looks like a silent app bug. It reuses the same
# STRIPE_SECRET_KEY from the env file, so there's nothing extra to configure.
#
# Non-fatal: the CLI is optional, and everything except the webhook loop works
# without it. Missing/broken forwarder warns and dev continues.
# shellcheck disable=SC1090
STRIPE_SECRET_KEY="$(grep -E '^STRIPE_SECRET_KEY=' "$ENV_FILE" | cut -d= -f2-)"
STRIPE_WEBHOOK_SECRET="$(grep -E '^STRIPE_WEBHOOK_SECRET=' "$ENV_FILE" | cut -d= -f2-)"

if ! command -v stripe >/dev/null 2>&1; then
  echo "!! stripe CLI not found — webhook events will NOT reach the local function." >&2
  echo "   Install it, or checkout will complete in Stripe but write nothing to the DB." >&2
elif [ -z "$STRIPE_SECRET_KEY" ]; then
  echo "!! STRIPE_SECRET_KEY unset in $ENV_FILE — skipping the webhook forwarder." >&2
elif pgrep -f "stripe listen" >/dev/null 2>&1; then
  echo "==> Stripe forwarder already running elsewhere — reusing."
else
  # A signing secret that doesn't match the one the function verifies against
  # yields "400 No signatures found matching..." on every event — a confusing
  # failure worth catching up front rather than mid-checkout.
  actual_secret="$(stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret 2>/dev/null || true)"
  if [ -n "$actual_secret" ] && [ "$actual_secret" != "$STRIPE_WEBHOOK_SECRET" ]; then
    echo "!! STRIPE_WEBHOOK_SECRET in $ENV_FILE does not match this machine's signing secret." >&2
    echo "   Every forwarded event will fail signature verification. Set it to:" >&2
    echo "   STRIPE_WEBHOOK_SECRET=$actual_secret" >&2
  fi
  echo "==> Forwarding Stripe events -> $WEBHOOK_URL"
  stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to "$WEBHOOK_URL" &
  LISTEN_PID=$!
fi

echo "==> Starting Vite on http://localhost:3000"
# --strictPort: never silently fall back to another port (see the check above).
npm run dev --prefix "$ROOT/frontend" -- --strictPort
