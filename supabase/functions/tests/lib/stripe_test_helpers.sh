#!/usr/bin/env bash
#
# Shared helpers for the Stripe payment-flow integration tests (WS5 / Lane F).
#
# These tests drive GrantTrail's billing Edge Functions against Stripe TEST mode.
# Stripe is the source of truth; the DB tables `subscriptions` / `user_memberships`
# are a webhook-synced projection. We prove the webhook loop by:
#   * creating real Stripe customers/subscriptions via the Stripe API,
#   * mapping each customer to a DB user row in `billing_customers`,
#   * getting the signed events to the local stripe-webhook function — either
#     forwarded by `stripe listen --forward-to` (live transport) or built from
#     the real object JSON, HMAC-signed, and POSTed directly by deliver_event
#     (synthetic transport, the default; see LANEF_WEBHOOK_TRANSPORT below), and
#   * polling the DB until it reaches (and holds) the expected end-state.
#
# Nothing here touches production: TEST-mode keys only, local Supabase only.
#
# Required env (sourced from supabase/functions/.env by the runner):
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
#   STRIPE_PRICE_BASIC, STRIPE_PRICE_FISCAL_AGENT, APP_URL

set -uo pipefail

# ---- configuration -------------------------------------------------------

# PROJECT_ID / API port come from supabase/config.toml — per-worktree generated
# since Phase 2 (scripts/stack-env.sh), canonical on the main checkout — so
# these tests always target THEIR OWN stack. Fall back to the canonical values
# if parsing fails.
_LANEF_CONFIG_TOML="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/config.toml"
PROJECT_ID="${PROJECT_ID:-$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$_LANEF_CONFIG_TOML" 2>/dev/null | head -n1 || true)}"
PROJECT_ID="${PROJECT_ID:-grant-trail}"
_LANEF_API_PORT="$(sed -n '/^\[api\]/,/^\[/s/^port[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' \
  "$_LANEF_CONFIG_TOML" 2>/dev/null | head -n1 || true)"
API_URL="${API_URL:-http://127.0.0.1:${_LANEF_API_PORT:-54321}}"
FUNCTIONS_URL="${API_URL}/functions/v1"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

# Local Supabase ships fixed demo keys (see `npx supabase status`).
ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"

# How long to wait for an async webhook to land (seconds).
WAIT_TIMEOUT="${WAIT_TIMEOUT:-40}"

# ---- local Resend mock ---------------------------------------------------
#
# Email is sent via the Resend HTTP API (_shared/email.ts). Tests must never
# reach the real endpoint with live creds (see ensure_functions_served), so the
# harness serves the functions with RESEND_API_URL pointed at a tiny local mock
# (lib/resend_mock.py) that returns 200 and appends each request body to a
# capture file. That makes email sending assertable instead of just disabled.
#
# The edge functions run inside the supabase edge-runtime CONTAINER, so they
# reach the host-bound mock via host.docker.internal (the Supabase CLI maps it
# to the host gateway). RESEND_MOCK_CAPTURE is exported for tests to read.
# Default derived from the stack's API port so parallel worktrees don't fight
# over one host port (main checkout: 54321+63=54384).
RESEND_MOCK_PORT="${RESEND_MOCK_PORT:-$(( ${_LANEF_API_PORT:-54321} + 63 ))}"
RESEND_MOCK_HOST="${RESEND_MOCK_HOST:-host.docker.internal}"
RESEND_MOCK_FROM="${RESEND_MOCK_FROM:-GrantTrail Test <mock@granttrail.test>}"
RESEND_MOCK_KEY="re_test_mock_no_real_send"
RESEND_MOCK_CAPTURE=""     # set by _start_resend_mock when the mock comes up
RESEND_MOCK_URL=""         # set by _start_resend_mock; consumed as RESEND_API_URL
_RESEND_MOCK_PID=""

