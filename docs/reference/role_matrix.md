# GrantTrail Role / Permission Matrix

> Derived entirely from source. Every claim cites `file:line`. Two enforcement
> layers exist and are documented separately:
>
> 1. **Frontend route guards** — `frontend/src/App.js` (`<Route>` `element`
>    ternaries). These decide which page React renders. They are *not* a
>    security boundary; a forged client can bypass them.
> 2. **Row-Level Security (RLS)** — `supabase/migrations/*`. The real
>    authorization boundary, enforced by Postgres regardless of client.
>
> A third axis — **billing exemption / waiver** — is **orthogonal to role** and
> documented in its own section. It gates *feature use* (can this user write
> grant data right now), not *authorization* (what tables/rows the role may ever
> touch).

Roles come from the `users.role` column; the only values used in code are
`super_admin`, `admin`, `grantee` (e.g. `App.js:350,352,328`; invite role check
`invites_role_check` allows only `admin`/`grantee`,
`supabase/migrations/20260616000000_initial_schema.sql:1305`). `grantee` is the
default assigned by self-service provisioning
(`...initial_schema.sql:790`).

---

## 1. Frontend route access (`frontend/src/App.js`)

Legend: ✅ = renders the component · ↪ = redirected · ❌ = redirected away
(no access). "sub-gate" = additionally blocked when the role lacks the required
subscription and not exempt (see §3).

| Route | super_admin | admin | grantee | Source (`App.js`) |
|---|---|---|---|---|
| `/` (root) | ↪ `/super/tenants` | ↪ `/admin` (or `/home` if sub-restricted) | `<Main>` (or ↪ `/home` if no sub) | `345-356` |
| `/home` | ✅ `LandingPage` | ✅ | ✅ | `357-360` (any session) |
| `/login` | ✅ (public) | ✅ | ✅ | `361-364` |
| `/signup` | ✅ (public) | ✅ | ✅ | `365-368` |
| `/reset-password` | ✅ (public) | ✅ | ✅ | `369-372` |
| `/complete-profile` | gated by `needsProfile` | same | same | `373-382` |
| `/grants` | ✅ (no sub-gate¹) | ✅ (no sub-gate¹) | ✅ sub-gate² | `385-388` |
| `/grants/new` | ✅¹ | ✅¹ | ✅ sub-gate² | `389-392` |
| `/grants/:id/edit` | ✅¹ | ✅¹ | ✅ sub-gate² | `393-396` |
| `/grants/:id` | ✅¹ | ✅¹ | ✅ sub-gate² | `397-400` |
| `/grants/:id/breakdown` | ✅¹ | ✅¹ | ✅ sub-gate² | `401-404` |
| `/expenses` | ✅¹ | ✅¹ | ✅ sub-gate² | `405-408` |
| `/subscription` | ✅ | ✅ | ✅ | `409-412` (any session) |
| `/admin` | ❌ ↪ `/` | ✅ sub-gate³ | ❌ ↪ `/` | `415-418` |
| `/admin/grants` | ❌ ↪ `/` | ✅ sub-gate³ | ❌ ↪ `/` | `419-422` |
| `/admin/grants/:id` | ❌ ↪ `/` | ✅ sub-gate³ | ❌ ↪ `/` | `423-426` |
| `/admin/audit` | ❌ ↪ `/` | ✅ sub-gate³ | ❌ ↪ `/` | `427-430` |
| `/admin/users` | ❌ ↪ `/` | ✅ sub-gate³ | ❌ ↪ `/` | `431-434` |
| `/admin/settings` | ❌ ↪ `/` | ✅ sub-gate³ | ❌ ↪ `/` | `435-438` |
| `/super/tenants` | ✅ `TenantManagement` | ❌ ↪ `/` | ❌ ↪ `/` | `441-444` |

¹ The `/grants*` and `/expenses` guards only gate on
`isGranteeWithoutSubscription` (`App.js:328`), which is **role === 'grantee'**
specific. super_admin and admin pass these guards unconditionally — they are
never redirected off the grantee grant pages (`App.js:387` etc.).
² Grantee blocked from these routes when `isGranteeWithoutSubscription` is true,
i.e. grantee lacks `hasBasicAccess` and is not exempt (`App.js:328,387-407`).
³ Admin `/admin*` routes additionally redirect to `/home` when
`isAdminWithoutSubscription` (`App.js:329,417` …). Admin sub requirement =
needs premium unless exempt (`billing.js:290-292`).

---

## 2. RLS table capability matrix

Capability per role, derived from `CREATE POLICY` / `ALTER POLICY` statements.
All tables have RLS enabled
(`...initial_schema.sql:2645-2702`). `none` means no policy grants that role
access (RLS default-denies). `write` covers INSERT/UPDATE/DELETE as noted.

