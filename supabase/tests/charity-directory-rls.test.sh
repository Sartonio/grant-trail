#!/usr/bin/env bash
#
# Charity / Fiscal Agent Directory — RLS + paywall proof tests.
#
# Validates the data-layer gate for the directory feature
# (migration 20260624120000_charity_directory.sql) against the contract in
# docs/explanation/charity_directory_contract.md and the gate matrix in
# docs/explanation/charity_directory_ux.md §4.
#
# Style mirrors supabase/tests/rls-adversarial.test.sh: drives the local Supabase
# Postgres via `docker exec ... psql`. Each persona is simulated exactly as
# PostgREST does it — `SET LOCAL ROLE authenticated` + a request.jwt.claims GUC
# carrying the persona's auth uid (auth.uid() reads that claim); anon uses
# `SET LOCAL ROLE anon` with no sub claim.
#
# The committed seed lacks clean personas for every entitlement combination, so
# each test that needs a specific entitlement PLANTS a user_memberships row as
# `postgres` inside the SAME rolled-back transaction (membership_setup helpers).
# Nothing persists. We deliberately use NON-exempt bright-horizons users so the
# entitlement helpers are exercised, not short-circuited by is_membership_exempt.
#
# Seed fixture (see supabase/seed.sql §8). Listings are TENANT-owned; the
# managing admin persona is noted for the write tests:
#   listing 1  Cedar Roots Foundation     tenant 2 (admin user 8)  published+verified
#   listing 2  Bright Avenue Collective    tenant 2 (admin user 8)  draft+pending
#   listing 3  Northwind Community Fund     tenant 1 (admin user 4)  published+pending
#   inquiry 1/2  -> listing 1 (Cedar Roots), tenant 2
#
# Prerequisites (local only — never touches production):
#   npm run db:reset      # apply all migrations + seed fresh
#
# Run:  bash supabase/tests/charity-directory-rls.test.sh

set -uo pipefail

# assert_eq / assert_contains / DB_CONTAINER / require_stack are shared (see lib/common.sh).
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
require_stack

# --- Personas (auth uids from the seed) -------------------------------------
GRANTEE_BRIGHT='00000000-0000-0000-0000-000000000006'  # user 6, tenant 2, grantee, NON-exempt
GRANTEE_BRIGHT2='00000000-0000-0000-0000-000000000007' # user 7, tenant 2, grantee, NON-exempt
ADMIN_BRIGHT='00000000-0000-0000-0000-000000000008'    # user 8, tenant 2, admin, NON-exempt, OWNS listings 1+2
GRANTEE_SELF='00000000-0000-0000-0000-000000000009'    # user 9, tenant 3, grantee, NON-exempt
SUPER_TFAC='00000000-0000-0000-0000-000000000005'      # user 5, super_admin
ADMIN_TFAC='00000000-0000-0000-0000-000000000004'      # user 4, tenant 1, admin, EXEMPT (platform-root), OWNS listing 3

# users.id values matching the uids above
UID6=6; UID7=7; UID8=8; UID9=9

ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
REST_URL="${API_URL}/rest/v1"   # API_URL comes from lib/common.sh (per-worktree port)

pass=0
fail=0

# psql_raw <sql> — run arbitrary SQL block (already including BEGIN/ROLLBACK if
# wanted) as postgres. Returns combined stdout+stderr.
psql_raw() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0 <<SQL 2>&1
$1
SQL
}