# _start_resend_mock — launch the mock; on success export RESEND_MOCK_CAPTURE +
# RESEND_MOCK_URL and return 0. On any failure return 1 so the caller can fall
# back to serving WITHOUT email creds (email disabled) rather than failing.
_start_resend_mock() {
  local lib capture i
  lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  command -v python3 >/dev/null 2>&1 || return 1
  capture="$(mktemp -t resend-mock.XXXXXX.jsonl)"
  python3 "${lib}/resend_mock.py" "$RESEND_MOCK_PORT" "$capture" \
    >/dev/null 2>&1 &
  _RESEND_MOCK_PID=$!
  # Wait until the mock answers a local GET (readiness). The edge container
  # reaches it via host.docker.internal, but from the host it's 127.0.0.1.
  for i in $(seq 1 20); do
    if ! kill -0 "$_RESEND_MOCK_PID" 2>/dev/null; then
      _RESEND_MOCK_PID=""
      return 1
    fi
    if curl -s -o /dev/null "http://127.0.0.1:${RESEND_MOCK_PORT}/" 2>/dev/null; then
      RESEND_MOCK_CAPTURE="$capture"
      RESEND_MOCK_URL="http://${RESEND_MOCK_HOST}:${RESEND_MOCK_PORT}/emails"
      export RESEND_MOCK_CAPTURE
      return 0
    fi
    sleep 0.5
  done
  _stop_resend_mock
  return 1
}

_stop_resend_mock() {
  [ -n "$_RESEND_MOCK_PID" ] || return 0
  kill "$_RESEND_MOCK_PID" 2>/dev/null || true
  _RESEND_MOCK_PID=""
}

# ---- counters ------------------------------------------------------------

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS  $*"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL  $*"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo "----  $*"; }
# Deliberately-not-run scenario (e.g. gated behind LANEF_INCLUDE_SLOW). Touches
# NEITHER counter, so a skip can never masquerade as a pass in the summary.
skip() { echo "SKIP  $*"; }

# ---- functions-serve lifecycle -------------------------------------------
#
# The billing edge functions must be served (`supabase functions serve`) as the
# upstream behind Kong; with no server up, every /functions/* call 502s. Callers
# used to have to start it by hand in a second shell (see run-all.sh / README).
# `ensure_functions_served` makes each test self-sufficient: if nothing is
# already serving, it starts one — WITHOUT --no-verify-jwt, so config.toml's
# per-function verify_jwt is honoured (billing fns 401 without a JWT; the
# verify_jwt=false stripe-webhook still receives forwarded events) — and stops it
# on exit. An already-running server (a dev's shell, or a sibling test) is
# detected and left untouched.
#
# run-all.sh serves + warms ONCE for the whole run and exports
# LANEF_SERVE_EXTERNAL=1; under that flag ensure_functions_served reduces to a
# single readiness probe (no boot, no warm-up, no EXIT trap) so each child
# suite reuses the shared server instead of cold-booting its own (~60-110s).

_SERVE_STARTED_HERE=""

# True when the edge stack answers /functions/* with a REAL function response.
# stripe-webhook is verify_jwt=false, so an unsigned POST reaches the function
# and gets a 4xx (400, no signature). A missing upstream yields 000 (refused)
# or a 502/503 gateway error — and a runtime that is still booting ("Setting up
# Edge Functions runtime...", cold image pull in CI) answers 5xx with a
# {"code":"WORKER_ERROR"} body. Treating that boot phase as "up" let whole
# suites run against a half-started runtime and fail every call, so only a
# 4xx without WORKER_ERROR counts as ready.
_functions_up() {
  local resp code body
  resp=$(curl -s -w $'\n%{http_code}' -X POST "${FUNCTIONS_URL}/stripe-webhook" \
    -H "Content-Type: application/json" --data-raw '{}' 2>/dev/null || true)
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  [ "${code:0:1}" = "4" ] && [[ "$body" != *WORKER_ERROR* ]]
}

