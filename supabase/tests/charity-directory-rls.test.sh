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
# Seed fixture (see supabase/seed.sql §8):
#   listing 1  Cedar Roots Foundation     tenant 2, owner user 8  published+verified
#   listing 2  Bright Avenue Collective    tenant 2, owner user 8  draft+pending
#   listing 3  Northwind Community Fund     tenant 1, owner user 4  published+pending
#   inquiry 1/2  -> listing 1 (Cedar Roots), tenant 2
#
# Prerequisites (local only — never touches production):
#   npm run db:reset      # apply all migrations + seed fresh
#
# Run:  bash supabase/tests/charity-directory-rls.test.sh

set -uo pipefail

PROJECT_ID="grant-trail"
DB_CONTAINER="supabase_db_${PROJECT_ID}"

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
REST_URL='http://127.0.0.1:54321/rest/v1'

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

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then echo "PASS: $name"; pass=$((pass+1));
  else echo "FAIL: $name  (expected [$expected], got [$actual])"; fail=$((fail+1)); fi
}
assert_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then echo "PASS: $name"; pass=$((pass+1));
  else echo "FAIL: $name  (expected to contain [$needle], got [$haystack])"; fail=$((fail+1)); fi
}

# membership setup snippets (planted as postgres). bright-horizons users are
# non-exempt, so these genuinely flip the entitlement helpers. The seed already
# gives users 6/7/8 a basic/premium membership and user_memberships.user_id is
# UNIQUE, so we UPSERT the tier rather than insert a second row.
m_basic()  { echo "INSERT INTO user_memberships (user_id, membership_tier, is_active) VALUES ($1, 'basic', true)
  ON CONFLICT (user_id) DO UPDATE SET membership_tier='basic', is_active=true;"; }
m_fa()   { echo "INSERT INTO user_memberships (user_id, membership_tier, is_active) VALUES ($1, 'premium', true)
  ON CONFLICT (user_id) DO UPDATE SET membership_tier='premium', is_active=true;"; }
# Simulate a lapsed listing owner: the seed gives user 8 an active premium row, so
# deactivate it to drop has_premium_membership() (the read-only-degrade case).
m_lapse() { echo "UPDATE user_memberships SET is_active=false WHERE user_id=$1;"; }

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
for forbidden in email phone website about services ein projects fee_admin_pct owner_user_id tenant_id; do
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
# Ground truth: only personas c (basic), d (owner), e (super_admin)
# may read full rows with contact columns. a (anon) and b (authed no access) cannot.

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

# (c) authenticated WITH basic sees ALL listings incl. contact columns.
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "SELECT count(*) FROM fiscal_agent_listings;")
assert_eq "(c) basic user reads ALL 3 full listings" "3" "$(scalar "$out")"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "SELECT email FROM fiscal_agent_listings WHERE id=1;")
assert_contains "(c) basic user CAN see contact email" "partnerships@cedarroots.org" "$out"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_basic $UID6)" "SELECT has_basic_membership();")
assert_eq "(c) has_basic_membership() true after granting tier" "t" "$(boolean "$out")"

# (d) the listing OWNER (no basic membership) sees their OWN rows.
# user 8 owns listings 1+2. Owner clause is OR'd, so even without basic
# they should read their own (and via that clause, only their own unless they also
# hold basic). Verify they see their two owned rows.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "SELECT has_basic_membership();")
assert_eq "(d) owner has_basic_membership() is false (owner clause carries them)" "f" "$(boolean "$out")"
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "SELECT count(*) FROM fiscal_agent_listings WHERE owner_user_id=$UID8;")
assert_eq "(d) owner reads their own 2 listings" "2" "$(scalar "$out")"
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "SELECT email FROM fiscal_agent_listings WHERE id=1;")
assert_contains "(d) owner CAN see contact email on own listing" "partnerships@cedarroots.org" "$out"
# owner without basic must NOT see listing 3 (owned by user 4, tenant 1).
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "SELECT count(*) FROM fiscal_agent_listings WHERE id=3;")
assert_eq "(d) owner WITHOUT basic cannot read OTHER owners' listings" "0" "$(scalar "$out")"

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
assert_eq "(f) premium (non-owner) subscriber reads ALL 3 full listings" "3" "$(scalar "$out")"
out=$(psql_as "$GRANTEE_BRIGHT2" "$(m_fa $UID7)" "SELECT email FROM fiscal_agent_listings WHERE id=1;")
assert_contains "(f) premium (non-owner) subscriber CAN see contact email" "partnerships@cedarroots.org" "$out"

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
# (4a) owner WITH premium access CAN publish/update their own listing.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  UPDATE fiscal_agent_listings SET status='published' WHERE id=2;")
assert_contains "(4a) premium owner CAN update own listing" "UPDATE 1" "$out"

