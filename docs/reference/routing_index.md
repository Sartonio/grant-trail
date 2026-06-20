# Routing Index

This reference maps URLs to React components and specifies access roles, including subscription paywall redirection logic.

---

## Route Configuration

| URL | Component | Who can access |
|-----|-----------|----------------|
| `/login` | `Login.js` | Public |
| `/signup` | `SignUpClean.js` | Public |
| `/reset-password` | `ResetPassword.js` | Public |
| `/` | `LandingPage.js` (logged-out) or redirect (logged-in) | Everyone — smart redirect based on role + subscription |
| `/home` | `LandingPage.js` | Authenticated — used as the subscription paywall landing |
| `/complete-profile` | `CompleteProfile.js` | Auth users who signed up but have no `users` table record yet |
| `/grants` | `Grants.js` | Grantee only (Basic+ subscription); non-grantees → their own home |
| `/grants/new` | `CreateGrant.js` | Grantee only (Basic+ subscription) |
| `/grants/:id` | `GrantDetail.js` | Grantee only (own grants) |
| `/grants/:id/edit` | `CreateGrant.js` | Grantee only (own grants) |
| `/grants/:id/breakdown` | `GrantBreakdown.js` | Grantee only (own grants) |
| `/expenses` | `ExpenseReports.js` | Grantee only (Basic+ subscription) |
| `/subscription` | `SubscriptionPage.js` | Authenticated (any role) |
| `/admin` | `AdminDashboard.js` | Admin (lapsed admin → read-only, not redirected) |
| `/admin/grants` | `AdminGrantList.js` | Admin (read-only when lapsed) |
| `/admin/grants/:id` | `AdminGrantReview.js` | Admin (read-only when lapsed) |
| `/admin/audit` | `AdminAuditLog.js` | Admin (read-only when lapsed) |
| `/admin/users` | `AdminUserList.js` | Admin (read-only when lapsed) |
| `/admin/settings` | `AdminSettings.js` | Admin (read-only when lapsed) |
| `/super/tenants` | `TenantManagement.js` | Super Admin only |

> **D1 — grantee/admin separation.** `/grants*` and `/expenses` are grantee-only.
> A non-grantee that lands on one is redirected to their own home: admin → `/admin`,
> super_admin → `/super/tenants`, unauthenticated → `/login`.

---

## How the Root (`/`) Route Works
The root path is a smart redirect handled in `App.js`. The destination depends on the user's state:

| State | Redirects to |
|-------|-------------|
| Not logged in | Shows `LandingPage` |
| Logged in, no `users` profile | `/complete-profile` |
| Super admin | `/super/tenants` |
| Unpaid (non-super) | `/home` (paywall) — checked before the role split, so a lapsed admin reaching `/` lands here, while a lapsed admin reaching an `/admin*` route gets the read-only UI instead |
| Admin with subscription | `/admin` |
| Grantee with subscription | `/` (displays `Main.js` dashboard) |

---

## Subscription Paywall
Grantees need a Basic+ membership; admins need a Premium membership (or an exempt/waived tenant). Lapse handling differs by role (issues #40/#41):

- **Grantee without basic membership** — redirected to `/home` (the `LandingPage` upgrade prompts). Hard paywall.
- **Lapsed admin** — **not** redirected. Admin routes still render in **read-only** mode: a `ReadOnlyBanner` shows and mutation controls are disabled. Any attempted write is routed to `/subscription` via `useWriteGuard`.
- **super_admin** — billing-exempt; never gated.

The `/subscription` page lets users manage their Stripe membership.

---

## Route Protection
Route guards are declarative and live in `frontend/src/lib/` — not inline in `App.js`:

- **`policy.js`** — the single source of truth for the two orthogonal axes: role (`getRole`, `isAuthenticated`) and billing (`hasRequiredSubscription`, `needsSubscription`, `canMutate`, `isReadOnlyAdmin`).
- **`guards.js`** — `<Guard>` (composes both axes), plus the thin `<RequireRole>` / `<RequireSubscription>` wrappers and the pure `resolveGuard()` redirect resolver. `billingMode` is `none` | `redirect` (grantee routes) | `readOnly` (admin routes; injects a `readOnly` prop instead of redirecting).
- **`useWriteGuard.js`** — `useWriteGuard(session)` returns a gate every admin mutation handler calls; a blocked write navigates to `/subscription` and returns `false`.

`App.js` wires routes to `<Guard>`; only `/` remains an inline multi-target dispatcher. Access control beyond routing is enforced server-side by Supabase RLS policies on the database.