# Per-function workers boot lazily: even after the runtime answers, the FIRST
# hit to each function can 5xx (WORKER_ERROR / request-deadline during npm dep
# download). Warm every function once HERE — the one place that owns
# readiness — so individual tests never need their own cold-start retry
# loops. An anon bearer passes gateway JWT verification (anon is a valid
# role), boots the worker, and gets a fast 4xx from the handler; on an
# already-warm server each probe is a few ms.
_warm_functions() {
  local root dir name code i
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
  for dir in "$root"/supabase/functions/*/; do
    name="$(basename "$dir")"
    [ -f "${dir}index.ts" ] || continue
    for i in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${FUNCTIONS_URL}/${name}" \
        -H "Authorization: Bearer ${ANON_KEY}" -H "apikey: ${ANON_KEY}" \
        -H "Content-Type: application/json" --data-raw '{}' 2>/dev/null || true)
      [ "${code:0:1}" != "5" ] && [ "$code" != "000" ] && break
      sleep 2
    done
  done
}

# Only kills a server WE started (guarded by _SERVE_STARTED_HERE), so an
# externally-managed serve is never touched. The pattern is pinned to this
# project's env-file naming (lanef-env-<project_id>.*) so parallel worktrees
# — each serving their own stack — can never kill each other's serve.
_stop_functions_served() {
  # Always stop a mock we started, even if we did not start the serve.
  _stop_resend_mock
  [ -n "$_SERVE_STARTED_HERE" ] || return 0
  pkill -f "functions serve.*lanef-env-${PROJECT_ID}\." 2>/dev/null || true
  _SERVE_STARTED_HERE=""
  # Block until the worker is actually gone. Without this, a sibling test in the
  # same run-all sequence can probe during the kill window, mistake the dying
  # server for a live one, reuse it, and then 502 mid-test.
  local i; for i in 1 2 3 4 5; do _functions_up || return 0; sleep 1; done
}

ensure_functions_served() {
  local root envfile logfile i
  # this file is at <repo>/supabase/functions/tests/lib/ -> four levels up = repo root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
  envfile="${root}/supabase/functions/.env"

  # Standalone runs (`bash <test>.test.sh`) don't inherit the Stripe env that
  # run-all.sh exports, so the test's own sapi/curl calls and price-id refs would
  # hit unbound vars. Load it here (idempotent — run-all already exported it).
  if [ -z "${STRIPE_SECRET_KEY:-}" ] && [ -f "$envfile" ]; then
    set -a; # shellcheck disable=SC1090
    source "$envfile"; set +a
  fi

  # Shared-server fast path: the parent runner (run-all.sh) already booted AND
  # warmed a server for the whole run, so one healthy probe is enough — skip
  # the warm loop and do NOT install the EXIT trap (the owning shell tears the
  # server down exactly once). If the probe misses (server died mid-run), fall
  # through and self-serve exactly as a standalone run would.
  if [ "${LANEF_SERVE_EXTERNAL:-}" = "1" ] && _functions_up; then
    return 0
  fi

  # One failed probe is not proof the server is down (worker recycle, restart
  # window). Starting a competing serve against a live one tears down its
  # edge-runtime container and strands Kong ("name resolution failed"), so
  # require three consecutive misses before we take over.
  for i in 1 2 3; do
    _functions_up && { _warm_functions; return 0; }
    sleep 1
  done

  # In CI there is no supabase/functions/.env — the Stripe secrets arrive as
  # exported env vars. Serving with a missing --env-file makes the CLI die
  # after it has already replaced the runtime container. Synthesize one.
  if [ ! -f "$envfile" ]; then
    if [ -z "${STRIPE_SECRET_KEY:-}" ]; then
      echo "FATAL: no ${envfile} and STRIPE_SECRET_KEY not exported — cannot serve functions" >&2
      return 1
    fi
    envfile="$(mktemp -t "lanef-env-${PROJECT_ID}.XXXXXX")"
    {
      echo "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}"
      echo "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-}"
      echo "STRIPE_PRICE_BASIC=${STRIPE_PRICE_BASIC:-}"
      echo "STRIPE_PRICE_FISCAL_AGENT=${STRIPE_PRICE_FISCAL_AGENT:-}"
      echo "APP_URL=${APP_URL:-http://localhost:3000}"
    } > "$envfile"
  fi

  # Never serve tests with the developer's REAL email creds. A dev .env carries a
  # live RESEND_API_KEY + verified EMAIL_FROM, and the webhook tests drive
  # customers to past_due, so dunning emails would really be sent to
  # lanef-*@example.com and bounce — burning the sending domain's reputation.
  #
  # Instead of trusting a grep to strip every email var out of an arbitrary .env,
  # we CONSTRUCT the served env from an explicit allowlist (below): only these
  # Stripe/app vars are ever passed through, sourced from the dev .env or exported
  # env. Real RESEND_*/EMAIL_FROM/SMTP_FROM values can never leak in this way.
  #
  # Email is then wired to a LOCAL mock (fake key + fake from + RESEND_API_URL at
  # the mock endpoint) so sending is exercised and assertable, not just disabled.
  # If the mock can't start, we fall back to omitting the email vars entirely —
  # sendEmail() no-ops without a key/from, so the suite still runs (just without
  # email assertions). email-resilience.test.sh serves with its OWN env files via
  # serve_with_env and never calls this function, so it is unaffected.
  # Start the mock BEFORE writing the file (its info logging must not land in the
  # redirected env file). _start_resend_mock sets RESEND_MOCK_URL/_CAPTURE on
  # success.
  local served mock_ok=0
  if _start_resend_mock; then
    mock_ok=1
    info "local Resend mock up (capture: ${RESEND_MOCK_CAPTURE})"
  else
    info "Resend mock unavailable — serving with email disabled (no creds)"
  fi
  # The project id in the name is load-bearing: _stop_functions_served (and
  # email-resilience's stop_serve) kill by this pattern, per-worktree.
  served="$(mktemp -t "lanef-env-${PROJECT_ID}.XXXXXX")"
  {
    echo "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-}"
    echo "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET:-}"
    echo "STRIPE_PRICE_BASIC=${STRIPE_PRICE_BASIC:-}"
    echo "STRIPE_PRICE_FISCAL_AGENT=${STRIPE_PRICE_FISCAL_AGENT:-}"
    echo "APP_URL=${APP_URL:-http://localhost:3000}"
    if [ "$mock_ok" = "1" ]; then
      echo "RESEND_API_KEY=${RESEND_MOCK_KEY}"
      echo "EMAIL_FROM=${RESEND_MOCK_FROM}"
      echo "RESEND_API_URL=${RESEND_MOCK_URL}"
    fi
  } > "$served"
  envfile="$served"

  logfile="$(mktemp -t lanef-serve.XXXXXX.log)"
  info "no functions server up — starting one (log: ${logfile})"
  # Prefer the supabase binary on PATH (CI installs it via setup-cli and runs
  # no npm install, so npx would re-download the CLI); fall back to the
  # frontend dev-dependency for local shells without a global install.
  if command -v supabase >/dev/null 2>&1; then
    ( cd "$root" && supabase functions serve \
        --env-file "$envfile" ) > "$logfile" 2>&1 &
  else
    ( cd "$root" && npx --prefix frontend supabase functions serve \
        --env-file "$envfile" ) > "$logfile" 2>&1 &
  fi
  _SERVE_STARTED_HERE=1
  trap _stop_functions_served EXIT
  for i in $(seq 1 60); do
    _functions_up && { _warm_functions; return 0; }
    sleep 2
  done
  echo "FATAL: functions serve did not become ready in ~120s; log:" >&2
  cat "$logfile" >&2
  return 1
}

