# Security & RLS-Performance Audit — GrantTrail

Scope: dependency CVEs, Supabase Edge Functions, secrets/config/headers, auth/session,
and every RLS policy in `supabase/migrations/` (correctness + index backing).
Method: static read-only review (`npm audit` ran locally on frontend + root; no live DB).
Branch: `audit/security`. Date: 2026-06-30.

## Scores

| Dimension | Score (1–5, 5 = best) | One-line rationale |
|---|---|---|
| **Security** | **2 / 5** | Strong perimeter (verified webhooks, token-derived identity, tenant-scoped storage, a prior RLS-escalation audit) is undermined by one **confirmed CRITICAL privilege-escalation hole** in the `users` INSERT path plus a HIGH invite-tampering policy. |
| **RLS performance** | **4 / 5** | Indexing is genuinely thorough — **every** RLS predicate column (tenant_id, owner ids, status, token) is backed by a btree or unique index. The only drag is un-wrapped `STABLE` helper calls in policies (no initplan caching). No missing index found. |

---

## Ranked findings (exploitability × impact)

### F1 — CRITICAL: any authenticated user can self-insert a `super_admin` row → full platform takeover
- **Where:** policy `"Users can insert their own user record"` — `supabase/migrations/20260616000000_initial_schema.sql:2519`
  (`FOR INSERT WITH CHECK (auth.uid() = user_id)`); table granted `ALL` to `authenticated` (`:3365`).
- **Why it works:** the `WITH CHECK` pins only `user_id`. `role`, `tenant_id`, `is_active`
  are unconstrained. The only INSERT-time trigger, `enforce_self_service_role`
  (`:173`, trigger `:2032`), blocks **only** `role='admin'` on `self_service` tenants —
  it does **not** block `role='super_admin'`, nor `role='admin'` on managed tenants.
  `is_super_admin()` (`:434`) is global/tenant-agnostic, and `is_active` defaults `true`.
- **Exploit:** sign up through the open self-service flow (gets an `auth.uid`), then call
  `supabase.from('users').insert({ user_id: <my auth uid>, role: 'super_admin', tenant_id: <any>, email: <new> })`.
  RLS passes (`auth.uid = user_id`); the self-service trigger ignores `super_admin`.
  Result: cross-tenant read/write over every tenant.
- **Root cause:** migration `20260619120000_rls_audit_fix_privilege_escalation.sql` fixed the
  identical bug on the **UPDATE** path (trigger `trg_aa_enforce_user_self_update_guard`,
  *BEFORE UPDATE* only) but left the **INSERT** path open. The client signup
  (`frontend/src/components/auth/CompleteProfile.js:87`) also writes `role: invite.role`
  straight from the client — role is never tied server-side to a real invite.
- **Fix (human review required — auth/RLS change, NOT auto-applied):** force `role` for
  non-privileged callers at INSERT. Mirror the existing self-update guard: extend (or add)
  a `BEFORE INSERT OR UPDATE` trigger on `public.users` that, when
  `NOT (service_role OR is_admin() OR is_super_admin())`, forces `role := 'grantee'` and
  pins `tenant_id`. For the admin-invite case, derive the role server-side from the
  validated, unconsumed invite token inside a `SECURITY DEFINER` RPC instead of trusting
  the client-supplied `role`.

### F2 — HIGH: `"System can update invites"` is `USING (true) WITH CHECK (true)` → invite tampering / role escalation
- **Where:** `supabase/migrations/20260616000000_initial_schema.sql:2462`; `invites` still
  granted `ALL` to `authenticated` (`:3269`; D7 revoked only `anon`).
- **Impact:** any authenticated user can `PATCH /invites?id=eq.<n>` (no SELECT needed with
  `return=minimal`) and rewrite **any** invite's `role`/`email`/`used_at` across tenants.
  Combined with F1's role-trusting signup, an attacker can flip a pending invite to
  `role='admin'`; standalone it allows invite hijack and consumption DoS.