# psql_as <auth_uid> <setup_sql> <assert_sql> — plant <setup_sql> as postgres,
# then run <assert_sql> as the authenticated persona, all in one rolled-back txn.
psql_as() {
  local uid="$1" setup="$2" assert="$3"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0 <<SQL 2>&1
BEGIN;
${setup}
SELECT set_config('request.jwt.claims',
  json_build_object('sub','${uid}','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
${assert}
ROLLBACK;
SQL
}

# psql_anon <assert_sql> — run as the unauthenticated anon role, rolled back.
psql_anon() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=0 <<SQL 2>&1
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
SET LOCAL ROLE anon;
$1
ROLLBACK;
SQL
}

scalar() { echo "$1" | grep -E '^[0-9]+$' | tail -1; }
boolean() { echo "$1" | grep -E '^[tf]$' | tail -1; }


# membership setup snippets (planted as postgres). bright-horizons users are
# non-exempt, so these genuinely flip the entitlement helpers. The seed already
# gives users 6/7/8 a basic/premium membership and user_memberships.user_id is
# UNIQUE, so we UPSERT the tier rather than insert a second row.
m_basic()  { echo "INSERT INTO user_memberships (user_id, membership_tier, is_active) VALUES ($1, 'basic', true)
  ON CONFLICT (user_id) DO UPDATE SET membership_tier='basic', is_active=true;"; }
m_fa()   { echo "INSERT INTO user_memberships (user_id, membership_tier, is_active) VALUES ($1, 'premium', true)
  ON CONFLICT (user_id) DO UPDATE SET membership_tier='premium', is_active=true;"; }
# Simulate a lapsed listing owner (read-only-degrade case). Premium is now
# TENANT-owned (tenant_memberships), so a real lapse must deactivate BOTH the
# user's own user_memberships row AND their tenant's tenant_membership —
# otherwise the tenant-owned premium entitlement keeps the tenant exempt.
m_lapse() { echo "UPDATE user_memberships SET is_active=false WHERE user_id=$1;
  UPDATE tenant_memberships SET is_active=false
    WHERE tenant_id=(SELECT tenant_id FROM users WHERE id=$1);"; }

echo "=============================================================="
echo " Charity Directory — RLS + paywall proof tests"
echo "=============================================================="

# ============================================================================
# ITEM 1 — Public teaser view leaks nothing private
# ============================================================================
# 1a. Column projection: the view must expose ONLY teaser columns.
out=$(psql_raw "SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='fiscal_agent_listings_public';")
view_cols=$(echo "$out" | tail -1)
assert_eq "teaser view exposes exactly the teaser columns" \
  "id,name,location,region,verified,focus,blurb,accepting,rating,reviews,sponsored" "$view_cols"
for forbidden in email phone website about services ein projects fee_admin_pct managed_by_user_id tenant_id; do
  if [[ ",$view_cols," == *",$forbidden,"* ]]; then
    assert_eq "teaser view does NOT expose '$forbidden'" "absent" "present"
  else
    assert_eq "teaser view does NOT expose '$forbidden'" "absent" "absent"
  fi
done

# 1b. Row filter: only published+verified rows. Seed has exactly one (Cedar Roots).
out=$(psql_anon "SELECT count(*) FROM fiscal_agent_listings_public;")
assert_eq "anon sees only published+verified rows in teaser view (1)" "1" "$(scalar "$out")"
out=$(psql_anon "SELECT name FROM fiscal_agent_listings_public;")
assert_contains "the one teaser row is the published+verified Cedar Roots" "Cedar Roots Foundation" "$out"
out=$(psql_anon "SELECT count(*) FROM fiscal_agent_listings_public WHERE name LIKE '%draft%' OR name LIKE '%Northwind%';")
assert_eq "draft + published-unverified listings are hidden from teaser" "0" "$(scalar "$out")"

# 1c. anon CANNOT read the base table at all (RLS denies / 0 rows).
out=$(psql_anon "SELECT count(*) FROM fiscal_agent_listings;")
if [[ "$out" == *"permission denied"* ]]; then
  assert_contains "anon CANNOT read base fiscal_agent_listings (privilege)" "permission denied" "$out"
else
  assert_eq "anon CANNOT read base fiscal_agent_listings (0 rows)" "0" "$(scalar "$out")"
fi

# 1d. PostgREST end-to-end with the anon key: the view returns only teaser keys.
http=$(curl -s "${REST_URL}/fiscal_agent_listings_public?select=*" -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}")
assert_contains "PostgREST anon: teaser view returns Cedar Roots" "Cedar Roots Foundation" "$http"
for forbidden in '"email"' '"phone"' '"website"' '"about"' '"services"'; do
  if [[ "$http" == *"$forbidden"* ]]; then
    assert_eq "PostgREST anon teaser has no $forbidden key" "absent" "present:$forbidden"
  else
    assert_eq "PostgREST anon teaser has no $forbidden key" "absent" "absent"
  fi
done
# anon hitting the BASE table via PostgREST must NOT return private rows.
http_base=$(curl -s "${REST_URL}/fiscal_agent_listings?select=*" -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}")
assert_contains "PostgREST anon: base table leaks no contact email" "$(
  if [[ "$http_base" == *"partnerships@cedarroots.org"* ]]; then echo LEAK; else echo NOLEAK; fi)" "NOLEAK"

# ============================================================================
# ITEM 2 — Directory SELECT gating (full rows incl. contact columns)
# ============================================================================
# Ground truth: non-owner subscribers (c basic, f premium) may read full rows
# ONLY for published+verified listings; owner (d) sees their whole tenant in any
# status; super_admin (e) sees everything. a (anon) and b (authed no access) cannot.
# Verified-only visibility is enforced in RLS, not the client (migration
# 20260704011516_rls_fiscal_agent_listing_verified_visibility).

# (a) anonymous — anon has no SELECT grant on the base table, so the read is
# rejected at the privilege layer (permission denied) — a strictly stronger gate
# than "0 rows". Accept either outcome; both mean anon reads no full listings.
out=$(psql_anon "SELECT count(*) FROM fiscal_agent_listings WHERE email IS NOT NULL;")
if [[ "$out" == *"permission denied"* ]]; then
  assert_contains "(a) anon reads 0 full listings (privilege denied)" "permission denied" "$out"
else
  assert_eq "(a) anon reads 0 full listings" "0" "$(scalar "$out")"
fi

# (b) authenticated WITHOUT basic (non-owner) sees 0 rows.
out=$(psql_as "$GRANTEE_SELF" "$(m_lapse $UID9)" "SELECT count(*) FROM fiscal_agent_listings;")
assert_eq "(b) authed user w/o basic reads 0 full listings" "0" "$(scalar "$out")"
# helper ground truth for this persona
out=$(psql_as "$GRANTEE_SELF" "$(m_lapse $UID9)" "SELECT has_basic_membership();")
assert_eq "(b) has_basic_membership() is false for lapsed grantee" "f" "$(boolean "$out")"

# (c) authenticated non-owner WITH basic sees ONLY published+verified listings.
# user 6 is a tenant-2 grantee (not an admin), so the owner arm never applies —
# the verified gate is what they get. Listing 1 (published+verified) is visible;
# listing 2 (draft) and listing 3 (published-UNverified) are not.
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "SELECT count(*) FROM fiscal_agent_listings;")
assert_eq "(c) basic non-owner reads ONLY the 1 published+verified listing" "1" "$(scalar "$out")"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "SELECT email FROM fiscal_agent_listings WHERE id=1;")
assert_contains "(c) basic non-owner CAN see contact email on published+verified listing" "partnerships@cedarroots.org" "$out"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "SELECT count(*) FROM fiscal_agent_listings WHERE id IN (2,3);")
assert_eq "(c) basic non-owner CANNOT see draft or unverified listings" "0" "$(scalar "$out")"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "SELECT has_basic_membership();")
assert_eq "(c) has_basic_membership() true after granting tier" "t" "$(boolean "$out")"