# ---- stripe API wrappers -------------------------------------------------

# Strip ANSI colour codes so output is JSON-parseable.
_strip_ansi() { sed $'s/\x1b\\[[0-9;]*m//g'; }

# Run a stripe CLI command with the test key; emit clean stdout.
sapi() { stripe "$@" --api-key "$STRIPE_SECRET_KEY" 2>/dev/null | _strip_ansi; }

# Extract a top-level JSON string field from stdin.
json_field() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',''))"; }

# Pull a checkout-session id (cs_test_…) out of a returned checkout URL on stdin.
session_id_from_resp() {
  python3 -c "import sys,json,re; u=json.load(sys.stdin).get('url','') or ''; m=re.search(r'(cs_test_[A-Za-z0-9]+)',u); print(m.group(1) if m else '')"
}

# ---- database helpers ----------------------------------------------------

# Run a SQL query, return tuples-only (-tA) trimmed output.
dbq() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tA -c "$1"; }

# Run SQL with no expectation of a result row (DDL/DML).
dbx() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q -c "$1" >/dev/null; }

# ---- fixture management --------------------------------------------------
#
# We create a dedicated test user (auth.users + public.users) so the tests are
# isolated from seed data and repeatable. The DB user id is echoed.

TEST_PASSWORD="password123"

