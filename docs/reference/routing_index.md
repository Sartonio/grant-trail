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
| `/grants` | `Grants.js` | Grantee (Basic+ subscription required) |
| `/grants/new` | `CreateGrant.js` | Grantee (Basic+ subscription required) |
| `/grants/:id` | `GrantDetail.js` | Grantee (own grants only) |
| `/grants/:id/edit` | `CreateGrant.js` | Grantee (own grants only) |
| `/grants/:id/breakdown` | `GrantBreakdown.js` | Grantee (own grants only) |
| `/expenses` | `ExpenseReports.js` | Grantee (Basic+ subscription required) |
| `/subscription` | `SubscriptionPage.js` | Authenticated (any role) |
| `/admin` | `AdminDashboard.js` | Admin (Premium subscription required) |
| `/admin/grants` | `AdminGrantList.js` | Admin |
| `/admin/grants/:id` | `AdminGrantReview.js` | Admin |
| `/admin/audit` | `AdminAuditLog.js` | Admin |
| `/admin/users` | `AdminUserList.js` | Admin |
| `/admin/settings` | `AdminSettings.js` | Admin |
| `/super/tenants` | `TenantManagement.js` | Super Admin only |

---

## How the Root (`/`) Route Works
The root path is a smart redirect handled in `App.js`. The destination depends on the user's state:

| State | Redirects to |
|-------|-------------|
| Not logged in | Shows `LandingPage` |
| Logged in, no `users` profile | `/complete-profile` |
| Super admin | `/super/tenants` |
| No active subscription | `/home` (paywall) |
| Admin with subscription | `/admin` |
| Grantee with subscription | `/` (displays `Main.js` dashboard) |

---

## Subscription Paywall
Grantees need a Basic+ membership and admins need a Premium membership to access their respective dashboards. Users without the required subscription are redirected to `/home` which shows the `LandingPage` with upgrade prompts. The `/subscription` page lets users manage their Stripe membership.

---

## Route Protection
Route protection is enforced client-side in `App.js`. Access control beyond routing is enforced server-side by Supabase RLS policies on the database.