# (d) a TENANT ADMIN (no basic membership) sees their tenant's rows.
# user 8 is an admin of tenant 2, which owns listings 1+2. The tenant-admin
# clause is OR'd, so even lapsed they read their tenant's listings (read-only
# degrade) — and only those, unless they also hold basic.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "SELECT has_basic_membership();")
assert_eq "(d) admin has_basic_membership() is false (tenant-admin clause carries them)" "f" "$(boolean "$out")"
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "SELECT count(*) FROM fiscal_agent_listings WHERE tenant_id=2;")
assert_eq "(d) tenant admin reads their tenant's 2 listings" "2" "$(scalar "$out")"
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "SELECT email FROM fiscal_agent_listings WHERE id=1;")
assert_contains "(d) tenant admin CAN see contact email on own tenant's listing" "partnerships@cedarroots.org" "$out"
# admin without basic must NOT see listing 3 (tenant 1's listing).
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "SELECT count(*) FROM fiscal_agent_listings WHERE id=3;")
assert_eq "(d) tenant admin WITHOUT basic cannot read ANOTHER tenant's listings" "0" "$(scalar "$out")"

# (e) super_admin sees everything.
out=$(psql_as "$SUPER_TFAC" "" "SELECT count(*) FROM fiscal_agent_listings;")
assert_eq "(e) super_admin reads ALL 3 full listings" "3" "$(scalar "$out")"
out=$(psql_as "$SUPER_TFAC" "" "SELECT email FROM fiscal_agent_listings WHERE id=3;")
assert_contains "(e) super_admin CAN see contact email" "intake@northwindfund.org" "$out"