# create_test_user <email> <role>  -> echoes the public.users.id (integer)
#
# The auth user is created via the GoTrue admin API (a raw auth.users INSERT
# omits columns GoTrue needs and breaks token issuance), then linked to a
# public.users row.
#
# Tenant choice matters for billing: admins must live in a *managed* tenant that
# is NOT exempt, so subscription gating actually applies. We mint a FRESH,
# unique managed tenant (slug `lanef-<rand>`, require_subscription=true by
# default) per admin/super_admin call rather than sharing one tenant. Sharing a
# tenant cross-contaminates exemption: is_membership_exempt() returns true if
# ANY sibling in the tenant holds an active premium membership, so one test's
# premium subscriber would poison exemption-sensitive predicates for every other
# test user. A private tenant keeps each admin billable (is_membership_exempt =
# false). Grantees go in a shared self-service tenant.
create_test_user() {
  local email="$1" role="${2:-admin}" slug
  if [ "$role" == "admin" ] || [ "$role" == "super_admin" ]; then
    slug="lanef-${RANDOM}${RANDOM}"
    # Managed + require_subscription=true (the column default) => admins billable.
    dbx "INSERT INTO tenants (name, slug, tenant_type) VALUES ('Lane F Test Tenant', '${slug}', 'managed');"
    dbx "INSERT INTO tenant_settings (tenant_id) VALUES ((SELECT id FROM tenants WHERE slug='${slug}'));"
  else
    slug="lopez-consulting"
  fi
  local uuid
  uuid=$(curl -s -X POST "${API_URL}/auth/v1/admin/users" \
    -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${TEST_PASSWORD}\",\"email_confirm\":true}" \
    | json_field id)
  dbx "INSERT INTO users (user_id, tenant_id, firstname, lastname, organization_name, email, phone_number, role)
       VALUES ('${uuid}', (SELECT id FROM tenants WHERE slug='${slug}'), 'Lane', 'F', 'Lane F Test Org', '${email}', '555-000-0000', '${role}');"
  dbq "SELECT id FROM users WHERE email = '${email}';"
}

# create_test_user_in_tenant <email> <tenant_id> [role] -> echoes public.users.id
#
# Like create_test_user but joins an EXISTING tenant instead of minting a fresh
# one. Used to prove tenant-owned billing across two admins of the SAME tenant
# (customer reuse via the partial-unique index, alreadyActive dedup). Role
# defaults to admin. cleanup_test_users still sweeps these by the lanef-% email.
create_test_user_in_tenant() {
  local email="$1" tenant_id="$2" role="${3:-admin}"
  local uuid
  uuid=$(curl -s -X POST "${API_URL}/auth/v1/admin/users" \
    -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"password\":\"${TEST_PASSWORD}\",\"email_confirm\":true}" \
    | json_field id)
  dbx "INSERT INTO users (user_id, tenant_id, firstname, lastname, organization_name, email, phone_number, role)
       VALUES ('${uuid}', ${tenant_id}, 'Lane', 'F', 'Lane F Test Org', '${email}', '555-000-0000', '${role}');"
  dbq "SELECT id FROM users WHERE email = '${email}';"
}

# tenant_id_for <public.users.id> -> echoes the user's tenant_id
tenant_id_for() { dbq "SELECT tenant_id FROM users WHERE id = ${1};"; }

# get_token <email> -> echoes a real GoTrue access token for the user
get_token() {
  curl -s -X POST "${API_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"${TEST_PASSWORD}\"}" | json_field access_token
}

# Remove all Lane-F test fixtures (DB rows + GoTrue users + per-test tenants).
cleanup_test_users() {
  local ids
  # Collect auth ids from auth.users (not public.users): an interrupted run can
  # die between the GoTrue create and the public.users INSERT, leaving an
  # orphaned auth user a public-row-based sweep would never find — and a leaked
  # auth user makes every later create_test_user for that email fail (422).
  ids=$(dbq "SELECT id FROM auth.users WHERE email LIKE 'lanef-%@example.com';")
  dbx "DELETE FROM users WHERE email LIKE 'lanef-%@example.com';"
  # Drop the per-admin tenants minted by create_test_user (tenant_settings
  # cascades via FK). Safe only after their users are gone (above).
  dbx "DELETE FROM tenants WHERE slug LIKE 'lanef-%';"
  local u
  for u in $ids; do
    curl -s -o /dev/null -X DELETE "${API_URL}/auth/v1/admin/users/${u}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}"
  done
}

