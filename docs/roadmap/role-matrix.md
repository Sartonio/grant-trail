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
never redirected off the grantee grant pages (`App.js:387` etc.). See
Discrepancy D1.
² Grantee blocked from these routes when `isGranteeWithoutSubscription` is true,
i.e. grantee lacks `hasBasicAccess` and is not exempt (`App.js:328,387-407`).
³ Admin `/admin*` routes additionally redirect to `/home` when
`isAdminWithoutSubscription` (`App.js:329,417` …). Admin sub requirement =
needs premium unless exempt (`billing.js:290-292`).

The admin-route guards check **only** `role === 'admin'`
(`App.js:417,421,425,429,433,437`), so a **super_admin is redirected to `/`**
from every `/admin*` route — they do not get the admin UI. See Discrepancy D2.

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

Storage upload/delete/own-read policies only check `auth.uid() IS NOT NULL`
(`3447-3467`) — any authenticated user of any role, no ownership/tenant scoping.
See Discrepancy D5.

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

## 4. Discrepancies to confirm (human review)

**D1 — Frontend `/grants*` & `/expenses` never gate admins/super_admins on
subscription, but RLS does gate admins' *own* writes only via role.** The route
guards use `isGranteeWithoutSubscription` only (`App.js:328,387-407`), so an
admin with a lapsed premium sub can still open `/grants` and `/expenses`
(though `/admin*` redirects them). Confirm this asymmetry is intended (admins
manage via `/admin*`, so grant pages may be dead UI for them).

**D2 — super_admin is locked out of all `/admin*` routes** because the guards
check `role === 'admin'` exactly (`App.js:417,421,425,429,433,437`). A
super_admin cannot reach the admin dashboard / user list / audit / settings UI
at all, yet at the RLS layer `is_super_admin()` grants them read/write on many
tenant tables. Confirm super_admins are intended to operate only through
`/super/tenants`, not the admin console.

**D3 — `grant_comments` has no grantee INSERT policy, yet the codebase expects
grantee comments.** Only `is_admin()` may INSERT (`...initial_schema.sql:2332`),
but `notify_grant_comment` (`...initial_schema.sql:649-672`) explicitly handles
the case where the commenter is *not* the grant owner and notifies the owner —
implying non-admins were expected to comment. Grantees can therefore read
comments but never post them. There is also **no UPDATE or DELETE policy on
`grant_comments` for any role** — comments are immutable to all clients. Confirm
whether grantee replies were intended.

**D4 — super_admin has NO RLS access to several tables.** `is_super_admin()` is
*not* OR'd into the policies for `grant_comments`, `notifications`,
`user_memberships`, `subscriptions`, `billing_customers`, `feature_entitlements`
(see §2). A super_admin cannot read these via the API even though they can
manage tenants/users. If a super_admin is ever expected to inspect a tenant's
memberships/billing/notifications directly, these policies would block it.
Confirm intended.

**D5 — Storage object policies are role/tenant-blind.** Upload, delete, and
own-read on both buckets check only `auth.uid() IS NOT NULL`
(`...initial_schema.sql:3447-3467`) — any authenticated user of any tenant can
upload to or delete from `grant-documents` / `receipts`, with no ownership or
tenant scoping in the storage layer (the `grant_attachments`/`receipts` *table*
rows are scoped, but the underlying objects are not). Confirm the object-path
naming convention is relied on for isolation, or tighten these policies.

**D6 — `audit_log` exposes other users' actions on shared records to a
grantee.** "Users can view audit logs for their own records" is keyed on
`changed_by = auth.uid()` (`...initial_schema.sql:2587`), i.e. rows the user
*changed*, not rows *about their grants*. Likely fine, but confirm grantees are
not meant to see the audit trail of admin actions on their grants (they cannot,
under this policy — flagged so the intended semantics are confirmed).

**D7 — `invites` is world-readable.** "Anyone can read invites by token"
(`...initial_schema.sql:2400`) is `USING (true)` and `invites` SELECT is granted
to `anon` — so any unauthenticated caller can enumerate all invite rows
(tokens, emails). Token-based signup may require public read, but full-table
read (not scoped to a supplied token) is broad. Confirm.