# (f) a PREMIUM subscriber who is NOT a listing owner ALSO reads full rows. The
# directory SELECT clause is has_basic_membership(), which returns true for the
# premium tier as well (tier IN ('basic','premium')) — so spec item (b)'s
# "basic/premium subscriber" is satisfied for premium too. user 7 owns no listing,
# isolating the premium-via-basic path from the owner clause.
out=$(psql_as "$GRANTEE_BRIGHT2" "$(m_fa $UID7)" "SELECT has_basic_membership();")
assert_eq "(f) has_basic_membership() true for premium tier (premium ⊇ basic)" "t" "$(boolean "$out")"
out=$(psql_as "$GRANTEE_BRIGHT2" "$(m_fa $UID7)" "SELECT count(*) FROM fiscal_agent_listings;")
assert_eq "(f) premium (non-owner) subscriber reads ONLY the 1 published+verified listing" "1" "$(scalar "$out")"
out=$(psql_as "$GRANTEE_BRIGHT2" "$(m_fa $UID7)" "SELECT email FROM fiscal_agent_listings WHERE id=1;")
assert_contains "(f) premium (non-owner) subscriber CAN see contact email on published+verified listing" "partnerships@cedarroots.org" "$out"
out=$(psql_as "$GRANTEE_BRIGHT2" "$(m_fa $UID7)" "SELECT count(*) FROM fiscal_agent_listings WHERE id IN (2,3);")
assert_eq "(f) premium (non-owner) subscriber CANNOT see draft or unverified listings" "0" "$(scalar "$out")"

# ============================================================================
# ITEM 3 — Inquiry INSERT gating
# ============================================================================
# Insert payload reused below.
INQ_VALS="project => '{\"name\":\"X\"}'::jsonb, contact => '{\"name\":\"Y\"}'::jsonb"
mk_insert() { # mk_insert <listing_id> <created_by_or_NULL>
  echo "INSERT INTO sponsorship_inquiries (listing_id, created_by, project, contact)
        VALUES ($1, $2, '{\"name\":\"X\"}'::jsonb, '{\"name\":\"Y\"}'::jsonb);"
}

# (3a) user WITHOUT basic is BLOCKED from inserting.
out=$(psql_as "$GRANTEE_SELF" "$(m_lapse $UID9)" "$(mk_insert 1 $UID9) SELECT 'inserted';")
assert_contains "(3a) user w/o basic BLOCKED from inquiry insert" "violates row-level security policy" "$out"

# (3b) user WITH basic CAN insert against the published+verified listing.
# NB: the INSERT succeeds (tag "INSERT 0 1") but the seeker CANNOT read the row
# back — the inquiries SELECT policy scopes reads to the listing OWNER. This is
# the documented fire-and-forget model (UX §2.2; seeker-side tracking deferred),
# so we assert on the write tag, not a readback.
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "$(mk_insert 1 $UID6)")
assert_contains "(3b) basic user CAN insert inquiry vs published+verified listing" "INSERT 0 1" "$out"
# …and confirm the seeker indeed cannot read their own just-inserted inquiry.
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "$(mk_insert 1 $UID6)
  SELECT count(*) FROM sponsorship_inquiries WHERE created_by=$UID6;")
assert_eq "(3b) seeker CANNOT read their own inquiry back (owner-scoped inbox)" "0" "$(scalar "$out")"

# (3c) basic user CANNOT insert against a draft listing (2) or
# published-but-UNverified listing (3).
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "$(mk_insert 2 $UID6) SELECT 'inserted';")
assert_contains "(3c) cannot inquire against DRAFT listing" "violates row-level security policy" "$out"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "$(mk_insert 3 $UID6) SELECT 'inserted';")
assert_contains "(3c) cannot inquire against published-UNVERIFIED listing" "violates row-level security policy" "$out"