# Map a Stripe customer id to a DB user id in billing_customers.
map_customer() {
  local user_id="$1" customer_id="$2"
  dbx "INSERT INTO billing_customers (user_id, stripe_customer_id) VALUES (${user_id}, '${customer_id}')
       ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id;"
}

# Map a Stripe customer id to a TENANT in billing_customers (tenant-owned
# premium). user_id stays NULL (the exactly-one-owner CHECK); onConflict keys on
# the partial-unique tenant_id index.
map_tenant_customer() {
  local tenant_id="$1" customer_id="$2"
  dbx "INSERT INTO billing_customers (tenant_id, user_id, stripe_customer_id)
       VALUES (${tenant_id}, NULL, '${customer_id}')
       ON CONFLICT (tenant_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id;"
}

# auth uuid for a public.users.id
auth_uuid_for() { dbq "SELECT user_id FROM users WHERE id = ${1};"; }

# ---- stripe customer + subscription scaffolding --------------------------

# attach_default_card <cus> -> attaches a tok_visa card as the customer's default
#
# Exists for customers minted by the edge functions (create-checkout-session),
# which have no payment method: without a default card a subscription created on
# them stays incomplete and can never be charged. Call this so tests can create
# chargeable subscriptions on such customers.
attach_default_card() {
  local cus="$1" pm
  pm=$(sapi payment_methods create --type card -d "card[token]=tok_visa" | json_field id)
  sapi payment_methods attach "$pm" -d customer="$cus" >/dev/null
  sapi customers update "$cus" -d "invoice_settings[default_payment_method]=$pm" >/dev/null
}

# new_stripe_customer <email> -> echoes cus_xxx with a default test card attached
new_stripe_customer() {
  local email="$1" cus
  cus=$(sapi customers create --email "$email" | json_field id)
  attach_default_card "$cus"
  echo "$cus"
}

# create_subscription <cus> <price> <tier> -> echoes sub_xxx
create_subscription() {
  local cus="$1" price="$2" tier="$3"
  sapi subscriptions create -d customer="$cus" -d "items[0][price]=$price" \
    -d "metadata[membership_tier]=$tier" -d "metadata[user_id]=0" \
    | json_field id
}

# create_tenant_subscription <cus> <price> <tenant_id> [user_id] -> echoes sub_xxx
#
# A tenant-owned premium subscription: metadata carries tenant_id (the org) and
# user_id (the initiating admin, default 0), mirroring create-checkout-session's
# premium metadata. tier is always premium for tenant-owned subs.
create_tenant_subscription() {
  local cus="$1" price="$2" tenant_id="$3" user_id="${4:-0}"
  sapi subscriptions create -d customer="$cus" -d "items[0][price]=$price" \
    -d "metadata[membership_tier]=premium" \
    -d "metadata[tenant_id]=$tenant_id" \
    -d "metadata[user_id]=$user_id" \
    | json_field id
}

# cancel_subscription <sub> -- immediate cancellation (fires
# customer.subscription.deleted). The CLI's `subscriptions cancel` subcommand
# emits no JSON here, so we DELETE the resource directly.
cancel_subscription() {
  stripe delete "/v1/subscriptions/$1" --api-key "$STRIPE_SECRET_KEY" --confirm >/dev/null 2>&1
}

# ---- synthetic webhook transport -----------------------------------------
#
# LANEF_WEBHOOK_TRANSPORT selects how Stripe events reach the local
# stripe-webhook function in webhook-matrix.test.sh:
#
#   synthetic (DEFAULT when unset) — the test still creates/mutates REAL Stripe
#     TEST-mode objects via `sapi` (so payloads stay honest), then wraps the
#     fetched object JSON in a Stripe event envelope, signs it exactly like
#     Stripe does (v1 = HMAC-SHA256 of "<t>.<payload>" with
#     STRIPE_WEBHOOK_SECRET), and POSTs it straight at the served function.
#     No `stripe listen` forwarder, no waiting on Stripe-side event delivery.
#
#   live — the original full-fidelity loop: real Stripe emits the event and a
#     `stripe listen --forward-to` forwarder (started by run-all.sh) delivers
#     it. CI pins this via LANEF_WEBHOOK_TRANSPORT=live (see ci.yml).
#
# The SAME assertions run under both transports; only the delivery mechanism
# (and therefore the wall-clock wait) differs.

webhook_transport() {
  local t="${LANEF_WEBHOOK_TRANSPORT:-synthetic}"
  case "$t" in
    live|synthetic) echo "$t" ;;
    *)
      echo "FATAL: LANEF_WEBHOOK_TRANSPORT must be 'live' or 'synthetic' (got '$t')" >&2
      return 1
      ;;
  esac
}