Key helper predicates (all `SECURITY DEFINER`):
- `is_super_admin()` → caller's `users.role = 'super_admin'` & active, **tenant-agnostic** (`...initial_schema.sql:434-446`).
- `is_admin()` → caller `role = 'admin'`, active, **and** `tenant_id = current_tenant_id()` (`...initial_schema.sql:378-391`) — i.e. **own tenant only**.
- `current_tenant_id()` → caller's tenant (`...initial_schema.sql:125-129`).
- Grantee policies key off `user_id`/`grant_id` ownership via `auth.uid()`.

"Owner" below = the grantee who owns the row (their grant / their record).
super_admin gains access wherever a policy explicitly OR's `is_super_admin()`;
where it does not, super_admin has **no** access via that table's policies
(but is exempt from the *subscription* gate everywhere).

| Table | super_admin | admin (own tenant) | grantee | Policy source (`...initial_schema.sql` unless noted) |
|---|---|---|---|---|
| `tenants` | read+write (manage all) | read own tenant | read own tenant | mng `2442`; view own/super `2637`; auth read names `2408` |
| `tenant_settings` | read; insert; update | read own; update own | read own | super insert `2438`; admin update `2356`; read own/super `2412` |
| `platform_settings` | read; update | read | read | anyone read `2404`; super update `2446` |
| `system_logs` | read | none | none | super select `2450`; (service_role INSERT only, `20260617160000:19`) |
| `users` | read+update (via super OR) | read tenant; update tenant | read **own only**; insert own; update own | admin view `2392`/update `2360`; self view `2641`/insert `2519`/update `2569` |
| `invites` | read; insert; (update via "System") | read tenant; insert tenant | read by token only | admin view `2396`/insert `2320`; anyone-by-token `2400`; system update `2462` |
| `grant_record` | read; update (super OR) | read tenant; update tenant | read own; insert own⁴; update own⁴ | admin view `2384`/update `2352`; owner view `2619`/insert `2507`/update `2555` |
| `budget_items` | read; update; delete (super OR) | read/update/delete tenant | read own-grant; ins/upd/del own-grant⁴ | admin `2368/2344/2324`; owner `2591/2493/2541/2473` |
| `expenses` | read; update; delete (super OR) | read/update/delete tenant | read own-grant; ins/upd/del own-grant⁴ | admin `2372/2348/2328`; owner `2605/2500/2548/2480` |
| `grant_attachments` | read (super not OR'd — see note) | read tenant | read own-grant; insert⁴; delete own-grant | admin view `2376`; owner view `2580`/upload `2573`/delete `2466` |
| `grant_comments` | none (no super OR) | read tenant; **insert** | read own-grant (+ admin) only | admin insert `2332`; view `2598`. **No grantee INSERT, no UPDATE/DELETE policy at all** |
| `grant_status_history` | read (super OR) | read tenant | read own-grant | admin view `2380`; owner view `2612`; system insert `2458` |
| `receipts` | read (super OR) | read tenant | read own; insert own⁴ | admin view `2388`; owner view `2631`/insert `2513` |
| `notifications` | none (no super OR) | none (no admin policy) | read/update/delete own | owner view `2625`/update `2561`/delete `2487`; system insert `2454` |
| `audit_log` | read (super OR) | read tenant | read rows they changed | admin view `2364`; self-changed `2587` |
| `feature_entitlements` | none | none | read own | grantee view `2416` |
| `user_memberships` | none (no super OR) | read+write tenant members | read own | admin manage `2336`; owner read `2529` (service_role manage `2426`) |
| `subscriptions` | none (no super OR) | none | read own | owner read `2535` (service_role manage `2430`) |
| `billing_customers` | none | none | read own | owner read `2523` (service_role manage `2422`) |
| `billing_webhook_events` | none | none | none | service_role only `2434` |

⁴ Grantee write to `grant_record`, `expenses`, `budget_items`, `receipts`,
`grant_attachments` is **subscription-gated** by `has_basic_membership()` added
to the WITH CHECK / USING clauses
(`supabase/migrations/20260617150000_subscription_gating_rls.sql:27-98`).
SELECT and DELETE remain ungated (lapsed grantees keep read/export/delete;
`...subscription_gating_rls.sql:19-24`).

### Storage object policies (`storage.objects`)
| Bucket | super_admin | admin | grantee | Source |
|---|---|---|---|---|
| `grant-documents` | (via `is_admin()` only) | read all | read/upload/delete if authenticated | `...initial_schema.sql:3439,3447,3455,3463` |
| `receipts` | (via `is_admin()` only) | read all | read/upload/delete if authenticated | `...initial_schema.sql:3443,3451,3459,3467` |

Storage policies now enforce tenant-scoped object paths via
`storage_object_tenant_id(name) = current_tenant_id()`, with super_admin
retaining tenant-agnostic READ via `is_super_admin()`
(`20260619150000_storage_tenant_scoping.sql`).

---

## 3. Billing exemption / waiver axis (ORTHOGONAL to role)

This axis gates **feature use**, not authorization. It answers "can this user
*currently* create grant data and reach gated pages", independent of which
tables their role may touch. Source: `frontend/src/lib/billing.js` and the
membership helper functions.

- **`isExempt`** (`is_membership_exempt`, `...initial_schema.sql:407-431`): a
  user is exempt when **any** of:
  - `role = 'super_admin'`, OR
  - `role = 'admin'` AND tenant is TFAC (slug `tfac` / `the-family-advocates-canada`, or name "the family advocates canada"), OR
  - the tenant's `tenant_settings.require_subscription = false` (**a per-tenant waiver**).
  This is computed per *tenant/role*, so it cuts across roles: a grantee in a
  waived tenant is exempt; an admin in a non-TFAC paying tenant is not.
- **`hasBasicAccess` / `hasPremiumAccess`** (`has_basic_membership` /
  `has_premium_membership`, `...initial_schema.sql:308-375`): exempt ⇒ true;
  else requires an active row in `user_memberships` of the right tier.
- **Frontend consumption**: `hasRequiredSubscription(session)`
  (`billing.js:286-294`) — super_admin always true; admin needs exempt OR
  premium; grantee needs basic. Drives `isSubscriptionRestricted`,
  `isGranteeWithoutSubscription`, `isAdminWithoutSubscription`
  (`App.js:326-329`) which redirect to `/home`.
- **Backend consumption**: `has_basic_membership()` in the grantee write
  policies (`...subscription_gating_rls.sql`).
- **`hasFeature(session, 'excel_export')`** (`billing.js:296-305`): exempt ⇒
  true; else any basic/premium access. A pure feature gate, no role check.

**Why orthogonal:** the same role can be exempt or not depending on tenant
waiver/TFAC; and an exempt user gains no *new tables* — RLS authorization is
unchanged. Exemption only removes the `has_basic_membership()` write block and
the React subscription redirects. Membership is structurally barred from
super_admin and TFAC admins by `enforce_membership_eligibility`
(`...initial_schema.sql:135-167`), and self-service tenants can never have
admins (`enforce_self_service_role`, `...initial_schema.sql:173-184`).

---

## 4. Resolved discrepancies

**D4 — super_admin RLS access gaps (RESOLVED)**

> **RESOLVED (`20260619160000_super_admin_readonly_ops.sql`).** super_admin now
> has READ-ONLY (SELECT) access to `subscriptions`, `user_memberships`,
> `billing_customers`, `notifications`, and `grant_comments` via new additive
> policies `USING (is_super_admin())`. Writes are intentionally NOT granted —
> they stay on the service_role/Stripe path. (`feature_entitlements` was left
> out of scope.) Proven by `supabase/tests/rls-adversarial.test.sh`.

**D5 — Storage object policies tenant-scoped (RESOLVED)**

> **RESOLVED (`20260619150000_storage_tenant_scoping.sql`).** The object-path
> convention IS the isolation key and the storage policies now enforce it. Paths
> are `grant-documents: attachments/<tenant_id>/<grant_id>/<file>`
> (`GrantAttachments.js`) and
> `receipts: receipts/<tenant_id>/<grant_id>/<expense_id>/<file>`
> (`AddExpenseModal.js`) — the 2nd path segment is the owning tenant. A helper
> `storage_object_tenant_id(name)` extracts it (`storage.foldername(name)[2]`),
> and read/insert/delete on both buckets now require
> `storage_object_tenant_id(name) = current_tenant_id()`. super_admin keeps
> tenant-agnostic READ via `is_super_admin()`. Proven by
> `supabase/tests/rls-adversarial.test.sh`.

**D7 — Invites token-scoped read (RESOLVED)**

> **RESOLVED (`20260619140000_invites_token_scoped_read.sql`).** The
> `USING (true)` policy is dropped and the `anon` table privilege is revoked, so
> anon can no longer enumerate `invites` (direct read now returns
> `permission denied`). A token-scoped SECURITY DEFINER RPC
> `get_invite_by_token(p_token text)` returns ONLY the single matching invite's
> needed fields (`id, tenant_id, role, email, used_at, expires_at, tenant_name`)
> and is `EXECUTE`-granted to `anon`/`authenticated`. The admin own-tenant SELECT
> policy is left intact. Frontend invite-acceptance (`SignUpClean.js`,
> `CompleteProfile.js`) now calls the RPC via the `lib/invites.js` helper instead
> of `supabase.from('invites').select(...)`. Proven by
> `supabase/tests/rls-adversarial.test.sh`.