# (3d) anti-spoof: cannot set created_by to a DIFFERENT user.
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "$(mk_insert 1 $UID7) SELECT 'inserted';")
assert_contains "(3d) cannot spoof created_by to another user" "violates row-level security policy" "$out"

# (3e) tenant_id denormalisation. When the client omits tenant_id the BEFORE-INSERT
# trigger fills it from the listing (the happy path); read back as the OWNER (the
# seeker can't, by §2.2 owner-scoping), in one rolled-back txn.
out=$(psql_raw "BEGIN;
$(m_basic $UID6)
SELECT set_config('request.jwt.claims', json_build_object('sub','$GRANTEE_BRIGHT','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO sponsorship_inquiries (listing_id, created_by, project, contact)
  VALUES (1, $UID6, '{\"name\":\"X\"}'::jsonb, '{\"name\":\"Y\"}'::jsonb);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub','$ADMIN_BRIGHT','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT tenant_id FROM sponsorship_inquiries WHERE created_by=$UID6;
ROLLBACK;")
assert_eq "(3e) inquiry tenant_id denormalised to listing's tenant (2) when omitted" "2" "$(scalar "$out")"

# (3e-FIXED) set_inquiry_tenant_id now FORCE-OVERWRITES tenant_id from the listing
# (QA finding #3 fix), so a client cannot forge a valid-but-wrong tenant_id. A seeker
# inserting against listing 1 (which belongs to tenant 2) with a forged tenant_id=1
# must end up stored as the listing's real tenant (2).
out=$(psql_raw "BEGIN;
$(m_basic $UID6)
SELECT set_config('request.jwt.claims', json_build_object('sub','$GRANTEE_BRIGHT','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO sponsorship_inquiries (listing_id, created_by, tenant_id, project, contact)
  VALUES (1, $UID6, 1, '{\"name\":\"X\"}'::jsonb, '{\"name\":\"Y\"}'::jsonb);
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub','$ADMIN_BRIGHT','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT tenant_id FROM sponsorship_inquiries WHERE created_by=$UID6;
ROLLBACK;")
assert_eq "(3e-FIXED) forged tenant_id is overwritten with listing's real tenant (2)" "2" "$(scalar "$out")"

# ============================================================================
# ITEM 4 — Listing publish/update gating (+ IDOR)
# ============================================================================
# (4a) tenant admin WITH premium access CAN publish/update their tenant's listing.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  UPDATE fiscal_agent_listings SET status='published' WHERE id=2;")
assert_contains "(4a) premium tenant admin CAN update own tenant's listing" "UPDATE 1" "$out"

# (4b) tenant admin WITHOUT premium access is BLOCKED (lapse => read-only).
# Deactivate user 8's premium so the lapse path is exercised.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "
  UPDATE fiscal_agent_listings SET blurb='hijack' WHERE id=1;")
assert_contains "(4b) admin WITHOUT premium access CANNOT update (0 rows)" "UPDATE 0" "$out"

# (4c) tenant is the ownership authority, not an individual user:
#   - a NON-admin with premium (grantee user 6, same tenant 2) cannot edit;
#   - an admin of ANOTHER tenant (exempt tfac admin, tenant 1) cannot edit;
#   - ANY admin of the listing's tenant can edit — promote user 6 to admin
#     (rolled back) and prove a second tenant-2 admin manages listing 1.
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  UPDATE fiscal_agent_listings SET blurb='IDOR' WHERE id=1;")
assert_contains "(4c) non-admin with premium CANNOT edit their tenant's listing (0 rows)" "UPDATE 0" "$out"
out=$(psql_as "$ADMIN_TFAC" "" "
  UPDATE fiscal_agent_listings SET blurb='cross-tenant' WHERE id=1;")
assert_contains "(4c) admin of ANOTHER tenant CANNOT edit the listing (0 rows)" "UPDATE 0" "$out"
# (the promotion is performed under the existing tenant-2 admin's identity so
# the users self-update guard sees a legitimate admin-managing-their-tenant edit)
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)
SELECT set_config('request.jwt.claims', json_build_object('sub','$ADMIN_BRIGHT','role','authenticated')::text, true);
UPDATE users SET role='admin' WHERE id=$UID6;" "
  UPDATE fiscal_agent_listings SET blurb='second admin' WHERE id=1;")
assert_contains "(4c) a SECOND admin of the listing's tenant CAN edit it" "UPDATE 1" "$out"

# (4d) tenant cannot be reassigned away (WITH CHECK on UPDATE). The admin
# tries to move their listing to a different tenant — must fail the WITH CHECK.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  UPDATE fiscal_agent_listings SET tenant_id=1 WHERE id=1;")
assert_contains "(4d) admin CANNOT reassign listing to another tenant (WITH CHECK)" "violates row-level security policy" "$out"

# (4e) INSERT gate: a premium tenant ADMIN can insert a listing in their own tenant…
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  INSERT INTO fiscal_agent_listings (tenant_id, name)
  VALUES (2, 'New Tenant Listing');
  SELECT count(*) FROM fiscal_agent_listings WHERE name='New Tenant Listing';")
assert_eq "(4e) premium tenant admin CAN insert listing in own tenant" "1" "$(scalar "$out")"
# …but CANNOT insert into a foreign tenant.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  INSERT INTO fiscal_agent_listings (tenant_id, name)
  VALUES (1, 'Cross Tenant'); SELECT 'ins';")
assert_contains "(4e) premium admin CANNOT insert into a foreign tenant" "violates row-level security policy" "$out"
# …a premium NON-admin cannot insert at all (ownership keys on tenant-admin role).
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  INSERT INTO fiscal_agent_listings (tenant_id, name)
  VALUES (2, 'Grantee Listing'); SELECT 'ins';")
assert_contains "(4e) premium NON-admin CANNOT insert a listing" "violates row-level security policy" "$out"
# …and a user WITHOUT premium cannot insert a listing at all.
out=$(psql_as "$GRANTEE_SELF" "" "
  INSERT INTO fiscal_agent_listings (tenant_id, name)
  VALUES (3, 'NoEntitlement'); SELECT 'ins';")
assert_contains "(4e) user WITHOUT premium CANNOT insert a listing" "violates row-level security policy" "$out"

# (4f) super_admin moderation: can flip verification on any listing.
out=$(psql_as "$SUPER_TFAC" "" "
  UPDATE fiscal_agent_listings SET verification='verified' WHERE id=3;")
assert_contains "(4f) super_admin CAN verify any listing" "UPDATE 1" "$out"

# (4g) SECURITY (review finding #1, INSERT path): an owner CANNOT self-grant the
# moderation columns on INSERT. The enforce_listing_moderation_guard trigger fires
# BEFORE INSERT for non-staff and forces verification/verified to their unverified
# defaults — so an owner cannot create a row that is born published+verified and
# slip into the public "verified" directory without super_admin review.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  INSERT INTO fiscal_agent_listings (tenant_id, name, status, verification, verified)
  VALUES (2, 'SelfVerify', 'published', 'verified', true);
  SELECT verification||'/'||verified FROM fiscal_agent_listings WHERE name='SelfVerify';")
assert_contains "(4g) admin self-verify via INSERT is forced to pending/unverified" "pending/f" "$out"
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  INSERT INTO fiscal_agent_listings (tenant_id, name, status, verification, verified)
  VALUES (2, 'SelfVerify2', 'published', 'verified', true);
  SELECT count(*) FROM fiscal_agent_listings_public WHERE name='SelfVerify2';")
assert_eq "(4g) self-'verified' INSERT does NOT appear in public directory" "0" "$(scalar "$out")"

# (4h) SECURITY (review finding #1, UPDATE path): the moderation guard must ALSO
# block self-verification via UPDATE, not just INSERT. The guard's UPDATE branch
# force-restores OLD.verification/OLD.verified for non-staff, so even though the
# owner UPDATE policy lets a premium owner edit their own still-unverified draft
# (listing 2 = pending/false in seed), an attempt to flip the moderation columns is
# silently reverted. Without this the owner could self-grant the verified badge.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  UPDATE fiscal_agent_listings SET verification='verified', verified=true WHERE id=2;
  SELECT verification||'/'||verified FROM fiscal_agent_listings WHERE id=2;")
assert_contains "(4h) owner self-verify via UPDATE is reverted to pending/unverified" "pending/f" "$out"

# (4i) self-PUBLISH is intentionally allowed (the owner controls go-live) but is
# INERT without staff verification: an owner publishing their still-unverified
# listing 2 does NOT surface it in the public teaser, which keys on
# status='published' AND verification='verified'. This is the "blocks self-publish"
# property at the visibility layer — the two-key model means an owner acting alone
# can never push a row into the public verified directory.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  UPDATE fiscal_agent_listings SET status='published' WHERE id=2;
  SELECT count(*) FROM fiscal_agent_listings_public WHERE id=2;")
assert_eq "(4i) owner self-publish (unverified) does NOT surface in public teaser" "0" "$(scalar "$out")"

# ============================================================================
# ITEM 5 — Inquiry SELECT scoping (owner sees only own listings' inquiries)
# ============================================================================
# user 8 owns listing 1 (which has the 2 seeded inquiries). user 4 owns listing 3
# (no inquiries). Plant a fresh inquiry on listing 3 to prove cross-owner isolation.
INQ3_SETUP="INSERT INTO sponsorship_inquiries (listing_id, created_by, project, contact)
  VALUES (3, NULL, '{\"name\":\"Z\"}'::jsonb, '{\"name\":\"W\"}'::jsonb);"

# (5a) owner of listing 1 sees its 2 inquiries.
out=$(psql_as "$ADMIN_BRIGHT" "$INQ3_SETUP" "SELECT count(*) FROM sponsorship_inquiries;")
assert_eq "(5a) listing-1 owner sees ONLY their 2 inquiries (not listing-3's)" "2" "$(scalar "$out")"
out=$(psql_as "$ADMIN_BRIGHT" "$INQ3_SETUP" "SELECT count(*) FROM sponsorship_inquiries WHERE listing_id=3;")
assert_eq "(5a) listing-1 owner CANNOT read another owner's (listing-3) inquiries" "0" "$(scalar "$out")"

# (5b) a basic seeker (non-owner) sees ZERO inquiries (cannot read inbox).
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "SELECT count(*) FROM sponsorship_inquiries;")
assert_eq "(5b) basic seeker CANNOT read any inquiry inbox" "0" "$(scalar "$out")"

# (5c) super_admin sees all inquiries.
out=$(psql_as "$SUPER_TFAC" "$INQ3_SETUP" "SELECT count(*) FROM sponsorship_inquiries;")
assert_eq "(5c) super_admin sees ALL inquiries (2 seed + 1 planted)" "3" "$(scalar "$out")"

# (5d) inquiry UPDATE (triage): owner WITH premium CAN; non-owner / lapsed CANNOT.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  UPDATE sponsorship_inquiries SET status='accepted' WHERE id=1;")
assert_contains "(5d) owner+premium CAN triage own inquiry" "UPDATE 1" "$out"
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "
  UPDATE sponsorship_inquiries SET status='accepted' WHERE id=1;")
assert_contains "(5d) lapsed owner (no premium) CANNOT triage (0 rows)" "UPDATE 0" "$out"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  UPDATE sponsorship_inquiries SET status='declined' WHERE id=1;")
assert_contains "(5d) non-owner with premium CANNOT triage another's inquiry (0 rows)" "UPDATE 0" "$out"

# ============================================================================
# ITEM 6 — get_session_context exposes the entitlement keys
# ============================================================================
# a premium subscriber DOES have hasPremiumAccess, which gates listing ownership.
out=$(psql_as "$GRANTEE_BRIGHT2" "$(m_fa $UID7)" "SELECT (get_session_context()->'membership'->>'hasPremiumAccess');")
assert_eq "(6) hasPremiumAccess=true for premium subscriber (drives listing ownership)" "true" "$(echo "$out" | grep -E '^(true|false)$' | tail -1)"
# existing keys retained
out=$(psql_as "$GRANTEE_BRIGHT" "" "SELECT (get_session_context()->'membership') ? 'hasBasicAccess' AND (get_session_context()->'membership') ? 'hasPremiumAccess' AND (get_session_context()->'membership') ? 'isExempt';")
assert_eq "(6) existing membership keys (basic/premium/isExempt) retained" "t" "$(boolean "$out")"
# exempt persona (platform-root admin) passes premium (ownership)
out2=$(psql_as "$ADMIN_TFAC" "" "SELECT (get_session_context()->'membership'->>'hasPremiumAccess')::boolean;")
assert_eq "(6) exempt platform-root admin passes premium entitlements" "t" "$(boolean "$out2")"

# ============================================================================
# ITEM 7 — accept_sponsorship_inquiry RPC (fiscal-sponsorship loop closure)
# ============================================================================
# Seed inquiry 1 targets listing 1 (Cedar Roots, tenant 2), created_by maria
# (tenant 1 grantee). Accepting must be limited to admins of the LISTING's
# tenant, must onboard the seeker as a tenant-2 grantee with a pending
# grant_record there, and must be idempotent on double-accept.

# rpc_as <auth_uid> <sql-after-rpc> — call the RPC as a persona inside one
# rolled-back txn, then verify post-state as postgres (RESET ROLE).
rpc_as() {
  local uid="$1" post="$2"
  psql_raw "
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','${uid}','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT 'RPCOK:' || (accept_sponsorship_inquiry(1)->>'grant_id' IS NOT NULL);
RESET ROLE;
${post}
ROLLBACK;"
}

# (7a) a grantee of the listing tenant (non-admin) CANNOT accept.
out=$(rpc_as "$GRANTEE_BRIGHT" "")
assert_contains "(7a) non-admin of listing tenant CANNOT accept inquiry" \
  "Only an admin of the sponsoring tenant can accept this inquiry" "$out"

# (7b) an admin of ANOTHER tenant (tenant 1) CANNOT accept a tenant-2 inquiry.
out=$(rpc_as "$ADMIN_TFAC" "")
assert_contains "(7b) admin of a different tenant CANNOT accept inquiry" \
  "Only an admin of the sponsoring tenant can accept this inquiry" "$out"

# (7c) an admin of the listing's tenant CAN accept: seeker re-homed into
# tenant 2 as grantee, a pending grant_record filed there, inquiry accepted.
out=$(rpc_as "$ADMIN_BRIGHT" "
SELECT 'SEEKER:' || tenant_id || ':' || role FROM users WHERE email='maria.smith@example.com';
SELECT 'GRANT:' || g.tenant_id || ':' || g.status
  FROM grant_record g JOIN sponsorship_inquiries i ON i.grant_id = g.id WHERE i.id = 1;
SELECT 'INQ:' || status FROM sponsorship_inquiries WHERE id = 1;")
assert_contains "(7c) listing-tenant admin CAN accept (grant created)" "RPCOK:t" "$out"
assert_contains "(7c) seeker onboarded as tenant-2 grantee" "SEEKER:2:grantee" "$out"
assert_contains "(7c) pending grant_record filed in tenant 2" "GRANT:2:pending" "$out"
assert_contains "(7c) inquiry marked accepted" "INQ:accepted" "$out"

# (7d) idempotent: a double-accept returns the SAME grant, creates no second one.
out=$(psql_raw "
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','${ADMIN_BRIGHT}','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT 'IDEM:' ||
  ((accept_sponsorship_inquiry(1)->>'grant_id') = (accept_sponsorship_inquiry(1)->>'grant_id'));
SELECT 'AGAIN:' || (accept_sponsorship_inquiry(1)->>'already_accepted');
ROLLBACK;")
assert_contains "(7d) double-accept returns the same grant_id" "IDEM:t" "$out"
assert_contains "(7d) double-accept reports already_accepted" "AGAIN:true" "$out"

# (7e) anon cannot execute the RPC at all.
out=$(psql_anon "SELECT accept_sponsorship_inquiry(1);")
assert_contains "(7e) anon BLOCKED from accept RPC" "permission denied" "$out"

echo "=============================================================="
echo " RESULTS: ${pass} passed, ${fail} failed"
echo "=============================================================="
[[ "$fail" -eq 0 ]]