# The signing secret MUST be the one the served functions booted with. Read it
# from the same env file ensure_functions_served serves --env-file with
# (supabase/functions/.env); fall back to the exported env for CI-style runs,
# where ensure_functions_served synthesizes its env file FROM the environment.
_webhook_signing_secret() {
  local root envfile val
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
  envfile="${root}/supabase/functions/.env"
  if [ -f "$envfile" ]; then
    val="$(grep -E '^STRIPE_WEBHOOK_SECRET=' "$envfile" | tail -n 1 | cut -d= -f2-)"
    val="${val%\"}"; val="${val#\"}"
    if [ -n "$val" ]; then printf '%s\n' "$val"; return 0; fi
  fi
  if [ -n "${STRIPE_WEBHOOK_SECRET:-}" ]; then
    printf '%s\n' "$STRIPE_WEBHOOK_SECRET"
    return 0
  fi
  echo "FATAL: STRIPE_WEBHOOK_SECRET not found (supabase/functions/.env or env) — cannot sign synthetic events" >&2
  return 1
}

# sub_object_json <sub_id> — the subscription's CURRENT JSON (compact, one
# line) fetched from the real Stripe TEST API, for use as an event's data.object.
sub_object_json() {
  sapi subscriptions retrieve "$1" \
    | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), separators=(',',':')))"
}

# Most recent synthetic delivery, kept so idempotency / out-of-order scenarios
# can re-deliver the byte-identical event (set -u safe defaults).
LANEF_LAST_EVENT_ID=""
LANEF_LAST_EVENT_PAYLOAD=""

# _sign_and_post_event <payload> -> echoes the webhook's HTTP status.
# Signs "<t>.<payload>" with the served function's STRIPE_WEBHOOK_SECRET —
# exactly what stripe.webhooks.constructEventAsync verifies (stripe-webhook/
# index.ts:21). Its default tolerance window is 300s, so a current `date +%s`
# header timestamp is always accepted.
_sign_and_post_event() {
  local payload="$1" t sig secret status
  secret="$(_webhook_signing_secret)" || return 1
  t="$(date +%s)"
  sig="$(printf '%s' "${t}.${payload}" | openssl dgst -sha256 -hmac "$secret" -r | cut -d' ' -f1)"
  status="$(curl -s -o /dev/null -w "%{http_code}" -X POST "${FUNCTIONS_URL}/stripe-webhook" \
    -H "Stripe-Signature: t=${t},v1=${sig}" \
    -H "Content-Type: application/json" \
    --data-raw "$payload")"
  echo "$status"
  # Every synthetic delivery expects a 2xx (even a swallowed duplicate is 200).
  # A non-2xx here means a harness fault (signing/secret mismatch, dead serve) —
  # fail loudly now instead of surfacing as a 40s wait_for_sql timeout later.
  case "$status" in
    2*) return 0 ;;
    *)  echo "FATAL: stripe-webhook POST returned HTTP ${status} (signing secret mismatch or serve down?)" >&2
        return 1 ;;
  esac
}