- **Note:** consumption now goes through the `consume_invite` SECURITY-DEFINER RPC
  (`20260619170000`), so this broad UPDATE policy is **vestigial**.
- **Fix (human review):** drop the `USING(true)` policy; if a write path is still needed,
  scope it to tenant admins, or rely solely on the SECURITY-DEFINER RPC (which bypasses RLS).

### F3 — MEDIUM: `"System can insert notifications" WITH CHECK (true)` → in-app phishing / spoofing
- **Where:** `20260616000000_initial_schema.sql:2454`; `notifications` granted `ALL` to
  `authenticated` (`:3281`). Sibling: `"System can insert status history" WITH CHECK (true)` (`:2458`).
- **Impact:** an authenticated user can insert arbitrary notifications targeting any
  `user_id` (sequential int) with attacker-controlled `title`/`message`/`link` — e.g. a
  fake "Grant Approved — click here" phishing link. The legitimate writers are
  SECURITY-DEFINER triggers that bypass RLS, so these `true` policies serve no client need.
- **Fix (human review):** restrict INSERT to `tenant_id = current_tenant_id()` at minimum,
  or remove the client INSERT grant entirely (triggers don't need it).

### F4 — MEDIUM/LOW: storage read is tenant-scoped but not grant-owner-scoped (intra-tenant IDOR)
- **Where:** `supabase/migrations/20260619150000_storage_tenant_scoping.sql:64` (grant-documents)
  and `:94` (receipts) — SELECT `USING (storage_object_tenant_id(name) = current_tenant_id() OR is_super_admin())`.
- **Impact:** the `receipts`/`grant_attachments` **table** RLS restricts a grantee to **their own**
  grants, but the storage-object policy only checks the **tenant** path segment. A grantee can
  `createSignedUrl` for any object under their tenant's prefix
  (`receipts/<tenant>/<grant_id>/<expense_id>/<file>`, ids sequential), reading another
  grantee's receipts/attachments if the path is guessed. Buckets are private (`public=false`),
  so this is the only read path — but it is broader than the table RLS it mirrors.
- **Fix (human review):** for non-admin callers, additionally require that the path's
  `grant_id` segment belongs to a grant the caller owns. (Admins/super_admin keep tenant-wide read.)

### F5 — LOW: `xlsx` (SheetJS) high-severity advisory, no npm fix available
- **Where:** `frontend/package.json:18` `"xlsx": "^0.18.5"`. `npm audit` → 1 high
  (Prototype Pollution + ReDoS). **No fixed version on the npm registry** (SheetJS now
  distributes only via its own CDN), so a patch bump cannot be applied safely here.
- **Exposure:** used for client-side spreadsheet export; risk is parsing attacker-controlled
  workbooks. Export-only usage lowers practical risk. (Root `npm audit` is clean.)
- **Fix (human review):** migrate to the SheetJS CDN build (`https://cdn.sheetjs.com/...`)
  or swap to a maintained lib (e.g. `exceljs`). CI already runs `npm audit --audit-level=high || true`
  (`.github/workflows/ci.yml:51`) advisory-only, so this won't block builds.

### F6 — LOW: CSP is **Report-Only** (not enforced)
- **Where:** `vercel.json` — header `Content-Security-Policy-Report-Only`. Other headers
  (HSTS preload, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy) are correctly enforced.
- **Assessment:** the policy looks production-ready (`script-src 'self' js.stripe.com`,
  `object-src 'none'`, `frame-ancestors 'none'`, scoped `connect-src`). Promote to enforcing
  `Content-Security-Policy` after a short report-collection window. **Not auto-enforced here**
  (could break the app; explicitly out of scope for safe auto-fix).

### F7 — LOW: `notify-inquiry` has auth but no rate limit
- **Where:** `supabase/functions/notify-inquiry/index.ts`. `verify_jwt = true`
  (`supabase/config.toml:421`), so a valid session is required (good). But an authenticated
  seeker can enumerate `inquiryId` to trigger notification emails (bounded to existing
  inquiries; "not_found" returned quietly). Already tracked as a deferred follow-up
  (rate-limit) in project memory.
- **Fix:** add a per-user/IP rate limit (deferred item).

---

## What is solid (no action)

- **Stripe webhook** (`stripe-webhook/index.ts`): signature verified via
  `stripe.webhooks.constructEventAsync` before any side effect; idempotency via
  `billing_webhook_events` lookup; email/provisioning failures isolated so Stripe retries
  only real failures. (Minor: the idempotency row is inserted *after* processing — handlers
  are upserts, so re-delivery is safe; acceptable.)
- **Caller identity** is derived from the **verified bearer token**
  (`requireAuthenticatedProfile` → `adminSupabase.auth.getUser(token)`), never from the
  request body, in all four authenticated checkout/portal/sync functions.
- **`verify_jwt`** is correctly set: `false` only for `stripe-webhook` (manual signature) and
  `create-fiscal-agent-checkout-session` (pay-first public intake); `true` everywhere else.
- **Secrets:** none committed (only `*.env.example`); `.gitignore` covers `.env*`; deploy
  injects via GitHub Actions secrets → `supabase secrets set`.
- **Prior RLS hardening is real and effective:** D7 invite world-read fix (`20260619140000`),
  privilege-escalation UPDATE fix (`20260619120000`), storage tenant scoping (`20260619150000`),
  the charity-directory moderation guard + matching `USING`/`WITH CHECK` on every write
  (`20260624120000`).
- **WITH CHECK coverage:** every writable table's `USING` predicate that pins tenant/owner
  also serves as a safe implicit `WITH CHECK` (or has an explicit one); the one genuinely
  dangerous case (`users` UPDATE) is handled by trigger. The remaining gap is INSERT-side (F1).

## RLS performance detail

- **Indexes:** confirmed btree/unique backing for every RLS-filtered column —
  `*.tenant_id`, `grant_record.user_id`/`status`, `users.user_id`/`tenant_id`/`role`,
  `user_memberships.user_id` (UNIQUE), `billing_customers.user_id` (UNIQUE),
  `subscriptions.user_id`, `feature_entitlements.grantee_id`, `audit_log.changed_by`,
  `invites.token`, `fiscal_agent_listings.owner_user_id` + `(status,verification)`,
  `sponsorship_inquiries.listing_id`. **No missing-index migration is warranted** (none added).
- **Only perf concern (MEDIUM, at scale):** policies call `current_tenant_id()`, `is_admin()`,
  `has_basic_membership()`, `auth.uid()` **directly**. Though `STABLE`, Supabase's guidance is
  to wrap them as scalar subselects — `(SELECT current_tenant_id())` — so the planner evaluates
  once per query (initplan) instead of per row. This is a mechanical but wide change (touches
  most policies) → flag for a follow-up, not auto-applied.

## Remediation plan (priority order)

1. **F1 (CRITICAL):** add a `BEFORE INSERT` role/tenant guard on `public.users` (or tighten the
   self-insert `WITH CHECK`); derive invite role server-side. New migration e.g.
   `supabase/migrations/<ts>_users_insert_privilege_guard.sql` (RLS change — human-authored/reviewed).
2. **F2 (HIGH):** drop/scope `"System can update invites"`.
3. **F3 (MEDIUM):** scope `"System can insert notifications"` / `"...status history"` to own tenant
   or revoke client INSERT.
4. **F4 (MEDIUM/LOW):** add grant-ownership check to storage SELECT for non-admins.
5. **F5 (LOW):** move `xlsx` to the SheetJS CDN build / `exceljs`.
6. **F6 (LOW):** promote CSP from Report-Only to enforcing after a report window.
7. **Perf:** wrap RLS helper calls in `(SELECT …)` for initplan caching.

> No code fixes were auto-applied: F1–F4 are RLS/auth changes (explicitly out of safe-fix scope),
> F5 has no safe npm patch, F6 risks breaking the app. All are flagged for human review.