# (4b) owner WITHOUT premium access is BLOCKED (lapse => read-only). user 8 owns
# the row; deactivate their premium so the lapse path is exercised.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_lapse $UID8)" "
  UPDATE fiscal_agent_listings SET blurb='hijack' WHERE id=1;")
assert_contains "(4b) owner WITHOUT premium access CANNOT update (0 rows)" "UPDATE 0" "$out"

# (4c) IDOR: user A (with premium) cannot edit user B's listing. Grant user 6
# premium and have them try to edit listing 1 (owned by user 8).
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  UPDATE fiscal_agent_listings SET blurb='IDOR' WHERE id=1;")
assert_contains "(4c) IDOR: non-owner with premium CANNOT edit another's listing (0 rows)" "UPDATE 0" "$out"

# (4d) ownership/tenant cannot be reassigned away (WITH CHECK on UPDATE). Owner
# tries to move their listing to a different tenant — must fail the WITH CHECK.
out=$(psql_as "$ADMIN_BRIGHT" "$(m_fa $UID8)" "
  UPDATE fiscal_agent_listings SET tenant_id=1 WHERE id=1;")
assert_contains "(4d) owner CANNOT reassign listing to another tenant (WITH CHECK)" "violates row-level security policy" "$out"

# (4e) INSERT gate: user with premium CAN insert their own listing in own tenant…
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  INSERT INTO fiscal_agent_listings (tenant_id, owner_user_id, name)
  VALUES (2, $UID6, 'New Owned Listing');
  SELECT count(*) FROM fiscal_agent_listings WHERE name='New Owned Listing';")
assert_eq "(4e) premium user CAN insert own listing in own tenant" "1" "$(scalar "$out")"
# …but CANNOT insert into a foreign tenant, or with a forged owner.
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  INSERT INTO fiscal_agent_listings (tenant_id, owner_user_id, name)
  VALUES (1, $UID6, 'Cross Tenant'); SELECT 'ins';")
assert_contains "(4e) premium user CANNOT insert into a foreign tenant" "violates row-level security policy" "$out"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  INSERT INTO fiscal_agent_listings (tenant_id, owner_user_id, name)
  VALUES (2, $UID8, 'Forged Owner'); SELECT 'ins';")
assert_contains "(4e) premium user CANNOT insert with a forged owner_user_id" "violates row-level security policy" "$out"
# …and a user WITHOUT premium cannot insert a listing at all.
out=$(psql_as "$GRANTEE_SELF" "" "
  INSERT INTO fiscal_agent_listings (tenant_id, owner_user_id, name)
  VALUES (3, $UID9, 'NoEntitlement'); SELECT 'ins';")
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
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  INSERT INTO fiscal_agent_listings (tenant_id, owner_user_id, name, status, verification, verified)
  VALUES (2, $UID6, 'SelfVerify', 'published', 'verified', true);
  SELECT verification||'/'||verified FROM fiscal_agent_listings WHERE name='SelfVerify';")
assert_contains "(4g) owner self-verify via INSERT is forced to pending/unverified" "pending/f" "$out"
out=$(psql_as "$GRANTEE_BRIGHT" "$(m_fa $UID6)" "
  INSERT INTO fiscal_agent_listings (tenant_id, owner_user_id, name, status, verification, verified)
  VALUES (2, $UID6, 'SelfVerify2', 'published', 'verified', true);
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

echo "=============================================================="
echo " RESULTS: ${pass} passed, ${fail} failed"
echo "=============================================================="
[[ "$fail" -eq 0 ]]