# deliver_event <event_type> <object_json> [event_id] [event_created]
#
# Build a Stripe event envelope around <object_json> (the fields the webhook
# consumes — id, type, created, data.object — plus the boilerplate a real
# envelope carries), sign it, POST it to the served stripe-webhook function.
# Echoes the HTTP status.
#   event_id      defaults to a per-run-unique evt_test_lanef_… (dedupe key in
#                 billing_webhook_events.stripe_event_id).
#   event_created defaults to now; it is the ordering marker
#                 claim_stripe_subscription_event keys on — pass an explicitly
#                 OLDER value to simulate a stale out-of-order delivery.
#
# NOTE: call as `deliver_event ... >/dev/null` (or to a file), NOT inside a
# command substitution — $(deliver_event ...) runs in a subshell and the
# LANEF_LAST_EVENT_* globals would not survive for redeliver_last_event.
deliver_event() {
  local etype="$1" obj="$2" evid="${3:-}" created="${4:-}"
  [ -n "$evid" ] || evid="evt_test_lanef_$(date +%s)_${RANDOM}_${RANDOM}"
  [ -n "$created" ] || created="$(date +%s)"
  local payload
  payload="$(printf '%s' "$obj" | python3 -c "
import json, sys
etype, evid, created = sys.argv[1], sys.argv[2], int(sys.argv[3])
event = {
    'id': evid,
    'object': 'event',
    'api_version': '2025-02-24.acacia',
    'created': created,
    'livemode': False,
    'pending_webhooks': 1,
    'request': {'id': None, 'idempotency_key': None},
    'type': etype,
    'data': {'object': json.load(sys.stdin)},
}
print(json.dumps(event, separators=(',', ':')))
" "$etype" "$evid" "$created")" || return 1
  LANEF_LAST_EVENT_ID="$evid"
  LANEF_LAST_EVENT_PAYLOAD="$payload"
  _sign_and_post_event "$payload"
}

# redeliver_last_event -> POST the byte-identical envelope from the most recent
# deliver_event again (same event id + body; fresh signature timestamp), i.e. a
# Stripe duplicate delivery. Echoes the HTTP status.
redeliver_last_event() {
  if [ -z "$LANEF_LAST_EVENT_PAYLOAD" ]; then
    echo "FATAL: redeliver_last_event called before any deliver_event" >&2
    return 1
  fi
  _sign_and_post_event "$LANEF_LAST_EVENT_PAYLOAD"
}

# ---- assertions ----------------------------------------------------------

# wait_for_sql <sql> <expected> <label>
# Polls <sql> until its trimmed result equals <expected>, or times out.
wait_for_sql() {
  local sql="$1" expected="$2" label="$3"
  local deadline=$((SECONDS + WAIT_TIMEOUT)) actual
  while [ $SECONDS -lt $deadline ]; do
    actual=$(dbq "$sql")
    if [ "$actual" == "$expected" ]; then
      pass "$label (=$expected)"
      return 0
    fi
    # 0.5s granularity halves the average post-webhook latency vs 1s polls;
    # the WAIT_TIMEOUT deadline above is unchanged.
    sleep 0.5
  done
  fail "$label  expected='$expected' got='$(dbq "$sql")'"
  return 1
}

# assert_eq <actual> <expected> <label>
assert_eq() {
  if [ "$1" == "$2" ]; then pass "$3 (=$2)"; else fail "$3 expected='$2' got='$1'"; fi
}

# assert_http <status> <expected> <label>
assert_http() {
  if [ "$1" == "$2" ]; then pass "$3 (HTTP $2)"; else fail "$3 expected HTTP $2 got $1"; fi
}

# wait_for_email <to-substr> <subject-substr> <label>
#
# Poll the Resend-mock capture file for a captured send whose (raw JSON) body
# contains BOTH substrings — the recipient and a subject fragment. Sends are
# async and there may be several (multiple payment_failed retries / prior sends);
# a single matching line anywhere is enough, so this is tolerant of ordering and
# volume. If the mock isn't running (RESEND_MOCK_CAPTURE unset — e.g. we reused an
# externally-managed serve we don't control the env of), the check is SKIPPED
# rather than failed, keeping standalone/dev runs green.
wait_for_email() {
  local to_sub="$1" subj_sub="$2" label="$3"
  if [ -z "${RESEND_MOCK_CAPTURE:-}" ] || [ ! -f "${RESEND_MOCK_CAPTURE}" ]; then
    skip "$label (no Resend mock capture — external serve reused)"
    return 0
  fi
  local deadline=$((SECONDS + WAIT_TIMEOUT))
  while [ $SECONDS -lt $deadline ]; do
    if grep -F "$to_sub" "$RESEND_MOCK_CAPTURE" 2>/dev/null | grep -Fq "$subj_sub"; then
      pass "$label (captured to~$to_sub subject~$subj_sub)"
      return 0
    fi
    sleep 0.5
  done
  fail "$label  no captured email matched to~'$to_sub' subject~'$subj_sub' in $RESEND_MOCK_CAPTURE"
  return 1
}
